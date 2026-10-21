// ============================================================================
// creator-mail/logic.ts : règles PURES (sans réseau) de la section « Mails »
// de l'Espace Créateur. Testées par src/lib/creatorMail.test.ts.
//
// Règle d'appartenance d'un fil à une créatrice (vérifiée CÔTÉ SERVEUR avant de
// renvoyer quoi que ce soit) : au moins un message « réel » (ni brouillon, ni
// corbeille, ni spam) du fil porte son libellé manuel, OU fait apparaître UNE de
// ses adresses (alias principal + adresses en plus, ex. son adresse perso) dans un
// en-tête d'adresse (From / To / Cc / Bcc / Delivered-To / X-Original-To / Reply-To).
// Dans un fil, la créatrice ne voit que les messages qui la concernent (concernedMessages).
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

/** Adresses d'une créatrice : une seule (texte) ou une liste. */
export type Addresses = string | readonly (string | null | undefined)[];

/**
 * Liste normalisée des adresses d'une créatrice : l'alias principal (s'il est valide)
 * puis les adresses en plus, en minuscules, sans doublon ni adresse invalide.
 */
export function addressList(alias: Addresses | null | undefined, extra?: readonly (string | null | undefined)[] | null): string[] {
  const all = [...(typeof alias === "string" || alias == null ? [alias] : alias), ...(extra ?? [])];
  const out: string[] = [];
  for (const a of all) {
    const n = normEmail(a);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
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

/** Le message concerne-t-il cette créatrice (une de ses adresses dans un en-tête OU libellé) ? */
export function messageMatches(m: GMessageLite, alias: Addresses, labelId: string | null | undefined): boolean {
  if (!isVisibleMessage(m)) return false;
  if (labelId && (m.labelIds ?? []).includes(labelId)) return true;
  const mine = addressList(alias);
  if (!mine.length) return false;
  for (const h of m.headers) {
    if (!ADDRESS_HEADERS.includes(h.name.toLowerCase())) continue;
    if (addressesIn(h.value).some((a) => mine.includes(a))) return true;
  }
  return false;
}

/** Le fil appartient-il à la créatrice ? (au moins un message visible correspondant) */
export function threadMatches(messages: GMessageLite[], alias: Addresses, labelId: string | null | undefined): boolean {
  return messages.some((m) => messageMatches(m, alias, labelId));
}

/**
 * Messages d'un fil que la créatrice a le droit de voir (dans l'ordre reçu) :
 *   • le fil porte son libellé (sur un message visible) → tous les messages visibles ;
 *   • sinon (accès par adresse) → seulement les messages visibles où une de ses adresses apparaît
 *     dans From / To / Cc / Bcc / Delivered-To / X-Original-To / Reply-To.
 * Un échange interne de l'agence dans le même fil, sans elle, reste donc caché.
 *
 * Avec `agencyDomain` : les RÉPONSES de l'agence à la marque dans ce fil s'affichent
 * aussi, même sans l'alias en copie (avant : « 1 message », la réponse paraissait
 * absente). Réponse = envoyée depuis le domaine de l'agence À une adresse extérieure
 * déjà présente dans les messages qui la concernent (la marque). Un transfert interne
 * (agence → agence) reste caché.
 */
export function concernedMessages<T>(
  items: T[], toLite: (item: T) => GMessageLite, alias: Addresses, labelId: string | null | undefined,
  agencyDomain?: string,
): T[] {
  const visible = items.filter((m) => isVisibleMessage(toLite(m)));
  if (labelId && visible.some((m) => (toLite(m).labelIds ?? []).includes(labelId))) return visible;
  const mine = visible.filter((m) => messageMatches(toLite(m), alias, null));
  if (!agencyDomain || !mine.length) return mine;
  const dom = "@" + agencyDomain.toLowerCase();
  const own = addressList(alias);
  const addrs = (m: GMessageLite, names: string[]) =>
    m.headers.filter((h) => names.includes(h.name.toLowerCase())).flatMap((h) => addressesIn(h.value));
  // Correspondants extérieurs de l'échange (la marque) : ni l'agence, ni le créateur.
  const outside = new Set<string>();
  for (const m of mine) for (const a of addrs(toLite(m), ADDRESS_HEADERS)) if (!a.endsWith(dom) && !own.includes(a)) outside.add(a);
  const agencyReply = (m: GMessageLite) =>
    addrs(m, ["from"]).some((a) => a.endsWith(dom)) && addrs(m, ["to", "cc"]).some((a) => outside.has(a));
  return visible.filter((m) => mine.includes(m) || agencyReply(toLite(m)));
}

/** Boîtes partagées de l'agence : jamais l'alias d'un créateur (il verrait les mails des autres). */
export const SHARED_LOCAL_PARTS = [
  "partnerships", "talent", "talents", "contact", "hello", "booking", "info", "admin", "noreply", "no-reply",
  "marc", "bonjour", "team",
];

/** L'adresse est-elle une boîte partagée de l'agence (partnerships@, talent@, contact@…) ? */
export function isSharedBox(address: string, agencyDomain: string): boolean {
  const a = normEmail(address);
  if (!a) return false;
  const [local, domain] = a.split("@");
  return domain === agencyDomain.toLowerCase() && SHARED_LOCAL_PARTS.includes(local);
}

/**
 * Alias refusé (→ section « non configurée ») : la boîte talent@ elle-même, une boîte
 * partagée, ou un alias déjà utilisé par un autre créateur (casse ignorée).
 */
export function aliasRefused(alias: string, opts: { talent: string; agencyDomain: string; otherAliases: (string | null | undefined)[] }): boolean {
  const a = normEmail(alias);
  if (!a) return false;
  if (opts.talent && a === normEmail(opts.talent)) return true;
  if (isSharedBox(a, opts.agencyDomain)) return true;
  return opts.otherAliases.some((o) => normEmail(o) === a);
}

/** Découpe un en-tête d'adresses sur les virgules hors guillemets et hors chevrons. */
export function splitAddressList(value: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  let angle = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "\\" && quoted && i + 1 < value.length) {
      cur += c + value[++i];
      continue;
    }
    if (c === '"') quoted = !quoted;
    else if (c === "<" && !quoted) angle = true;
    else if (c === ">" && !quoted) angle = false;
    if (c === "," && !quoted && !angle) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * To / Cc montrés à une créatrice : toute adresse de l'agence autre que les siennes
 * devient « TTP Creators » (une seule fois). Une adresse extérieure dont le nom
 * affiché cite une adresse de l'agence est réduite à l'adresse seule.
 */
export function maskAgencyAddresses(value: string, alias: Addresses, agencyDomain: string): string {
  if (!value.trim()) return value;
  const dom = "@" + agencyDomain.toLowerCase();
  const own = addressList(alias);
  const isOther = (a: string) => a.endsWith(dom) && !own.includes(a);
  const out: string[] = [];
  for (const entry of splitAddressList(value)) {
    const angle = /<([^<>]+)>\s*$/.exec(entry);
    const addr = (angle ? angle[1].trim().toLowerCase() : addressesIn(entry)[0]) ?? "";
    if (addr && isOther(addr)) {
      if (!out.includes("TTP Creators")) out.push("TTP Creators");
    } else if (addr && addressesIn(entry).some(isOther)) {
      out.push(addr);
    } else {
      out.push(entry);
    }
  }
  return out.join(", ");
}

/** Requête Gmail des fils où une des adresses apparaît (envoyés ET reçus). */
export function aliasQuery(alias: Addresses): string {
  const list = addressList(alias);
  if (!list.length) return "";
  return `{${list.map((a) => `to:${a} from:${a} cc:${a} deliveredto:${a}`).join(" ")}}`;
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

/** Adresse de la marque d'un fil (même ordre que brandOf), "" si aucune : sert à son logo. */
export function brandAddressOf(messages: GMessageLite[], agencyDomain: string): string {
  const dom = agencyDomain.toLowerCase();
  const isAgency = (addr: string) => addr.endsWith("@" + dom);
  for (const m of messages) {
    if (!isVisibleMessage(m)) continue;
    const fromAddr = addressesIn(header(m.headers, "From"))[0] ?? "";
    if (fromAddr && !isAgency(fromAddr)) return fromAddr;
    for (const h of ["To", "Cc"]) {
      const ext = addressesIn(header(m.headers, h)).find((a) => !isAgency(a));
      if (ext) return ext;
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
