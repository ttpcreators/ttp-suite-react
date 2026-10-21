// ============================================================================
// creator-mail/index.ts : section « Mails » de l'Espace Créateur (LECTURE SEULE).
// ----------------------------------------------------------------------------
// Une créatrice voit les fils Gmail de la boîte agence où apparaît UNE de SES
// adresses (alias principal + adresses en plus, colonne `aliases`) ou qui portent
// son libellé manuel. Tout le filtrage est fait ICI, côté
// serveur : le navigateur ne reçoit jamais un mail qui ne la concerne pas.
//
// Sécurité :
//   1. Identité = JWT Supabase vérifié (sb.auth.getUser) → profiles.role /
//      creator_name. Le client ne choisit JAMAIS sa créatrice ; seule l'agence
//      peut passer { creator } (aperçu « vue créatrice »).
//   2. Réglage lu en base (creator_mail_settings) : section activée + adresses/libellé.
//      Colonne `aliases` absente (SQL pas encore lancé) : lecture sans elle.
//   3. Chaque accès à un fil (ouverture, pièce jointe, note, avis) revérifie que
//      le fil appartient à la créatrice (logic.threadMatches) ; sinon 404. Dans un fil,
//      elle ne voit que les messages qui la concernent (logic.concernedMessages : son
//      alias dans les en-têtes du message, ou le libellé qui vaut pour tout le fil) ;
//      les autres adresses de l'agence en To/Cc deviennent « TTP Creators ».
//   3 bis. Adresse refusée (talent@, boîte partagée, adresse d'un autre créateur) :
//      ignorée ; plus aucune adresse ni libellé → « non configuré ». Section désactivée : toute action autre que `list` → 403.
//   4. Accès Gmail : compte de service (secret GMAIL_SA_KEY + GMAIL_IMPERSONATE,
//      délégation de domaine, scope gmail.readonly) ; à défaut, la connexion
//      Gmail de l'agence déjà en place (google_tokens). Jamais côté client.
//   5. HTML assaini ici (sanitize-html) PUIS côté client (DOMPurify).
//
// Cache mémoire court (liste 60 s, fil 2 min) : promesses en cours partagées, jamais
// d'échec ni de liste incomplète en cache. `list` accepte `fresh: true` (relit Gmail).
// Appels Gmail : délai max + nouvelles tentatives (gfetch). Gmail injoignable pendant
// une note / un avis : accepté si le fil est déjà connu (ligne creator_mail_threads).
//
// Entrée (POST JSON) : { action: "list" | "thread" | "attachment" | "note" | "decision" | "labels",
//                        creator?, threadId?, messageId?, attachmentId?, body?, decision?, comment? }
// `list` renvoie aussi `alias` (adresse principale) et `aliases` (toutes ses adresses).
// « decision » (créatrice) : decision = "encours" | "valide" | "refuse", comment facultatif,
// noté dans creator_mail_status_log (l'agence, elle, écrit directement via la RLS).
// ============================================================================

import sanitizeHtml from "npm:sanitize-html@2.13.0";
import { getServiceClient, getAccessToken, corsHeaders } from "../_shared/google.ts";
import { serviceAccountToken, talentAddress } from "../_shared/gmailBox.ts";
import { gfetch, classifyGmail, mapPool, charsetOf, decodeGmailBody, type GfetchOptions } from "../_shared/gfetch.ts";
import {
  addressList, aliasQuery, aliasRefused, brandAddressOf, brandOf, cleanComment, concernedMessages, displayName, header, isVisibleMessage,
  maskAgencyAddresses, normEmail, parseChoice, threadMatches,
  type GHeader, type GMessageLite,
} from "./logic.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const AGENCY_DOMAIN = (Deno.env.get("AGENCY_MAIL_DOMAIN") ?? "ttpcreators.pro").toLowerCase();
const LIST_MAX = 40;
const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const META_HEADERS = ["From", "To", "Cc", "Bcc", "Delivered-To", "X-Original-To", "Reply-To", "Subject", "Date"];
const NOTE_COLUMNS = "id, body, created_at, agency_read_at, by_role, author_name";

