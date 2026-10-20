import { phaseOf, stepDef, type PhaseKey } from "@/lib/collabs";

/*
 * Page Mails (agence) : relier un fil à une collab EXISTANTE, sans rien inventer.
 *
 * Un fil correspond à une collab active quand :
 *   - la marque de la collab est celle d'un contact du fil (adresse exacte dans la
 *     table contacts, sinon même domaine d'entreprise), ou la marque corrigée à la main
 *     dans le suivi créateur (creator_mail_threads.brand) ;
 *   - ou le domaine de l'expéditeur porte le nom de la marque (saucony.fr → Saucony) ;
 *   - ou l'adresse du fil figure dans le champ « Contact marque » de la collab ;
 *   - ou le créateur dont l'alias est dans le fil a une collab avec une marque citée
 *     dans l'objet / le nom de l'expéditeur.
 * Si le créateur est connu, seules ses collabs sont gardées (quand il en a une).
 */

export type CollabLite = {
  id: string;
  brand: string;
  creator: string | null;
  contact: string | null;
  title: string | null;
  deliverables: string | null;
  cachet: string | null;
  step: number;
  status: string;
  updated_at?: string | null;
};

/** Marques connues par adresse et par domaine (table contacts). */
export type BrandIndex = { byEmail: Map<string, Set<string>>; byDomain: Map<string, Set<string>> };

export type ThreadClues = {
  /** Adresses du fil (expéditeurs, destinataires) ; celles de l'agence sont ignorées. */
  emails: string[];
  /** Créateur dont l'alias apparaît dans le fil. */
  creator?: string | null;
  /** Objet et noms affichés (pour reconnaître une marque citée). */
  text?: string;
  /** Marques déjà connues pour ce fil (suivi créateur). */
  brands?: (string | null | undefined)[];
};

const AGENCY_DOMAIN = "ttpcreators.pro";
/** Messageries grand public : un domaine partagé ne dit rien de la marque. */
const GENERIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "outlook.fr", "hotmail.com", "hotmail.fr", "live.com", "live.fr",
  "msn.com", "yahoo.com", "yahoo.fr", "icloud.com", "me.com", "mac.com", "orange.fr", "wanadoo.fr", "free.fr",
  "sfr.fr", "laposte.net", "neuf.fr", "bbox.fr", "aol.com", "proton.me", "protonmail.com", "gmx.fr", "gmx.com",
]);
/** Suffixes à deux niveaux (marque.co.uk) : la racine est avant. */
const TWO_LEVEL = new Set(["co", "com", "org", "net", "gouv"]);

