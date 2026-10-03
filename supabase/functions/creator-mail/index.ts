// ============================================================================
// creator-mail/index.ts : section « Mails » de l'Espace Créateur (LECTURE SEULE).
// ----------------------------------------------------------------------------
// Une créatrice voit les fils Gmail de la boîte agence où apparaît SON alias
// (ou qui portent son libellé manuel). Tout le filtrage est fait ICI, côté
// serveur : le navigateur ne reçoit jamais un mail qui ne la concerne pas.
//
// Sécurité :
//   1. Identité = JWT Supabase vérifié (sb.auth.getUser) → profiles.role /
//      creator_name. Le client ne choisit JAMAIS sa créatrice ; seule l'agence
//      peut passer { creator } (aperçu « vue créatrice »).
//   2. Réglage lu en base (creator_mail_settings) : section activée + alias/libellé.
//   3. Chaque accès à un fil (ouverture, pièce jointe, note, avis) revérifie que
//      le fil appartient à la créatrice (logic.threadMatches) ; sinon 404.
//   4. Accès Gmail : compte de service (secret GMAIL_SA_KEY + GMAIL_IMPERSONATE,
//      délégation de domaine, scope gmail.readonly) ; à défaut, la connexion
//      Gmail de l'agence déjà en place (google_tokens). Jamais côté client.
//   5. HTML assaini ici (sanitize-html) PUIS côté client (DOMPurify).
//
// Cache mémoire court (liste 60 s, fil 2 min). Pas de Pub/Sub pour l'instant :
// pour l'ajouter, il suffira d'invalider `cache` depuis un webhook.
//
// Entrée (POST JSON) : { action: "list" | "thread" | "attachment" | "note" | "decision" | "labels",
//                        creator?, threadId?, messageId?, attachmentId?, body?, decision?, comment? }
// « decision » (créatrice) : decision = "encours" | "valide" | "refuse", comment facultatif,
// noté dans creator_mail_status_log (l'agence, elle, écrit directement via la RLS).
// ============================================================================

import sanitizeHtml from "npm:sanitize-html@2.13.0";
import { getServiceClient, getAccessToken, corsHeaders } from "../_shared/google.ts";
import { serviceAccountToken, talentAddress } from "../_shared/gmailBox.ts";
import {
  aliasQuery, brandAddressOf, brandOf, cleanComment, displayName, header, isVisibleMessage, normEmail, parseChoice, threadMatches,
  type GHeader, type GMessageLite,
} from "./logic.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const AGENCY_DOMAIN = (Deno.env.get("AGENCY_MAIL_DOMAIN") ?? "ttpcreators.pro").toLowerCase();
const LIST_MAX = 40;
const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const META_HEADERS = ["From", "To", "Cc", "Delivered-To", "X-Original-To", "Reply-To", "Subject", "Date"];

type Sb = ReturnType<typeof getServiceClient>;
type Me = { userId: string; agency: boolean; creator: string | null };
type Settings = { creator: string; alias: string | null; label_id: string | null; enabled: boolean };

// ---------------------------------------------------------------------------
// Cache mémoire (par instance de fonction)
// ---------------------------------------------------------------------------
const cache = new Map<string, { exp: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value as T;
  const value = await load();
  cache.set(key, { exp: Date.now() + ttlMs, value });
  if (cache.size > 500) for (const [k, v] of cache) if (v.exp <= Date.now()) cache.delete(k);
  return value;
}

// ---------------------------------------------------------------------------
// Identité
// ---------------------------------------------------------------------------
async function whoAmI(req: Request, sb: Sb): Promise<Me | null> {
  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  if (!bearer) return null;
  const { data, error } = await sb.auth.getUser(bearer);
  if (error || !data?.user) return null;
  const { data: prof } = await sb
    .from("profiles").select("role, creator_name").eq("user_id", data.user.id)
    .maybeSingle<{ role: string; creator_name: string | null }>();
  if (!prof) return null;
  return { userId: data.user.id, agency: prof.role === "agency", creator: prof.creator_name ?? null };
}