type Sb = ReturnType<typeof getServiceClient>;
type Me = { userId: string; agency: boolean; creator: string | null };
type SettingsRow = { creator: string; alias: string | null; aliases?: string[] | null; label_id: string | null; enabled: boolean };
/** Réglage vérifié : `addresses` = ses adresses acceptées (principale d'abord). */
type Settings = SettingsRow & {
  addresses: string[];
  /** Appel de l'agence (vue « Suivi créateurs ») : voit aussi ses réponses envoyées sans l'alias. */
  agencyView?: boolean;
};

// ---------------------------------------------------------------------------
// Cache mémoire (par instance de fonction) : la PROMESSE est gardée, donc deux
// demandes simultanées ne font qu'une lecture Gmail. Un échec n'est jamais gardé ;
// `keep(v) === false` (ex. liste incomplète) non plus.
// ---------------------------------------------------------------------------
type CacheEntry = { exp: number; born: number; value: Promise<unknown> };
const cache = new Map<string, CacheEntry>();
const FRESH_FLOOR_MS = 5_000; // `fresh` ne relance pas Gmail plus d'une fois toutes les 5 s
function cached<T>(
  key: string, ttlMs: number, load: () => Promise<T>,
  opts: { fresh?: boolean; keep?: (v: T) => boolean } = {},
): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.exp > now && !(opts.fresh && now - hit.born > FRESH_FLOOR_MS)) return hit.value as Promise<T>;
  const value = load();
  const entry: CacheEntry = { exp: now + ttlMs, born: now, value };
  cache.set(key, entry);
  value.then(
    (v) => {
      if (opts.keep && !opts.keep(v)) {
        if (cache.get(key) === entry) cache.delete(key);
      } else entry.exp = Date.now() + ttlMs;
    },
    () => {
      if (cache.get(key) === entry) cache.delete(key);
    },
  );
  if (cache.size > 500) for (const [k, v] of cache) if (v.exp <= now) cache.delete(k);
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
  /** `unreachable` : Gmail injoignable (délai, réseau, 5xx après nouvelles tentatives). */
  constructor(public status: number, public code: string, public unreachable = false) { super(code); }
}

/** Appel Gmail (GET) avec délai max + nouvelles tentatives ; erreurs → HttpError. */
async function gmail<T>(token: string, path: string, opts?: GfetchOptions): Promise<T> {
  let r: Response;
  try {
    r = await gfetch(`${GMAIL}${path}`, { headers: { Authorization: `Bearer ${token}` } }, opts);
  } catch {
    throw new HttpError(502, "gmail_indisponible", true);
  }
  if (r.status === 404) {
    await r.body?.cancel().catch(() => {});
    throw new HttpError(404, "introuvable");
  }
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    const c = classifyGmail(r.status, body, "gmail_indisponible");
    if (c.error === "limite_gmail") throw new HttpError(429, "limite_gmail");
    if (c.error === "google_non_connecte") throw new HttpError(409, "gmail_non_connecte");
    if (c.error === "gmail_scope_manquant") throw new HttpError(502, "gmail_acces_refuse");
    throw new HttpError(502, "gmail_indisponible", r.status >= 500);
  }
  try {
    return await r.json() as T;
  } catch {
    throw new HttpError(502, "gmail_indisponible", true);
  }
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
    } else if (p.mimeType === "text/html" && p.body?.data && !html) html = decodeGmailBody(p.body.data, charsetOf(p.headers));
    else if (p.mimeType === "text/plain" && p.body?.data && !text) text = decodeGmailBody(p.body.data, charsetOf(p.headers));
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
/** Colonne `aliases` absente (SQL des adresses pas encore lancé) ? */
const missingAliases = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42703" || e.code === "PGRST204" || /aliases/.test(e.message ?? ""));

/**
 * Lecture de creator_mail_settings avec la colonne `aliases`, ou sans elle si le SQL
 * des adresses n'est pas encore lancé (la fonction peut être déployée avant).
 */
async function selectSettings<T>(
  run: (cols: string) => PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>,
  cols: string,
): Promise<{ data: T | null; error: { code?: string; message?: string } | null }> {
  const r = await run(`${cols}, aliases`);
  return missingAliases(r.error) ? await run(cols) : r;
}