/** « Saucony France » → « saucony france » (accents, casse, ponctuation). */
export function normBrand(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
const compact = (s: string) => normBrand(s).replace(/ /g, "");

export const domainOf = (email: string): string => {
  const i = email.lastIndexOf("@");
  return i < 0 ? "" : email.slice(i + 1).trim().toLowerCase();
};
const isAgency = (email: string) => {
  const d = domainOf(email);
  return d === AGENCY_DOMAIN || d.endsWith(`.${AGENCY_DOMAIN}`);
};
/** Domaine d'entreprise (ni messagerie grand public, ni l'agence). */
export function isCompanyDomain(d: string): boolean {
  return !!d && d.includes(".") && !GENERIC_DOMAINS.has(d) && d !== AGENCY_DOMAIN && !d.endsWith(`.${AGENCY_DOMAIN}`);
}
/** « news.saucony.fr » → « saucony » ; « brand.co.uk » → « brand ». */
export function domainRoot(d: string): string {
  const parts = d.toLowerCase().split(".").filter(Boolean);
  if (parts.length < 2) return "";
  const i = parts.length >= 3 && TWO_LEVEL.has(parts[parts.length - 2]) ? parts.length - 3 : parts.length - 2;
  return parts[i] ?? "";
}

export function buildBrandIndex(rows: { email?: string | null; brand?: string | null }[]): BrandIndex {
  const byEmail = new Map<string, Set<string>>();
  const byDomain = new Map<string, Set<string>>();
  const put = (m: Map<string, Set<string>>, k: string, v: string) => {
    const s = m.get(k);
    if (s) s.add(v);
    else m.set(k, new Set([v]));
  };
  for (const r of rows) {
    const email = String(r.email ?? "").trim().toLowerCase();
    const brand = normBrand(r.brand);
    if (!email.includes("@") || !brand || isAgency(email)) continue;
    put(byEmail, email, brand);
    const d = domainOf(email);
    if (isCompanyDomain(d)) put(byDomain, d, brand);
  }
  return { byEmail, byDomain };
}

const sameName = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Collabs actives qui correspondent au fil, la plus probable d'abord (liste vide = aucune). */
export function matchCollabs(clues: ThreadClues, index: BrandIndex | null, collabs: CollabLite[]): CollabLite[] {
  if (!collabs.length) return [];
  const emails = [...new Set(clues.emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@") && !isAgency(e)))];
  const brandKeys = new Set((clues.brands ?? []).map(normBrand).filter(Boolean));
  if (index) {
    for (const e of emails) {
      const exact = index.byEmail.get(e);
      if (exact) exact.forEach((b) => brandKeys.add(b));
      else {
        const d = domainOf(e);
        if (isCompanyDomain(d)) index.byDomain.get(d)?.forEach((b) => brandKeys.add(b));
      }
    }
  }
  const roots = new Set(emails.map(domainOf).filter(isCompanyDomain).map(domainRoot).filter((r) => r.length >= 3));
  const text = ` ${normBrand(clues.text)} `;
  const creator = clues.creator?.trim() || null;

  const found: { c: CollabLite; score: number; mine: boolean }[] = [];
  for (const c of collabs) {
    const key = normBrand(c.brand);
    if (!key) continue;
    const contact = (c.contact ?? "").toLowerCase();
    const byBrand = brandKeys.has(key) || roots.has(compact(c.brand)) || emails.some((e) => contact.includes(e));
    const mine = !!creator && sameName(c.creator, creator);
    // Créateur seul : la marque doit aussi être citée dans le fil (objet, expéditeur).
    const named = mine && !byBrand && key.length >= 3 && text.includes(` ${key} `);
    if (!byBrand && !named) continue;
    found.push({ c, score: (byBrand ? 2 : 0) + (mine ? 1 : 0), mine });
  }
  const kept = creator && found.some((f) => f.mine) ? found.filter((f) => f.mine) : found;
  return kept
    .sort((a, b) => b.score - a.score || String(b.c.updated_at ?? "").localeCompare(String(a.c.updated_at ?? "")))
    .map((f) => f.c);
}

// ── Étiquettes de la liste ─────────────────────────────────────────────────
export type MailTag = { key: string; label: string; cls: string; title?: string };

/** Couleur d'étiquette par phase de collab (tokens de l'app, lisibles en sombre). */
const PHASE_TAG: Record<PhaseKey, string> = {
  negociation: "bg-wait-soft text-wait",
  production: "bg-progress-soft text-progress",
  mesure: "bg-info-soft text-info",
  facturation: "bg-ok-soft text-ok",
  cloture: "bg-closed-soft text-closed",
};
export const phaseTagCls = (step: number) => PHASE_TAG[phaseOf(step)];

/** Étiquette « étape de la collab » (seulement si le fil désigne une seule étape). */
export function collabTag(matches: CollabLite[]): MailTag | null {
  if (!matches.length) return null;
  const step = matches[0].step;
  if (matches.some((m) => m.step !== step)) return null;
  const def = stepDef(step);
  return { key: "collab", label: def.short, cls: phaseTagCls(step), title: `Collab ${matches[0].brand} : étape ${def.n} sur 11, ${def.label}` };
}

const DAY = 86_400_000;
/** Au-delà, l'échange est considéré comme clos (pas de relance affichée). */
export const RELANCE_MAX_DAYS = 30;
export const RELANCE_MIN_DAYS = 7;
/** Jours depuis notre dernier message resté sans réponse (null = rien à relancer). */
export function relanceDays(t: { direction: "in" | "out"; ts: number }, now = Date.now()): number | null {
  if (t.direction !== "out" || !t.ts) return null;
  const d = Math.floor((now - t.ts) / DAY);
  return d >= RELANCE_MIN_DAYS && d <= RELANCE_MAX_DAYS ? d : null;
}

// ── Dossiers de couleur des créateurs ──────────────────────────────────────
const CREATOR_TONES = [
  "bg-violet-400", "bg-sky-400", "bg-emerald-400", "bg-amber-400", "bg-rose-400",
  "bg-cyan-400", "bg-indigo-400", "bg-orange-400", "bg-lime-400", "bg-fuchsia-400",
];
/** Couleur stable d'un créateur (même nom → même couleur, sur tous les appareils). */
export function creatorTone(name: string): string {
  const s = name.trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return CREATOR_TONES[h % CREATOR_TONES.length];
}