// ---------------------------------------------------------------------------
// Jeton Gmail : compte de service (si configuré) sinon connexion agence
// ---------------------------------------------------------------------------
async function gmailToken(sb: Sb): Promise<string> {
  // talent@ via le compte de service s'il est configuré, sinon la connexion de l'app.
  return talentAddress() ? serviceAccountToken("https://www.googleapis.com/auth/gmail.readonly") : getAccessToken(sb);
}

class HttpError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

async function gmail<T>(token: string, path: string): Promise<T> {
  const r = await fetch(`${GMAIL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 404) throw new HttpError(404, "introuvable");
  if (!r.ok) throw new HttpError(502, r.status === 403 ? "gmail_acces_refuse" : "gmail_indisponible");
  return r.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Types Gmail (minimaux)
// ---------------------------------------------------------------------------
type GPart = {
  partId?: string; mimeType?: string; filename?: string; headers?: GHeader[];
  body?: { data?: string; attachmentId?: string; size?: number }; parts?: GPart[];
};
type GMessage = { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: GPart };
type GThread = { id: string; messages?: GMessage[] };

const lite = (m: GMessage): GMessageLite => ({ labelIds: m.labelIds, headers: m.payload?.headers ?? [] });

function decodeB64Url(data: string): string {
  try {
    const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
}

function decodeEntities(s: string): string {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

type Inline = { cid: string; mimeType: string; size: number; attachmentId?: string; data?: string };

function extract(payload: GPart | undefined, messageId: string) {
  let html = "";
  let text = "";
  const attachments: { messageId: string; attachmentId: string; filename: string; mimeType: string; size: number }[] = [];
  // Images intégrées au corps (logos de signature…) : référencées par « cid: » dans le HTML.
  const inline: Inline[] = [];
  const walk = (p?: GPart) => {
    if (!p) return;
    const cid = header(p.headers ?? [], "Content-ID").replace(/^<|>$/g, "").trim();
    if (cid && (p.mimeType ?? "").startsWith("image/") && (p.body?.attachmentId || p.body?.data)) {
      inline.push({ cid, mimeType: p.mimeType ?? "image/png", size: p.body?.size ?? 0, attachmentId: p.body?.attachmentId, data: p.body?.data });
    }
    if (p.filename && p.body?.attachmentId) {
      attachments.push({
        messageId, attachmentId: p.body.attachmentId, filename: p.filename,
        mimeType: p.mimeType ?? "application/octet-stream", size: p.body.size ?? 0,
      });
    } else if (p.mimeType === "text/html" && p.body?.data && !html) html = decodeB64Url(p.body.data);
    else if (p.mimeType === "text/plain" && p.body?.data && !text) text = decodeB64Url(p.body.data);
    for (const c of p.parts ?? []) walk(c);
  };
  walk(payload);
  return { html, text, attachments, inline };
}

const INLINE_MAX_BYTES = 600 * 1024; // par image
const INLINE_TOTAL_MAX = 4 * 1024 * 1024; // par fil

/** Remplace les « cid: » du HTML par les images elles-mêmes (data URI). */
async function embedInline(token: string, messageId: string, html: string, inline: Inline[], budget: { left: number }) {
  const used = new Set<string>();
  let out = html;
  for (const im of inline) {
    const ref = new RegExp(`cid:${im.cid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi");
    if (!ref.test(out)) continue;
    used.add(im.cid);
    if (im.size > INLINE_MAX_BYTES || im.size > budget.left) continue;
    let data = im.data;
    if (!data && im.attachmentId) {
      const a = await cached(`a:${messageId}:${im.attachmentId}`, 600_000, () =>
        gmail<{ data?: string }>(token, `/messages/${messageId}/attachments/${encodeURIComponent(im.attachmentId!)}`)).catch(() => null);
      data = a?.data;
    }
    if (!data) continue;
    budget.left -= im.size;
    const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
    out = out.replace(ref, `data:${im.mimeType.replace(/[^\w/+.-]/g, "")};base64,${b64}`);
  }
  return { html: out, used };
}

// Assainissement serveur : aucun script, formulaire, iframe, style global ni
// gestionnaire d'événement. Les images (logos, signatures) sont conservées.
const tiny = (v?: string) => {
  const n = parseInt(v ?? "", 10);
  return !Number.isNaN(n) && n <= 2;
};

function clean(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "a", "b", "i", "u", "s", "em", "strong", "small", "sub", "sup", "br", "hr", "p", "div", "span",
      "blockquote", "pre", "code", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6",
      "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col", "img", "center", "font",
    ],
    allowedAttributes: {
      "*": ["style", "class", "align", "valign", "width", "height", "bgcolor", "color", "dir"],
      a: ["href", "title"],
      img: ["src", "alt", "title", "width", "height"],
      td: ["colspan", "rowspan"], th: ["colspan", "rowspan"], font: ["face", "size", "color"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer nofollow" }) },
    disallowedTagsMode: "discard",
    // Pixels espions (images 1×1 de suivi d'ouverture) : retirés.
    exclusiveFilter: (frame: { tag: string; attribs: Record<string, string> }) => frame.tag === "img" && tiny(frame.attribs.width) && tiny(frame.attribs.height),
  });
}