/**
 * Réglage de la créatrice. Une adresse refusée (talent@, boîte partagée, ou adresse
 * d'un autre créateur dont la section est active) est ignorée : sans adresse ni
 * libellé, la section est alors « non configurée ». En cas de doute (lecture
 * impossible) : toutes ses adresses sont refusées.
 */
async function settingsFor(sb: Sb, creator: string): Promise<Settings | null> {
  const { data } = await selectSettings<SettingsRow>(
    (cols) => sb.from("creator_mail_settings").select(cols).eq("creator", creator).maybeSingle<SettingsRow>(),
    "creator, alias, label_id, enabled",
  );
  if (!data) return null;
  const mine = addressList(data.alias, data.aliases);
  const main = normEmail(data.alias) || null;
  if (!mine.length) return { ...data, alias: main, addresses: [] };
  const { data: others, error } = await selectSettings<{ alias: string | null; aliases?: string[] | null }[]>(
    (cols) => sb.from("creator_mail_settings").select(cols).eq("enabled", true).neq("creator", creator)
      .returns<{ alias: string | null; aliases?: string[] | null }[]>(),
    "creator, alias",
  );
  if (error) console.error("creator-mail réglages", error.message);
  const otherAliases = (others ?? []).flatMap((o) => addressList(o.alias, o.aliases));
  const addresses = error ? [] : mine.filter((a) => !aliasRefused(a, { talent: talentAddress(), agencyDomain: AGENCY_DOMAIN, otherAliases }));
  return { ...data, alias: main && addresses.includes(main) ? main : null, addresses };
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
  if (!visible.length || !threadMatches(visible.map(lite), s.addresses, s.label_id)) throw new HttpError(404, "introuvable");
  return t;
}

/**
 * Note / avis : le fil doit appartenir à la créatrice. Si Gmail est injoignable
 * (délai, réseau, 5xx après nouvelles tentatives), on accepte un fil déjà connu
 * pour elle (ligne creator_mail_threads) ; renvoie alors null (messages inconnus).
 */
async function ownedOrKnown(sb: Sb, s: Settings, threadId: string): Promise<GThread | null> {
  try {
    return await ownedThread(await gmailToken(sb), s, threadId);
  } catch (e) {
    if (!(e instanceof HttpError && e.unreachable)) throw e;
    const { data } = await sb.from("creator_mail_threads")
      .select("thread_id").eq("creator", s.creator).eq("thread_id", threadId).maybeSingle();
    if (!data) throw e;
    return null;
  }
}

/** Messages du fil que la créatrice peut voir (une de ses adresses dans le message, ou libellé du fil). */
// Le CRÉATEUR ne voit que les messages où une de ses adresses apparaît (une réponse de
// l'agence sans lui en copie lui reste cachée, choix de Marc). L'AGENCE voit en plus ses
// réponses à la marque dans le fil, marquées « non visible par le créateur ».
const shownMessages = (t: GThread, s: Settings) =>
  concernedMessages(t.messages ?? [], lite, s.addresses, s.label_id, s.agencyView ? AGENCY_DOMAIN : undefined);
const creatorSees = (t: GThread, s: Settings) => new Set(concernedMessages(t.messages ?? [], lite, s.addresses, s.label_id).map((m) => m.id));

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
// Fil lancé par l'agence (démarchage, alias du créateur en copie) : « Démarchée par
// l'agence » tant que la marque n'a pas répondu, puis « En négociation ».
const autoStatus = (msgs: GMessage[]) =>
  msgs[0] && fromAgency(msgs[0])
    ? (msgs.slice(1).some((m) => !fromAgency(m)) ? "negociation" : "demarchee")
    : (msgs.slice(1).some(fromAgency) ? "negociation" : "nouvelle");

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

