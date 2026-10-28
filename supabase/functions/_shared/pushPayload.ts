// ============================================================================
// _shared/pushPayload.ts : format UNIQUE des notifications push (règles pures).
// ----------------------------------------------------------------------------
// Toutes les fonctions qui envoient un push (gmail-poll, team-notify, daily-digest,
// report-error) passent par makePayload : même forme, même sobriété.
//   { title, body, url, tag, kind, threadId?, count?, image?, lang?, ts }
// Lu par public/sw.js. Sans réseau ni API Deno : testé par src/lib/pushPayload.test.ts.
// Le schéma d'adresse (deepLinkUrl) est le miroir de src/lib/deepLink.ts.
// ============================================================================

export type PushKind =
  | "mail" // nouveau mail sur une boîte de l'agence (un fil)
  | "mail-summary" // plusieurs nouveaux mails d'un coup (agence)
  | "creator-mail" // nouveau mail reçu à l'adresse d'un créateur
  | "creator-mail-summary"
  | "team" // qui fait quoi dans l'équipe
  | "digest" // résumés (matin, 14 h, lundi, stats, anniversaires)
  | "creator-activity" // un créateur a ajouté quelque chose
  | "agency-activity" // l'agence a ajouté quelque chose au créateur
  | "dm" // nouveau DM Instagram sur le compte de l'agence
  | "error"
  | "test";

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
  kind: PushKind;
  threadId?: string;
  count?: number;
  image?: string;
  lang?: "fr" | "en";
  /** Nom de l'expéditeur (mails) : sert au résumé regroupé du service worker. */
  sender?: string;
  ts: number;
};

export type PayloadInput = Omit<PushPayload, "ts" | "url"> & { url?: string; ts?: number };

const TITLE_MAX = 80;
const BODY_MAX = 160;

/** Coupe proprement (au dernier espace si possible) et ajoute « … ». */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,.;:·-]+$/u, "") + "…";
}

/**
 * Texte de notification sobre (style iPhone) : sans émojis ni tirets longs, espaces
 * resserrés. `keepLines` garde UN saut de ligne (mails : objet puis extrait).
 */
export function tidyText(t: unknown, keepLines = false): string {
  let s = String(t ?? "")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s+[—–]\s+/g, " · ")
    .replace(/[—–]/g, "-");
  if (keepLines) {
    s = s.split(/\s*\n+\s*/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 2).join("\n");
  } else {
    s = s.replace(/\s*\n+\s*/g, " · ").replace(/\s{2,}/g, " ");
  }
  return s.trim();
}

/** Adresse interne de l'app uniquement (« /… »), jamais un lien externe. */
export function safeUrl(url: unknown): string {
  const u = String(url ?? "").trim();
  return /^\/(?!\/)[^\s]*$/.test(u) ? u : "/";
}

/** Tag sûr (longueur bornée). */
export function safeTag(tag: unknown): string {
  return String(tag ?? "").replace(/\s+/g, "-").slice(0, 120) || "ttp";
}

/**
 * Construit la charge envoyée au service worker. `capitalize` met une majuscule à la
 * première lettre du texte (résumés assemblés avec « · »), jamais pour un mail.
 */
export function makePayload(p: PayloadInput, opts: { capitalize?: boolean } = {}): PushPayload {
  const mail = p.kind === "mail" || p.kind === "creator-mail";
  const title = clip(tidyText(p.title), TITLE_MAX) || "TTP Suite";
  let body = tidyText(p.body, mail);
  if (opts.capitalize) body = body.charAt(0).toUpperCase() + body.slice(1);
  body = mail ? body.split("\n").map((l) => clip(l, BODY_MAX)).join("\n") : clip(body, 140);
  const out: PushPayload = { title, body, url: safeUrl(p.url), tag: safeTag(p.tag), kind: p.kind, ts: p.ts ?? Date.now() };
  if (p.threadId) out.threadId = p.threadId;
  if (p.count && p.count > 1) out.count = Math.floor(p.count);
  if (p.image && /^https:\/\//.test(p.image)) out.image = p.image;
  if (p.lang) out.lang = p.lang;
  if (p.sender) out.sender = clip(tidyText(p.sender), 40);
  return out;
}

// ─── Adresses d'ouverture (miroir de src/lib/deepLink.ts) ────────────────────
export type MailBoxName = "partnerships" | "talent";
const THREAD_RE = /^[A-Za-z0-9_-]{1,64}$/;

const PAGE_RE = /^[a-z][a-z-]{1,24}$/;

/**
 * « /?open=mails&thread=…&box=… » (agence), « /?open=cs-mails&thread=… » (créateur),
 * « /?open=view&view=<page>&item=<id> » (page agence), « /?open=cs-tab&tab=<onglet>&item=<id> »
 * (onglet créateur). Une page ou un onglet invalide renvoie « / ».
 */
export function deepLinkUrl(
  l:
    | { open: "mails"; thread?: string; box?: MailBoxName }
    | { open: "cs-mails"; thread?: string }
    | { open: "view"; view: string; item?: string }
    | { open: "cs-tab"; tab: string; item?: string },
): string {
  const q = new URLSearchParams({ open: l.open });
  if (l.open === "view" || l.open === "cs-tab") {
    const page = l.open === "view" ? l.view : l.tab;
    if (!PAGE_RE.test(page)) return "/";
    q.set(l.open === "view" ? "view" : "tab", page);
    if (l.item && THREAD_RE.test(l.item)) q.set("item", l.item);
    return `/?${q.toString()}`;
  }
  if (l.thread && THREAD_RE.test(l.thread)) q.set("thread", l.thread);
  if (l.open === "mails" && l.thread && l.box) q.set("box", l.box);
  return `/?${q.toString()}`;
}

/** Topic Web Push (≤ 32 caractères base64url) : un push en attente du même fil est remplacé. */
export function pushTopic(tag: string): string {
  return tag.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 32);
}