// ---------------------------------------------------------------------------
// Réglage + appartenance
// ---------------------------------------------------------------------------
async function settingsFor(sb: Sb, creator: string): Promise<Settings | null> {
  const { data } = await sb.from("creator_mail_settings")
    .select("creator, alias, label_id, enabled").eq("creator", creator).maybeSingle<Settings>();
  return data ?? null;
}

async function loadThread(token: string, threadId: string): Promise<GThread> {
  if (!/^[A-Za-z0-9]{6,32}$/.test(threadId)) throw new HttpError(404, "introuvable");
  return cached(`t:${threadId}`, 120_000, () => gmail<GThread>(token, `/threads/${threadId}?format=full`));
}

/** Fil chargé ET vérifié comme appartenant à la créatrice, sinon 404. */
async function ownedThread(token: string, s: Settings, threadId: string): Promise<GThread> {
  const t = await loadThread(token, threadId);
  // Seuls les messages visibles comptent (un mail à la corbeille ne donne plus accès au fil).
  const visible = (t.messages ?? []).filter((m) => isVisibleMessage(lite(m)));
  if (!visible.length || !threadMatches(visible.map(lite), s.alias ?? "", s.label_id)) throw new HttpError(404, "introuvable");
  return t;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
/** Un message vient-il de l'agence (domaine ttpcreators.pro) ? */
const fromAgency = (m: GMessage) =>
  (header(m.payload?.headers ?? [], "From").match(/[^\s<>"]+@[^\s<>"]+/)?.[0] ?? "").toLowerCase().endsWith("@" + AGENCY_DOMAIN);

/**
 * Statut automatique tant que l'agence n'en a pas choisi un : « Nouvelle demande »,
 * puis « En négociation » dès que l'agence a répondu dans le fil. Un statut choisi
 * à la main (table creator_mail_threads) l'emporte toujours.
 */
const autoStatus = (msgs: GMessage[]) => (msgs.slice(1).some(fromAgency) ? "negociation" : "nouvelle");

type ThreadRow = { thread_id: string; status: string; brand: string | null; decided_by?: string | null; decided_at?: string | null };
/**
 * Statut affiché : le statut ENREGISTRÉ (Validé / Refusé par la créatrice ou l'agence,
 * À vérifier / À valider par l'agence) l'emporte ; sinon statut automatique
 * (Nouvelle demande / En négociation).
 */
/** Statuts posés à la main (créatrice ou agence) ; les autres sont calculés depuis Gmail. */
const STORED = ["a_verifier", "a_valider", "valide", "refuse"];
const effectiveStatus = (row: ThreadRow | null | undefined, msgs: GMessage[]) =>
  row && STORED.includes(row.status) ? row.status : autoStatus(msgs);
const decisionOf = (row: ThreadRow | null | undefined) =>
  row && STORED.includes(row.status)
    ? { decidedBy: row.decided_by ?? "agency", decidedAt: row.decided_at ?? null }
    : { decidedBy: null, decidedAt: null };

async function gmailThreads(token: string, s: Settings): Promise<GThread[]> {
  return cached(`l:${s.alias ?? ""}:${s.label_id ?? ""}`, 60_000, async () => {
    const ids = new Set<string>();
    const q = aliasQuery(s.alias ?? "");
    if (q) {
      const r = await gmail<{ threads?: { id: string }[] }>(token, `/threads?maxResults=${LIST_MAX}&q=${encodeURIComponent(q)}`);
      for (const t of r.threads ?? []) ids.add(t.id);
    }
    if (s.label_id) {
      const r = await gmail<{ threads?: { id: string }[] }>(token, `/threads?maxResults=${LIST_MAX}&labelIds=${encodeURIComponent(s.label_id)}`);
      for (const t of r.threads ?? []) ids.add(t.id);
    }
    const meta = META_HEADERS.map((h) => `metadataHeaders=${encodeURIComponent(h)}`).join("&");
    const threads: GThread[] = [];
    const all = [...ids];
    for (let i = 0; i < all.length; i += 10) {
      const chunk = await Promise.all(all.slice(i, i + 10).map((id) =>
        gmail<GThread>(token, `/threads/${id}?format=metadata&${meta}`).catch(() => null)));
      for (const t of chunk) if (t) threads.push(t);
    }
    return threads;
  });
}

async function listThreads(sb: Sb, token: string, s: Settings) {
  const threads = await gmailThreads(token, s);
  // Statuts et notes : toujours relus en base (pas de cache), l'agence les modifie.
  const [{ data: rows }, { data: notes }] = await Promise.all([
    // « * » : fonctionne avant et après l'ajout des colonnes decided_by / decided_at.
    sb.from("creator_mail_threads").select("*").eq("creator", s.creator),
    sb.from("creator_mail_notes").select("thread_id").eq("creator", s.creator),
  ]);
  const byId = new Map(((rows ?? []) as ThreadRow[]).map((r) => [r.thread_id, r]));
  const noteCount = new Map<string, number>();
  for (const n of (notes ?? []) as { thread_id: string }[]) noteCount.set(n.thread_id, (noteCount.get(n.thread_id) ?? 0) + 1);

  return threads
    .map((t) => {
      const msgs = (t.messages ?? []).filter((m) => isVisibleMessage(lite(m)));
      // Revérification serveur : la recherche Gmail est approximative.
      if (!msgs.length || !threadMatches(msgs.map(lite), s.alias ?? "", s.label_id)) return null;
      const first = msgs[0];
      const last = msgs[msgs.length - 1];
      const row = byId.get(t.id);
      return {
        id: t.id,
        subject: header(first.payload?.headers ?? [], "Subject") || "(sans objet)",
        brand: row?.brand || brandOf(msgs.map(lite), AGENCY_DOMAIN) || displayName(header(first.payload?.headers ?? [], "From")),
        brandEmail: brandAddressOf(msgs.map(lite), AGENCY_DOMAIN),
        excerpt: decodeEntities(last.snippet ?? "").slice(0, 220),
        ts: Number(last.internalDate ?? 0),
        count: msgs.length,
        status: effectiveStatus(row, msgs),
        ...decisionOf(row),
        notes: noteCount.get(t.id) ?? 0,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.ts - a.ts);
}

async function threadView(sb: Sb, token: string, s: Settings, threadId: string) {
  const t = await ownedThread(token, s, threadId);
  const budget = { left: INLINE_TOTAL_MAX };
  const messages = [];
  for (const m of (t.messages ?? []).filter((x) => isVisibleMessage(lite(x)))) {
    const hs = m.payload?.headers ?? [];
    const ex = extract(m.payload, m.id);
    const { text } = ex;
    const { html, used } = ex.html ? await embedInline(token, m.id, ex.html, ex.inline, budget) : { html: "", used: new Set<string>() };
    // Les images intégrées au corps ne sont pas des pièces jointes à télécharger.
    const inlineIds = new Set(ex.inline.filter((i) => used.has(i.cid)).map((i) => i.attachmentId));
    const attachments = ex.attachments.filter((a) => !inlineIds.has(a.attachmentId));
    const from = header(hs, "From");
    const fromAddr = (from.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] ?? "").toLowerCase();
    messages.push({
      id: m.id,
      from: displayName(from),
      fromEmail: fromAddr,
      fromAgency: fromAddr.endsWith("@" + AGENCY_DOMAIN),
      to: header(hs, "To"),
      cc: header(hs, "Cc"),
      ts: Number(m.internalDate ?? 0),
      html: html ? clean(html) : "",
      text: html ? "" : text,
      attachments,
    });
  }
  const [{ data: row }, { data: notes }] = await Promise.all([
    sb.from("creator_mail_threads").select("*").eq("creator", s.creator).eq("thread_id", threadId).maybeSingle(),
    sb.from("creator_mail_notes").select("id, body, created_at, agency_read_at")
      .eq("creator", s.creator).eq("thread_id", threadId).order("created_at"),
  ]);
  const first = t.messages?.[0];
  return {
    id: threadId,
    subject: header(first?.payload?.headers ?? [], "Subject") || "(sans objet)",
    brand: (row as ThreadRow | null)?.brand || brandOf((t.messages ?? []).map(lite), AGENCY_DOMAIN),
    status: effectiveStatus(row as ThreadRow | null, (t.messages ?? []).filter((x) => isVisibleMessage(lite(x)))),
    ...decisionOf(row as ThreadRow | null),
    messages,
    notes: notes ?? [],
  };
}

async function attachment(token: string, s: Settings, threadId: string, messageId: string, attachmentId: string) {
  const t = await ownedThread(token, s, threadId);
  const msg = (t.messages ?? []).find((m) => m.id === messageId && isVisibleMessage(lite(m)));
  if (!msg) throw new HttpError(404, "introuvable");
  const meta = extract(msg.payload, msg.id).attachments.find((a) => a.attachmentId === attachmentId);
  if (!meta) throw new HttpError(404, "introuvable");
  if (meta.size > ATTACHMENT_MAX_BYTES) throw new HttpError(413, "piece_trop_lourde");
  const a = await gmail<{ data?: string }>(token, `/messages/${messageId}/attachments/${encodeURIComponent(attachmentId)}`);
  return {
    filename: meta.filename, mimeType: meta.mimeType,
    data: (a.data ?? "").replace(/-/g, "+").replace(/_/g, "/"), // base64 standard
  };
}

// ---------------------------------------------------------------------------
// Entrée HTTP
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const res = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), {
      status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return res({ error: "methode" }, 405);

  const sb = getServiceClient();
  const me = await whoAmI(req, sb);
  if (!me) return res({ error: "non_autorise" }, 401);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return res({ error: "requete_invalide" }, 400);
  }
  const action = String(body.action ?? "");

  try {
    // Libellés Gmail (agence uniquement, pour lier une créatrice à un libellé).
    if (action === "labels") {
      if (!me.agency) return res({ error: "non_autorise" }, 403);
      const token = await gmailToken(sb);
      const r = await gmail<{ labels?: { id: string; name: string; type: string }[] }>(token, "/labels");
      return res({ ok: true, labels: (r.labels ?? []).filter((l) => l.type === "user").map((l) => ({ id: l.id, name: l.name })) });
    }

    // Créatrice concernée : la sienne, ou (agence seulement) celle demandée.
    const creator = me.agency ? String(body.creator ?? "").trim() : me.creator ?? "";
    if (!creator) return res({ error: "creatrice_inconnue" }, 400);
    const s = await settingsFor(sb, creator);
    // Section désactivée ou non configurée : rien n'est lu dans Gmail.
    if (!s || (!me.agency && !s.enabled) || (!normEmail(s.alias) && !s.label_id)) {
      return res({ ok: true, configured: false, threads: [] });
    }

    const threadId = String(body.threadId ?? "");
    if (action === "note") {
      if (me.agency) return res({ error: "non_autorise" }, 403);
      const text = String(body.body ?? "").trim();
      if (!text || text.length > 4000) return res({ error: "note_invalide" }, 400);
      await ownedThread(await gmailToken(sb), s, threadId);
      const { data, error } = await sb.from("creator_mail_notes")
        .insert({ creator, thread_id: threadId, author_user_id: me.userId, body: text })
        .select("id, body, created_at, agency_read_at").single();
      if (error) return res({ error: "note_non_enregistree" }, 500);
      return res({ ok: true, note: data });
    }

    // Avis de la créatrice : elle range l'échange dans « En cours », « Validé » ou
    // « Refusé », avec un mot facultatif. Elle peut toujours changer d'avis (même
    // après un choix de l'agence) : chaque changement est noté dans l'historique.
    if (action === "decision") {
      if (me.agency) return res({ error: "non_autorise" }, 403);
      const choice = parseChoice(body.decision);
      if (!choice) return res({ error: "requete_invalide" }, 400);
      const comment = cleanComment(body.comment);
      const t = await ownedThread(await gmailToken(sb), s, threadId);
      const now = new Date().toISOString();
      const row = choice === "encours"
        ? { creator, thread_id: threadId, status: "nouvelle", decided_by: null, decided_at: null, updated_at: now }
        : { creator, thread_id: threadId, status: choice, decided_by: "creator", decided_at: now, updated_at: now };
      const { error } = await sb.from("creator_mail_threads").upsert(row, { onConflict: "creator,thread_id" });
      if (error) return res({ error: /decided_/.test(error.message) ? "migration_manquante" : "decision_non_enregistree" }, 500);
      // Trace (qui, quand, son mot). Le choix est déjà enregistré : un échec ici
      // (SQL de l'historique pas encore lancé) ne l'annule pas.
      const { error: logError } = await sb.from("creator_mail_status_log").insert({
        creator, thread_id: threadId, status: choice, by_role: "creator", author_user_id: me.userId, comment,
      });
      if (logError) console.error("creator-mail historique", logError.message);
      const msgs = (t.messages ?? []).filter((m) => isVisibleMessage(lite(m)));
      return res({ ok: true, status: effectiveStatus(row as ThreadRow, msgs), ...decisionOf(row as ThreadRow), logged: !logError });
    }

    const token = await gmailToken(sb);
    if (action === "list") return res({ ok: true, configured: true, threads: await listThreads(sb, token, s) });
    if (action === "thread") return res({ ok: true, thread: await threadView(sb, token, s, threadId) });
    if (action === "attachment") {
      return res({ ok: true, ...(await attachment(token, s, threadId, String(body.messageId ?? ""), String(body.attachmentId ?? ""))) });
    }
    return res({ error: "action_inconnue" }, 400);
  } catch (e) {
    if (e instanceof HttpError) return res({ error: e.code }, e.status);
    const msg = (e as Error)?.message ?? "";
    if (msg === "not_connected" || msg === "invalid_grant") return res({ error: "gmail_non_connecte" }, 409);
    console.error("creator-mail", msg);
    return res({ error: "erreur_serveur" }, 500);
  }
});
