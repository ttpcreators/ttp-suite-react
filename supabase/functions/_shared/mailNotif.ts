// ============================================================================
// _shared/mailNotif.ts : notifications de NOUVEAUX MAILS (règles pures).
// ----------------------------------------------------------------------------
// Comme Gmail / Mail d'Apple : une notification par fil (titre = l'expéditeur,
// texte = l'objet puis le début du message), qui REMPLACE la précédente du même fil
// (tag `mail:<threadId>`). Au-delà de 3 fils d'un coup : un seul résumé
// « 5 nouveaux mails » (tag `mail:summary`).
// Côté créateur : seulement les mails venus de l'EXTÉRIEUR et adressés à SES
// adresses (alias + adresses en plus), jamais un échange interne de l'agence.
// Sans réseau ni API Deno : testé par src/lib/pushPayload.test.ts.
// ============================================================================

import { clip, deepLinkUrl, makePayload, type MailBoxName, type PushPayload } from "./pushPayload.ts";

export type NewMail = {
  id: string;
  threadId: string;
  box: MailBoxName;
  from: string;
  subject: string;
  snippet: string;
  ts: number;
  to?: string;
  cc?: string;
  deliveredTo?: string;
  originalTo?: string;
  labelIds?: string[];
};

export type Lang = "fr" | "en";
export const MAX_THREAD_NOTIFS = 3;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", hellip: "…", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç" };

/** Entités HTML des extraits Gmail (« &#39; », « &amp; »…) → caractères. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * Extrait lisible : entités décodées, caractères invisibles retirés (lettres
 * d'information), citation du message précédent coupée, ~90 caractères.
 */
