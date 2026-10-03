// ============================================================================
// creator-mail/logic.ts : règles PURES (sans réseau) de la section « Mails »
// de l'Espace Créateur. Testées par src/lib/creatorMail.test.ts.
//
// Règle d'appartenance d'un fil à une créatrice (vérifiée CÔTÉ SERVEUR avant de
// renvoyer quoi que ce soit) : au moins un message « réel » (ni brouillon, ni
// corbeille, ni spam) du fil porte son libellé manuel, OU fait apparaître son
// alias dans un en-tête d'adresse (From / To / Cc / Delivered-To / X-Original-To).
// ============================================================================

export type GHeader = { name: string; value: string };
export type GMessageLite = { labelIds?: string[]; headers: GHeader[] };

const ADDRESS_HEADERS = ["from", "to", "cc", "bcc", "delivered-to", "x-original-to", "reply-to"];
const HIDDEN_LABELS = ["DRAFT", "TRASH", "SPAM"];

/** Adresse e-mail normalisée (minuscules, sans espaces), "" si invalide. */
export function normEmail(s: string | null | undefined): string {
  const t = String(s ?? "").trim().toLowerCase();
  return /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(t) ? t : "";
}

/** Toutes les adresses présentes dans un en-tête (« Nom <a@b.c>, d@e.f »). */
export function addressesIn(value: string): string[] {
  const out: string[] = [];
  const re = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  for (const m of value.matchAll(re)) out.push(m[0].toLowerCase());
  return out;
}

/** Message visible ? (on ignore les brouillons, la corbeille et le spam). */
export function isVisibleMessage(m: GMessageLite): boolean {
  return !(m.labelIds ?? []).some((l) => HIDDEN_LABELS.includes(l));
}

/** Le message concerne-t-il cette créatrice (alias dans un en-tête OU libellé) ? */
export function messageMatches(m: GMessageLite, alias: string, labelId: string | null | undefined): boolean {
  if (!isVisibleMessage(m)) return false;
  if (labelId && (m.labelIds ?? []).includes(labelId)) return true;
  const a = normEmail(alias);
  if (!a) return false;
  for (const h of m.headers) {
    if (!ADDRESS_HEADERS.includes(h.name.toLowerCase())) continue;
    if (addressesIn(h.value).includes(a)) return true;
  }
  return false;
}

/** Le fil appartient-il à la créatrice ? (au moins un message visible correspondant) */
export function threadMatches(messages: GMessageLite[], alias: string, labelId: string | null | undefined): boolean {
  return messages.some((m) => messageMatches(m, alias, labelId));
}

/** Requête Gmail des fils où l'alias apparaît (envoyés ET reçus). */
export function aliasQuery(alias: string): string {
  const a = normEmail(alias);
  if (!a) return "";
  return `{to:${a} from:${a} cc:${a} deliveredto:${a}}`;
}

/** Valeur d'un en-tête (insensible à la casse). */
export function header(headers: GHeader[], name: string): string {
  const n = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === n)?.value ?? "";
}

/** Nom affichable d'un en-tête From (« Julie <j@x.com> » → « Julie », sinon l'adresse). */
export function displayName(from: string): string {
  const m = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(from);
  if (m && m[1].trim()) return m[1].trim();
  return addressesIn(from)[0] ?? from.trim();
}

/**
 * Marque d'un fil : le premier correspondant EXTERNE à l'agence (domaine différent
 * de agencyDomain). Nom d'affichage s'il existe, sinon le domaine en capitale.
 */
export function brandOf(messages: GMessageLite[], agencyDomain: string): string {
  const dom = agencyDomain.toLowerCase();
  const isAgency = (addr: string) => addr.endsWith("@" + dom);
  for (const m of messages) {
    if (!isVisibleMessage(m)) continue;
    const from = header(m.headers, "From");
    const fromAddr = addressesIn(from)[0] ?? "";
    if (fromAddr && !isAgency(fromAddr)) return prettyBrand(from, fromAddr);
    for (const h of ["To", "Cc"]) {
      const val = header(m.headers, h);
      const ext = addressesIn(val).find((a) => !isAgency(a));
      if (ext) {
        const part = val.split(",").find((p) => p.toLowerCase().includes(ext)) ?? ext;
        return prettyBrand(part, ext);
      }
    }
  }
  return "";
}

function prettyBrand(raw: string, addr: string): string {
  const name = displayName(raw);
  if (name && !name.includes("@")) return name;
  const domain = addr.split("@")[1] ?? "";
  const root = domain.split(".").slice(-2, -1)[0] ?? domain;
  return root ? root.charAt(0).toUpperCase() + root.slice(1) : addr;
}

export const MAIL_STATUSES = ["nouvelle", "negociation", "valide", "refuse"] as const;
export type MailStatus = (typeof MAIL_STATUSES)[number];
export function isMailStatus(s: unknown): s is MailStatus {
  return typeof s === "string" && (MAIL_STATUSES as readonly string[]).includes(s);
}

/** Rangement d'un échange choisi à la main : « En cours », « Validé » ou « Refusé ». */
export const MAIL_CHOICES = ["encours", "valide", "refuse"] as const;
export type MailChoice = (typeof MAIL_CHOICES)[number];
/** Choix reçu du client (« annuler », ancien nom de « En cours », reste accepté), sinon null. */
export function parseChoice(raw: unknown): MailChoice | null {
  const v = raw === "annuler" ? "encours" : raw;
  return typeof v === "string" && (MAIL_CHOICES as readonly string[]).includes(v) ? (v as MailChoice) : null;
}
/** Mot facultatif joint à un choix : sans espaces autour, 1000 caractères max, null si vide. */
export function cleanComment(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Découpe par caractère (pas par unité UTF-16) : un émoji n'est jamais coupé en deux.
  const t = Array.from(raw.trim()).slice(0, 1000).join("").trim();
  return t || null;
}