/** Fils Gmail de la créatrice (métadonnées). `partial` : un fil n'a pas pu être lu. */
function gmailThreads(token: string, s: Settings, fresh: boolean): Promise<{ threads: GThread[]; partial: boolean }> {
  return cached(`l:${s.addresses.join(",")}:${s.label_id ?? ""}`, 60_000, async () => {
    const ids = new Set<string>();
    const q = aliasQuery(s.addresses);
    if (q) {
      const r = await gmail<{ threads?: { id: string }[] }>(token, `/threads?maxResults=${LIST_MAX}&q=${encodeURIComponent(q)}`);
      for (const t of r.threads ?? []) ids.add(t.id);
    }
    if (s.label_id) {
      const r = await gmail<{ threads?: { id: string }[] }>(token, `/threads?maxResults=${LIST_MAX}&labelIds=${encodeURIComponent(s.label_id)}`);
      for (const t of r.threads ?? []) ids.add(t.id);
    }
    const meta = META_HEADERS.map((h) => `metadataHeaders=${encodeURIComponent(h)}`).join("&");
    let partial = false;
    const got = await mapPool([...ids], 8, (id) =>
      gmail<GThread>(token, `/threads/${encodeURIComponent(id)}?format=metadata&${meta}`).catch((e) => {
        // Supprimé entre la liste et la lecture : rien à signaler. Sinon : liste incomplète.
        if (!(e instanceof HttpError && e.status === 404)) partial = true;
        return null;
      }));
    return { threads: got.filter((t): t is GThread => t !== null), partial };
  }, { fresh, keep: (v) => !v.partial });
}

async function listThreads(sb: Sb, token: string, s: Settings, fresh: boolean) {
  const { threads, partial } = await gmailThreads(token, s, fresh);
  // Statuts et notes : toujours relus en base (pas de cache), l'agence les modifie.
  const [{ data: rows }, { data: notes }] = await Promise.all([
    // « * » : fonctionne avant et après l'ajout des colonnes decided_by / decided_at.
    sb.from("creator_mail_threads").select("*").eq("creator", s.creator),
    sb.from("creator_mail_notes").select("thread_id").eq("creator", s.creator),
  ]);
  const byId = new Map(((rows ?? []) as ThreadRow[]).map((r) => [r.thread_id, r]));
  const noteCount = new Map<string, number>();
  for (const n of (notes ?? []) as { thread_id: string }[]) noteCount.set(n.thread_id, (noteCount.get(n.thread_id) ?? 0) + 1);

  const list = threads
    .map((t) => {
      const msgs = (t.messages ?? []).filter((m) => isVisibleMessage(lite(m)));
      // Revérification serveur : la recherche Gmail est approximative.
      if (!msgs.length || !threadMatches(msgs.map(lite), s.addresses, s.label_id)) return null;
      // Aperçu, date et nombre : seulement les messages qui la concernent.
      const shown = shownMessages(t, s);
      if (!shown.length) return null;
      const first = shown[0];
      const last = shown[shown.length - 1];
      const row = byId.get(t.id);
      return {
        id: t.id,
        subject: header(first.payload?.headers ?? [], "Subject") || "(sans objet)",
        brand: row?.brand || brandOf(shown.map(lite), AGENCY_DOMAIN) || brandOf(msgs.map(lite), AGENCY_DOMAIN) ||
          displayName(header(first.payload?.headers ?? [], "From")),
        brandEmail: brandAddressOf(shown.map(lite), AGENCY_DOMAIN) || brandAddressOf(msgs.map(lite), AGENCY_DOMAIN),
        excerpt: decodeEntities(last.snippet ?? "").slice(0, 220),
        ts: Number(last.internalDate ?? 0),
        count: shown.length,
        status: effectiveStatus(row, msgs),
        ...decisionOf(row),
        notes: noteCount.get(t.id) ?? 0,
        // Démarchage : l'agence a écrit en premier ; la marque a-t-elle répondu depuis ?
        prospect: fromAgency(msgs[0]),
        replied: fromAgency(msgs[0]) && msgs.slice(1).some((m) => !fromAgency(m)),
        startedTs: Number(msgs[0].internalDate ?? 0),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.ts - a.ts);
  return { threads: list, partial };
}

async function threadView(sb: Sb, token: string, s: Settings, threadId: string) {
  const t = await ownedThread(token, s, threadId);
  const budget = { left: INLINE_TOTAL_MAX };
  const messages = [];
  const shown = shownMessages(t, s);
  const seen = s.agencyView ? creatorSees(t, s) : null;
  for (const m of shown) {
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
      // Les autres adresses de l'agence (collègues, boîtes partagées) → « TTP Creators ».
      to: maskAgencyAddresses(header(hs, "To"), s.addresses, AGENCY_DOMAIN),
      cc: maskAgencyAddresses(header(hs, "Cc"), s.addresses, AGENCY_DOMAIN),
      ts: Number(m.internalDate ?? 0),
      html: html ? clean(html) : "",
      text: html ? "" : text,
      attachments,
      ...(seen && !seen.has(m.id) ? { hiddenFromCreator: true } : {}),
    });
  }
  const [{ data: row }, { data: notes }] = await Promise.all([
    sb.from("creator_mail_threads").select("*").eq("creator", s.creator).eq("thread_id", threadId).maybeSingle(),
    sb.from("creator_mail_notes").select(NOTE_COLUMNS)
      .eq("creator", s.creator).eq("thread_id", threadId).order("created_at"),
  ]);
  const first = shown[0];
  return {
    id: threadId,
    subject: header(first?.payload?.headers ?? [], "Subject") || "(sans objet)",
    brand: (row as ThreadRow | null)?.brand || brandOf(shown.map(lite), AGENCY_DOMAIN) || brandOf((t.messages ?? []).map(lite), AGENCY_DOMAIN),
    status: effectiveStatus(row as ThreadRow | null, (t.messages ?? []).filter((x) => isVisibleMessage(lite(x)))),
    ...decisionOf(row as ThreadRow | null),
    messages,
    notes: notes ?? [],
  };
}