export function cleanSnippet(raw: string, max = 90): string {
  let s = decodeEntities(String(raw ?? ""))
    .replace(/͏/g, "")
    .replace(/[­؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ﻿ﾠ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Début de la citation d'une réponse : on garde seulement le nouveau texte.
  const quote = /\s*(?:Le\s.{4,90}?\sa\sécrit\s?:|On\s.{4,90}?\swrote:|-{2,}\s*(?:Original Message|Message d'origine)|De\s?:\s.{1,80}?\sEnvoyé\s?:)/i.exec(s);
  if (quote && quote.index > 0) s = s.slice(0, quote.index).trim();
  return clip(s, max);
}

/** Adresses présentes dans un en-tête, en minuscules. */
export function addressesIn(value: string | undefined): string[] {
  const out: string[] = [];
  for (const m of String(value ?? "").matchAll(/[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) out.push(m[0].toLowerCase());
  return out;
}

/** Nom affiché de l'expéditeur (« "Julie Durand" <j@x.com> » → « Julie Durand »), sinon l'adresse. */
export function senderName(from: string): string {
  const f = String(from ?? "").trim();
  const m = /^\s*(.*?)\s*<[^<>]*>\s*$/.exec(f);
  const name = (m ? m[1] : "").replace(/^"+|"+$/g, "").replace(/\\"/g, '"').trim();
  if (name && !/^[^@\s]+@[^@\s]+$/.test(name)) return name;
  return addressesIn(f)[0] ?? (f || "");
}

/** Boîte mentionnée discrètement dans le texte. */
export function boxLabel(box: MailBoxName): string {
  return box === "talent" ? "talent@" : "partnerships@";
}

export type MailGroup = { box: MailBoxName; threadId: string; latest: NewMail; count: number };

/** Regroupe par fil (boîte + fil), le plus récent d'abord. */
export function groupByThread(mails: NewMail[]): MailGroup[] {
  const map = new Map<string, MailGroup>();
  for (const m of mails) {
    const key = `${m.box}:${m.threadId || m.id}`;
    const g = map.get(key);
    if (!g) map.set(key, { box: m.box, threadId: m.threadId || m.id, latest: m, count: 1 });
    else {
      g.count++;
      if (m.ts > g.latest.ts) g.latest = m;
    }
  }
  return [...map.values()].sort((a, b) => b.latest.ts - a.latest.ts);
}

const T = {
  fr: { noSubject: "(sans objet)", many: (n: number) => `${n} nouveaux mails`, others: (n: number) => ` et ${n} autre${n > 1 ? "s" : ""}` },
  en: { noSubject: "(no subject)", many: (n: number) => `${n} new emails`, others: (n: number) => ` and ${n} more` },
};

/** « Julie Durand, Nike et 2 autres » : expéditeurs distincts, les plus récents d'abord. */
export function senderList(groups: MailGroup[], lang: Lang = "fr", shown = 3): string {
  const names: string[] = [];
  for (const g of groups) {
    const n = senderName(g.latest.from);
    if (n && !names.includes(n)) names.push(n);
  }
  const head = names.slice(0, shown).join(", ");
  return names.length > shown ? head + T[lang].others(names.length - shown) : head;
}

function threadTitle(g: MailGroup): string {
  const name = senderName(g.latest.from) || "Nouveau mail";
  return g.count > 1 ? `${name} (${g.count})` : name;
}

/** Notifications AGENCE pour les nouveaux mails d'un passage (au plus 3 fils, sinon un résumé). */
export function agencyMailPayloads(mails: NewMail[], max = MAX_THREAD_NOTIFS): PushPayload[] {
  if (!mails.length) return [];
  const groups = groupByThread(mails);
  if (groups.length > max) {
    return [makePayload({
      kind: "mail-summary",
      title: T.fr.many(mails.length),
      body: senderList(groups, "fr"),
      url: deepLinkUrl({ open: "mails" }),
      tag: "mail:summary",
      count: mails.length,
      ts: groups[0].latest.ts,
    })];
  }
  return groups.map((g) => {
    const snippet = cleanSnippet(g.latest.snippet);
    const subject = g.latest.subject.trim() || T.fr.noSubject;
    return makePayload({
      kind: "mail",
      title: threadTitle(g),
      body: `${subject}\n${boxLabel(g.box)}${snippet ? ` · ${snippet}` : ""}`,
      url: deepLinkUrl({ open: "mails", thread: g.threadId, box: g.box }),
      tag: `mail:${g.threadId}`,
      threadId: g.threadId,
      count: g.count,
      sender: senderName(g.latest.from),
      ts: g.latest.ts,
    });
  });
}

/** Notifications d'UN créateur (sa langue), même règle de regroupement. */
export function creatorMailPayloads(mails: NewMail[], lang: Lang = "fr", max = MAX_THREAD_NOTIFS): PushPayload[] {
  if (!mails.length) return [];
  const groups = groupByThread(mails);
  if (groups.length > max) {
    return [makePayload({
      kind: "creator-mail-summary",
      title: T[lang].many(mails.length),
      body: senderList(groups, lang),
      url: deepLinkUrl({ open: "cs-mails" }),
      tag: "mail:summary",
      count: mails.length,
      lang,
      ts: groups[0].latest.ts,
    })];
  }
  return groups.map((g) => {
    const snippet = cleanSnippet(g.latest.snippet);
    const subject = g.latest.subject.trim() || T[lang].noSubject;
    return makePayload({
      kind: "creator-mail",
      title: threadTitle(g),
      body: snippet ? `${subject}\n${snippet}` : subject,
      url: deepLinkUrl({ open: "cs-mails", thread: g.threadId }),
      tag: `mail:${g.threadId}`,
      threadId: g.threadId,
      count: g.count,
      sender: senderName(g.latest.from),
      lang,
      ts: g.latest.ts,
    });
  });
}

// ─── Mails des créateurs ─────────────────────────────────────────────────────
export type CreatorMailSetting = {
  creator: string;
  alias: string | null;
  aliases?: string[] | null;
  label_id?: string | null;
  enabled: boolean;
};

/** Boîtes partagées de l'agence : jamais l'adresse d'un créateur. */
const SHARED_LOCAL_PARTS = ["partnerships", "talent", "talents", "contact", "hello", "booking", "info", "admin", "noreply", "no-reply", "marc", "bonjour", "team"];
const HIDDEN_LABELS = ["DRAFT", "SPAM", "TRASH", "SENT"];

function normEmail(s: string | null | undefined): string {
  const t = String(s ?? "").trim().toLowerCase();
  return /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(t) ? t : "";
}

/** Adresses d'un créateur (alias + adresses en plus), sans boîte partagée de l'agence. */
export function creatorAddresses(s: CreatorMailSetting, agencyDomain: string): string[] {
  const dom = agencyDomain.toLowerCase();
  const out: string[] = [];
  for (const raw of [s.alias, ...(Array.isArray(s.aliases) ? s.aliases : [])]) {
    const a = normEmail(raw);
    if (!a || out.includes(a)) continue;
    const [local, domain] = a.split("@");
    if (domain === dom && SHARED_LOCAL_PARTS.includes(local)) continue;
    out.push(a);
  }
  return out;
}

/**
 * Créateurs à prévenir pour ce mail : Mail activé, mail venu de l'EXTÉRIEUR (jamais
 * d'une adresse de l'agence, ni du créateur lui-même) et adressé à l'une de ses
 * adresses (To / Cc / Delivered-To / X-Original-To) ou portant son libellé.
 */
export function creatorsForMail(m: NewMail, settings: CreatorMailSetting[], agencyDomain: string): string[] {
  const labels = m.labelIds ?? [];
  if (labels.some((l) => HIDDEN_LABELS.includes(l))) return [];
  const fromAddr = addressesIn(m.from)[0] ?? "";
  if (!fromAddr || fromAddr.endsWith("@" + agencyDomain.toLowerCase())) return [];
  const rcpt = new Set([...addressesIn(m.to), ...addressesIn(m.cc), ...addressesIn(m.deliveredTo), ...addressesIn(m.originalTo)]);
  const out: string[] = [];
  for (const s of settings) {
    if (!s.enabled || out.includes(s.creator)) continue;
    const addrs = creatorAddresses(s, agencyDomain);
    if (addrs.includes(fromAddr)) continue;
    const byAddress = addrs.some((a) => rcpt.has(a));
    const byLabel = !!s.label_id && labels.includes(s.label_id);
    if (byAddress || byLabel) out.push(s.creator);
  }
  return out;
}
