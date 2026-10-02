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
//   3. Chaque accès à un fil (ouverture, pièce jointe, note) revérifie que le fil
//      appartient à la créatrice (logic.threadMatches) ; sinon 404.
//   4. Accès Gmail : compte de service (secret GMAIL_SA_KEY + GMAIL_IMPERSONATE,
//      délégation de domaine, scope gmail.readonly) ; à défaut, la connexion
//      Gmail de l'agence déjà en place (google_tokens). Jamais côté client.
//   5. HTML assaini ici (sanitize-html) PUIS côté client (DOMPurify).
//
// Cache mémoire court (liste 60 s, fil 2 min). Pas de Pub/Sub pour l'instant :
// pour l'ajouter, il suffira d'invalider `cache` depuis un webhook.
//
// Entrée (POST JSON) : { action: "list" | "thread" | "attachment" | "note" | "labels",
//                        creator?, threadId?, messageId?, attachmentId?, body? }
// ============================================================================

import sanitizeHtml from "npm:sanitize-html@2.13.0";
import { getServiceClient, getAccessToken, corsHeaders } from "../_shared/google.ts";
import {
  aliasQuery, brandOf, displayName, header, isVisibleMessage, normEmail, threadMatches,
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
let saToken: { token: string; exp: number } | null = null;

function b64url(bytes: Uint8Array | string): string {
  const bin = typeof bytes === "string" ? bytes : String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function serviceAccountToken(rawKey: string, subject: string): Promise<string> {
  if (saToken && saToken.exp > Date.now() + 60_000) return saToken.token;
  const key = JSON.parse(rawKey) as { client_email: string; private_key: string };
  const pem = key.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const unsigned =
    b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." +
    b64url(JSON.stringify({
      iss: key.client_email, sub: subject, aud: "https://oauth2.googleapis.com/token",
      scope: "https://www.googleapis.com/auth/gmail.readonly", iat: now, exp: now + 3600,
    }));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(unsigned)));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${b64url(sig)}`,
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error("sa_token_failed");
  saToken = { token: d.access_token, exp: Date.now() + Number(d.expires_in ?? 3600) * 1000 };
  return saToken.token;
}

async function gmailToken(sb: Sb): Promise<string> {
  const saKey = Deno.env.get("GMAIL_SA_KEY");
  const subject = Deno.env.get("GMAIL_IMPERSONATE");
  if (saKey && subject) return serviceAccountToken(saKey, subject);
  return getAccessToken(sb);
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

function extract(payload: GPart | undefined, messageId: string) {
  let html = "";
  let text = "";
  const attachments: { messageId: string; attachmentId: string; filename: string; mimeType: string; size: number }[] = [];
  const walk = (p?: GPart) => {
    if (!p) return;
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
  return { html, text, attachments };
}

// Assainissement serveur : aucun script, formulaire, iframe, style global ni
// gestionnaire d'événement. Les images restent mais seront bloquées par la CSP
// du lecteur côté client tant que la créatrice ne les affiche pas.
function clean(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "a", "b", "i", "u", "s", "em", "strong", "small", "sub", "sup", "br", "hr", "p", "div", "span",
      "blockquote", "pre", "code", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6",
      "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col", "img", "center", "font",
    ],
    allowedAttributes: {
      "*": ["style", "align", "valign", "width", "height", "bgcolor", "color", "dir"],
      a: ["href", "title"],
      img: ["src", "alt", "title", "width", "height"],
      td: ["colspan", "rowspan"], th: ["colspan", "rowspan"], font: ["face", "size", "color"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer nofollow" }) },
    disallowedTagsMode: "discard",
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
  if (!threadMatches((t.messages ?? []).map(lite), s.alias ?? "", s.label_id)) throw new HttpError(404, "introuvable");
  return t;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
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
    sb.from("creator_mail_threads").select("thread_id, status, brand").eq("creator", s.creator),
    sb.from("creator_mail_notes").select("thread_id").eq("creator", s.creator),
  ]);
  const byId = new Map(((rows ?? []) as { thread_id: string; status: string; brand: string | null }[]).map((r) => [r.thread_id, r]));
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
        excerpt: decodeEntities(last.snippet ?? "").slice(0, 220),
        ts: Number(last.internalDate ?? 0),
        count: msgs.length,
        status: row?.status ?? "nouvelle",
        notes: noteCount.get(t.id) ?? 0,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.ts - a.ts);
}

async function threadView(sb: Sb, token: string, s: Settings, threadId: string) {
  const t = await ownedThread(token, s, threadId);
  const messages = (t.messages ?? []).filter((m) => isVisibleMessage(lite(m))).map((m) => {
    const hs = m.payload?.headers ?? [];
    const { html, text, attachments } = extract(m.payload, m.id);
    const from = header(hs, "From");
    const fromAddr = (from.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] ?? "").toLowerCase();
    return {
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
    };
  });
  const [{ data: row }, { data: notes }] = await Promise.all([
    sb.from("creator_mail_threads").select("status, brand").eq("creator", s.creator).eq("thread_id", threadId).maybeSingle(),
    sb.from("creator_mail_notes").select("id, body, created_at, agency_read_at")
      .eq("creator", s.creator).eq("thread_id", threadId).order("created_at"),
  ]);
  const first = t.messages?.[0];
  return {
    id: threadId,
    subject: header(first?.payload?.headers ?? [], "Subject") || "(sans objet)",
    brand: (row as { brand?: string } | null)?.brand || brandOf((t.messages ?? []).map(lite), AGENCY_DOMAIN),
    status: (row as { status?: string } | null)?.status ?? "nouvelle",
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