async function attachment(token: string, s: Settings, threadId: string, messageId: string, attachmentId: string) {
  const t = await ownedThread(token, s, threadId);
  // Seulement une pièce d'un message qu'elle a le droit de voir.
  const msg = shownMessages(t, s).find((m) => m.id === messageId);
  if (!msg) throw new HttpError(404, "introuvable");
  const meta = extract(msg.payload, msg.id).attachments.find((a) => a.attachmentId === attachmentId);
  if (!meta) throw new HttpError(404, "introuvable");
  if (meta.size > ATTACHMENT_MAX_BYTES) throw new HttpError(413, "piece_trop_lourde");
  const a = await gmail<{ data?: string }>(token, `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, { timeoutMs: 30_000 });
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
    const s0 = await settingsFor(sb, creator);
    const s: Settings | null = s0 && { ...s0, agencyView: me.agency };
    // Section désactivée (créatrice) : seule la liste répond (« non configurée ») ;
    // toute autre action est refusée. L'agence garde l'aperçu avant activation.
    const disabled = !me.agency && (!s || !s.enabled);
    if (disabled && action !== "list") return res({ error: "section_desactivee" }, 403);
    // Section désactivée ou non configurée : rien n'est lu dans Gmail.
    if (!s || disabled || (!s.addresses.length && !s.label_id)) {
      return res({ ok: true, configured: false, threads: [] });
    }

    const threadId = String(body.threadId ?? "");
    if (action === "note") {
      if (me.agency) return res({ error: "non_autorise" }, 403);
      const text = String(body.body ?? "").trim();
      if (!text || text.length > 4000) return res({ error: "note_invalide" }, 400);
      await ownedOrKnown(sb, s, threadId);
      const { data, error } = await sb.from("creator_mail_notes")
        .insert({ creator, thread_id: threadId, author_user_id: me.userId, body: text })
        .select(NOTE_COLUMNS).single();
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
      const t = await ownedOrKnown(sb, s, threadId);
      const now = new Date().toISOString();
      type DecisionRow = { creator: string; thread_id: string; status: string; decided_by: string | null; decided_at: string | null; updated_at: string };
      const row: DecisionRow = choice === "encours"
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
      const msgs = (t?.messages ?? []).filter((m) => isVisibleMessage(lite(m)));
      const asRow: ThreadRow = { ...row, brand: null };
      return res({ ok: true, status: effectiveStatus(asRow, msgs), ...decisionOf(asRow), logged: !logError });
    }

    const token = await gmailToken(sb);
    if (action === "list") {
      const { threads, partial } = await listThreads(sb, token, s, body.fresh === true);
      // `alias` : adresse principale (compatibilité) ; `aliases` : toutes ses adresses.
      return res({
        ok: true, configured: true, threads, alias: s.alias ?? s.addresses[0] ?? null, aliases: s.addresses,
        ...(partial ? { partial: true } : {}),
      });
    }
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
