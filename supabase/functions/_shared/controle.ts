// ============================================================================
// _shared/controle.ts : le contrôle qualité des données (logique PURE).
// ----------------------------------------------------------------------------
// L'audit du 23 nov. 2026 a montré que les données dérivaient parce que tout est
// coché à la main. Ce module repasse chaque jour sur les tables et renvoie la liste
// des incohérences, chacune avec un id stable, une gravité, un titre court, le
// détail, le lien vers l'élément et, quand elle est sûre, la correction à appliquer.
// UN seul code pour l'app (page Aujourd'hui, src/lib/controle.ts le réexporte) et
// pour le connecteur Claude (outil controle_donnees, lu par Alfred au point de 9 h).
// Une table qui n'a pas pu être lue est passée à null : ses règles sont sautées
// (une lecture ratée n'est jamais « tout est cassé »). Testé par controle.test.ts.
// Les lectures de montant sont des copies fidèles de src/lib/money.ts et de
// src/lib/collabLinks.ts (cachetCurrency) : src/lib/controle.test.ts vérifie qu'elles
// donnent les mêmes résultats.
// ============================================================================

import { foldName } from "./exclusivites.ts";

export type Gravite = "haute" | "moyenne" | "basse";

export type RegleId =
  | "brouillon_echu"
  | "publiee_sans_facture"
  | "etape_paiement"
  | "etape_reversement"
  | "paiement_avant_publication"
  | "createur_hors_roster"
  | "prospect_ouvert"
  | "cachet_illisible"
  | "brief_casse"
  | "tache_cochee"
  | "fiche_incomplete"
  | "etiquettes_contacts";

/** Où ouvrir l'élément dans l'app : une page (`vue`), l'objet visé, un créateur, une recherche. */
export type Lien = { vue: string; item?: string; createur?: string; recherche?: string };

/** Correction sûre, appliquée telle quelle par le bouton « Corriger » de l'app. */
export type Correction =
  | { type: "tache_fait"; todoId: string; texte: string }
  | { type: "brief_delier"; collabId: string; briefId: string; texte: string }
  | { type: "prospect_signe"; prospectId: string; collabId: string; texte: string };

export type Probleme = {
  /** Stable d'un jour à l'autre (« ignorer » s'en souvient) : « <règle>:<id de l'élément> ». */
  id: string;
  regle: RegleId;
  gravite: Gravite;
  /** 45 caractères au plus. */
  titre: string;
  detail: string;
  lien: Lien;
  /** Adresse complète du lien (pour Alfred et Telegram). */
  url: string;
  correction: Correction | null;
  /** Demande une décision de Marc (Alfred dépose une proposition) ; sinon un clic suffit. */
  decision: boolean;
};

export type CtrlCollab = {
  id: string;
  brand: string | null;
  creator: string | null;
  step: number | null;
  status: string | null;
  brief_id?: string | null;
  cachet?: string | null;
  created_at?: string | null;
};
export type CtrlStep = { collab_id: string; step: number; reached_at: string | null };
export type CtrlInvoice = {
  id: string;
  ref?: string | null;
  party?: string | null;
  amount?: string | null;
  /** Échéance (« AAAA-MM-JJ » ou ancien « jj/mm/aaaa »). */
  date?: string | null;
  status?: string | null;
  creator?: string | null;
  collab_id?: string | null;
  paid_at?: string | null;
};
export type CtrlCreator = {
  name: string;
  status?: string | null;
  email?: string | null;
  email_pro?: string | null;
  phone?: string | null;
  photo_url?: string | null;
  platform?: string | null;
};
export type CtrlProspect = {
  id: string;
  brand: string | null;
  stage: string | null;
  creator?: string | null;
  collab_id?: string | null;
  /** Proposition faite depuis Tarifs : son créateur compte quand `creator` est vide. */
  proposal?: { creator?: string | null } | null;
  created_at?: string | null;
};
export type CtrlTodo = { id: string; text: string | null; done: boolean | null; status?: string | null };
export type CtrlContact = { id: string; tag?: string | null };

export type ControleInput = {
  /** Jour de référence, « AAAA-MM-JJ » (heure de Paris). */
  aujourdhui: string;
  collabs: CtrlCollab[] | null;
  collabSteps: CtrlStep[] | null;
  /** null : pas lues (membre de l'équipe) : les règles d'argent sont sautées. */
  invoices: CtrlInvoice[] | null;
  creators: CtrlCreator[] | null;
  briefs: { id: string }[] | null;
  prospects: CtrlProspect[] | null;
  todos: CtrlTodo[] | null;
  contacts: CtrlContact[] | null;
  /** Blob `creatorPayouts` (versements par nom de créateur) ; null : pas lu. */
  payouts: Record<string, unknown> | null;
  /** Blob `collabCashMode` (« createur » : la marque paie le créateur, rien à reverser). */
  cashModes?: Record<string, string> | null;
  /** Blob `contractHistory` (contrats de représentation) ; null : pas lu, contrat non vérifié. */
  contractHistory: unknown | null;
};

// ── Réglages ─────────────────────────────────────────────────────────────────
export const APP_URL = "https://app.ttpcreators.pro";
export const TITRE_MAX = 45;
/** Collab publiée depuis plus de N jours sans facture. */
export const JOURS_SANS_FACTURE = 14;
export const ETAPE_PUBLICATION = 6;
export const ETAPE_STATS = 7;
export const ETAPE_PAIEMENT = 9;
export const ETAPE_REVERSEMENT = 10;
/** Clé du blob agence où vivent les problèmes masqués (« Ignorer »). */
export const IGNORES_KEY = "controleIgnores";
/** Étiquettes de la page Contacts (src/views/Contacts.tsx, TAG_OPTIONS). */
export const ETIQUETTES_CONTACTS = ["Marque", "Agence", "Agence RP", "Média", "PME", "Freelance", "Autre"];
/** Étiquettes posées par l'app elle-même (contact d'un créateur, demande reçue par le site). */
export const ETIQUETTES_SYSTEME = ["Perso", "Lead site"];
/** Étapes de prospect closes (Signé, ou perdu). */
const PROSPECT_CLOS = new Set(["signe", "perdue", "perdu"]);

const ORDRE_GRAVITE: Record<Gravite, number> = { haute: 0, moyenne: 1, basse: 2 };
const ORDRE_REGLE: RegleId[] = [
  "brouillon_echu",
  "publiee_sans_facture",
  "etape_reversement",
  "etape_paiement",
  "createur_hors_roster",
  "prospect_ouvert",
  "cachet_illisible",
  "brief_casse",
  "tache_cochee",
  "fiche_incomplete",
  "paiement_avant_publication",
  "etiquettes_contacts",
];

// ── Petits outils ────────────────────────────────────────────────────────────
const txt = (v: unknown) => String(v ?? "").trim();
/** « LÉNA TEST » → « Léna Test ». */
export const titleCase = (s: string | null | undefined) =>
  (s ?? "").toLocaleLowerCase("fr-FR").replace(/(^|[^\p{L}])(\p{L})/gu, (_m, p: string, c: string) => p + c.toLocaleUpperCase("fr-FR"));
/** Coupe à `max` caractères avec « … ». */
export function court(s: string, max = TITRE_MAX): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}
/** Même marque (sans accents, casse ni espaces : « Alo Yoga » = « aloyoga »). */
export const memeMarque = (a: string | null | undefined, b: string | null | undefined) => {
  const x = foldName(a).replace(/[ ']/g, "");
  const y = foldName(b).replace(/[ ']/g, "");
  return !!x && x === y;
};
/** « Marque × Créateur ». */
export const nomCollab = (c: Pick<CtrlCollab, "brand" | "creator">) => [txt(c.brand) || "Collab", titleCase(txt(c.creator)) || null].filter(Boolean).join(" × ");

/** Échéance « AAAA-MM-JJ », ancien « jj/mm[/aaaa] » (année de `aujourdhui` si absente), sinon "". */
export function dateIso(v: unknown, aujourdhui: string): string {
  const t = txt(v);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const fr = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t);
  if (!fr) return "";
  const y = fr[3] ? (fr[3].length === 2 ? "20" + fr[3] : fr[3]) : aujourdhui.slice(0, 4);
  return `${y}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}`;
}
/** Jours entre deux dates ISO (b − a). */
export function joursEntre(a: string, b: string): number {
  const [ya, ma, da] = a.slice(0, 10).split("-").map(Number);
  const [yb, mb, db] = b.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
}
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
/** « 21 oct. » (même format que fmtDay de l'app). */
export const jourCourt = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return m >= 1 && m <= 12 ? `${d} ${MOIS[m - 1]}` : iso;
};

/** Adresse d'ouverture dans l'app (même forme que src/lib/deepLink.ts). */
export function urlDe(l: Lien): string {
  const q = new URLSearchParams({ open: "view", view: l.vue });
  if (l.item && /^[A-Za-z0-9_-]{1,64}$/.test(l.item)) q.set("item", l.item);
  return `${APP_URL}/?${q.toString()}`;
}

// ── Montants (copies de src/lib/money.ts et src/lib/collabLinks.ts) ──────────
function readNumber(raw: string): number {
  let s = raw.replace(/[^0-9.,-]/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    s = (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot >= 0) {
    const dots = (s.match(/\./g) || []).length;
    const intPart = s.slice(0, s.indexOf(".")).replace("-", "");
    if (dots > 1 || (/^\d+\.\d{3}$/.test(s.replace("-", "")) && intPart !== "0")) s = s.replace(/\./g, "");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
function amountTokens(s: string): number[] {
  const joined = s.replace(/(\d)\s+(?=\d{3}(?!\d))/g, "$1");
  const out: number[] = [];
  for (const m of joined.matchAll(/(-?)(\d[\d.,]*)(?:\s*([kKmM])(?![a-zA-ZÀ-ÿ]))?/g)) {
    const mult = m[3] === "k" || m[3] === "K" ? 1e3 : m[3] === "m" || m[3] === "M" ? 1e6 : 1;
    const n = readNumber(m[2]) * mult;
    out.push(m[1] ? -n : n);
  }
  return out;
}
/** Copie de parseAmountStrict : null si vide, illisible, ambigu (plusieurs nombres) ou en dollars. */
export function parseAmountStrict(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (/\$|\busd\b|\bdollars?\b/i.test(String(x ?? ""))) return null;
  const tokens = amountTokens(String(x ?? ""));
  if (tokens.length !== 1) return null;
  const n = Math.round(tokens[0] * 100) / 100;
  return Number.isFinite(n) ? n : null;
}
/** Copie de cachetCurrency : devise écrite dans un cachet, sinon « EUR ». */
export function cachetCurrency(cachet: string | null | undefined): string {
  const t = String(cachet ?? "").toLowerCase();
  if (/\busd\b|\$|dollar/.test(t)) return "USD";
  if (/\bgbp\b|£|livre/.test(t)) return "GBP";
  if (/\bchf\b|franc suisse/.test(t)) return "CHF";
  return "EUR";
}
/** Gifting (même mots que src/lib/dealKind.ts) : pas de cachet à lire. */
const GIFT = /\b(gift(ing|ed)?|offert|offerte|offerts|cadeau|produits?|en [ée]change|sans r[ée]mun[ée]ration|non r[ée]mun[ée]r[ée]|b[ée]n[ée]vole|free)\b/i;
/** Devise étrangère que l'app ne sait pas lire (elle préparerait la facture en euros). */
const DEVISE_INCONNUE = /\b(cad|aud|aed|mad|jpy|cny|sek|nok|dkk|pln|sar|qar|tnd|dzd|xof|brl|mxn|inr|hkd|sgd|try|dirhams?|dinars?|yens?|yuans?|riyals?|reais|couronnes?|zlotys?)\b|[¥₹₺₩]/i;

/** « + affiliation », « affiliation seule » (même lecture que le champ cachet de l'app). */
const AFFILIATION = /\s*(?:\+|\bet\b|\bavec\b|,)?\s*\baffiliation\b(?:\s+seule(?:ment)?)?\s*/i;

/** Lecture d'un cachet : « gifting », « vide », « ok », « illisible » ou « devise ». */
export function lectureCachet(cachet: string | null | undefined): "vide" | "gifting" | "ok" | "illisible" | "devise" {
  const t = txt(cachet);
  if (!t || /^[—–-]+$/.test(t)) return "vide";
  // Formes du champ cachet de l'app : « Affiliation seule », « 550 € + affiliation ».
  const sansAffiliation = t.replace(AFFILIATION, " ").replace(/\s+/g, " ").trim();
  if (sansAffiliation !== t) {
    if (!sansAffiliation) return "ok";
    if (/\baffiliation\b/i.test(sansAffiliation)) return "illisible";
    return lectureCachet(sansAffiliation);
  }
  // « 10 % », « 15% des ventes » : un pourcentage, pas un montant.
  if (/%/.test(t)) return "illisible";
  const strict = parseAmountStrict(t);
  if (strict === 0) return "gifting";
  // Gifting, produits offerts : rien à lire, sauf un montant unique à côté (« 300 € + produits offerts »).
  if (GIFT.test(t) && !(strict != null && strict > 0)) return "gifting";
  if (cachetCurrency(t) !== "EUR") return /\d/.test(t) ? "ok" : "illisible";
  if (DEVISE_INCONNUE.test(t)) return "devise";
  if (strict != null && strict > 0) return "ok";
  // « 300 € + produits offerts » : un seul nombre lisible et des mots de gifting : rémunéré, lisible.
  return "illisible";
}

/** Copie de payoutNotedSince (src/lib/collabs.ts) : un versement noté pour ce créateur depuis cette date. */
export function versementDepuis(payouts: unknown, creator: string | null | undefined, depuis?: string | null): boolean {
  const who = foldName(creator);
  if (!who || !payouts || typeof payouts !== "object") return false;
  const since = String(depuis ?? "").slice(0, 10);
  for (const [k, list] of Object.entries(payouts as Record<string, unknown>)) {
    if (foldName(k) !== who || !Array.isArray(list)) continue;
    if (list.some((p) => (Number((p as { amount?: unknown })?.amount) || 0) > 0 && String((p as { date?: unknown })?.date ?? "").slice(0, 10) >= since)) return true;
  }
  return false;
}

/** Créateurs qui ont un contrat de représentation (blob `contractHistory` : `creator` ou nom du talent). */
export function createursSousContrat(history: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(history)) return out;
  for (const h of history as { creator?: unknown; config?: { talentNom?: unknown } }[]) {
    if (!h || typeof h !== "object") continue;
    for (const n of [h.creator, h.config?.talentNom]) {
      const k = foldName(String(n ?? ""));
      if (k) out.add(k);
    }
  }
  return out;
}

// ── Le contrôle ──────────────────────────────────────────────────────────────
const collabVivante = (c: CtrlCollab) => c.status !== "archivee" && c.status !== "perdue";
const collabEnCours = (c: CtrlCollab) => c.status === "active" || c.status === "gagnee";
/** Collab encore en cours de travail : active ou gagnée, avant l'étape 11 (bilan). */
const collabOuverte = (c: CtrlCollab) => collabEnCours(c) && (Number(c.step) || 0) < 11;

export function controler(input: ControleInput): Probleme[] {
  const out: Probleme[] = [];
  const today = input.aujourdhui;
  const add = (p: Omit<Probleme, "url" | "titre"> & { titre: string }) => out.push({ ...p, titre: court(p.titre), url: urlDe(p.lien) });
  const collabs = input.collabs ?? [];
  const collabLien = (c: CtrlCollab): Lien => ({ vue: "collabs", item: c.id });

  // 1. Facture en brouillon dont l'échéance est passée.
  for (const iv of input.invoices ?? []) {
    if (iv.status !== "brouillon") continue;
    const due = dateIso(iv.date, today);
    if (!due || due >= today) continue;
    const ref = txt(iv.ref) || "sans numéro";
    add({
      id: `brouillon_echu:${iv.id}`,
      regle: "brouillon_echu",
      gravite: "haute",
      titre: `Brouillon échu : facture ${ref}`,
      detail: `La facture ${ref}${txt(iv.party) ? ` (${txt(iv.party)})` : ""}${txt(iv.amount) ? `, ${txt(iv.amount)}` : ""} est encore en brouillon alors que son échéance du ${jourCourt(due)} est passée. L'émettre avec une nouvelle échéance, ou l'annuler.`,
      lien: { vue: "facturation", recherche: txt(iv.ref) || undefined },
      correction: null,
      decision: true,
    });
  }

  // Factures par collab (reliées par collab_id, sinon même créateur et même marque).
  const facturesDe = (c: CtrlCollab): CtrlInvoice[] =>
    (input.invoices ?? []).filter(
      (iv) => iv.status !== "annulee" && (iv.collab_id === c.id || (!iv.collab_id && !!txt(c.creator) && foldName(iv.creator) === foldName(c.creator) && memeMarque(txt(iv.party).split(/\s+(?:x|×|\/|-)\s+/i)[0], c.brand))),
    );

  // 2. Collab publiée (étape 6 ou 7) depuis plus de 14 jours sans facture.
  if (input.invoices && input.collabSteps) {
    const pub = new Map<string, string>();
    for (const s of input.collabSteps) {
      if (Number(s.step) < ETAPE_PUBLICATION || !s.reached_at) continue;
      const d = String(s.reached_at).slice(0, 10);
      const cur = pub.get(s.collab_id);
      if (!cur || d < cur) pub.set(s.collab_id, d);
    }
    for (const c of collabs) {
      const step = Number(c.step);
      if (!collabEnCours(c) || (step !== ETAPE_PUBLICATION && step !== ETAPE_STATS)) continue;
      const since = pub.get(c.id);
      if (!since) continue;
      const jours = joursEntre(since, today);
      if (jours <= JOURS_SANS_FACTURE) continue;
      const lu = lectureCachet(c.cachet);
      if (lu === "gifting" || lu === "vide") continue;
      if (facturesDe(c).length) continue;
      add({
        id: `publiee_sans_facture:${c.id}`,
        regle: "publiee_sans_facture",
        gravite: "haute",
        titre: `Sans facture : ${nomCollab(c)}`,
        detail: `Publiée le ${jourCourt(since)} (il y a ${jours} j), cachet ${txt(c.cachet)}, et aucune facture reliée. Préparer la facture depuis la collab.`,
        lien: collabLien(c),
        correction: null,
        decision: true,
      });
    }
  }

  // 3. Facture payée mais collab pas à l'étape 9 ; versement noté mais pas à l'étape 10.
  if (input.invoices) {
    for (const c of collabs) {
      const step = Number(c.step) || 0;
      if (!collabVivante(c) || step >= ETAPE_REVERSEMENT) continue;
      const payees = facturesDe(c).filter((iv) => iv.status === "payee" && iv.collab_id === c.id);
      if (!payees.length) continue;
      const paidDay = payees.map((iv) => txt(iv.paid_at).slice(0, 10) || dateIso(iv.date, today)).filter(Boolean).sort()[0] ?? "";
      const createurPaie = input.cashModes?.[c.id] === "createur";
      const verse = !createurPaie && input.payouts != null && versementDepuis(input.payouts, c.creator, paidDay || null);
      const refs = payees.map((iv) => txt(iv.ref)).filter(Boolean).join(", ");
      if (verse && step >= ETAPE_PAIEMENT) {
        add({
          id: `etape_reversement:${c.id}`,
          regle: "etape_reversement",
          gravite: "moyenne",
          titre: `Créateur payé, étape ${step} : ${nomCollab(c)}`,
          detail: `La facture${refs ? ` ${refs}` : ""} est payée et un versement à ${titleCase(txt(c.creator))} est noté dans Reversements${paidDay ? ` depuis le ${jourCourt(paidDay)}` : ""}, mais la collab est encore à l'étape ${step}. La passer à l'étape 10 « Créateur payé » si ce versement est bien le sien.`,
          lien: collabLien(c),
          correction: null,
          decision: true,
        });
      } else if (step >= ETAPE_PUBLICATION && step < ETAPE_PAIEMENT) {
        add({
          id: `etape_paiement:${c.id}`,
          regle: "etape_paiement",
          gravite: "moyenne",
          titre: `Facture payée, étape ${step} : ${nomCollab(c)}`,
          detail: `La facture${refs ? ` ${refs}` : ""} est payée${paidDay ? ` (${jourCourt(paidDay)})` : ""}, mais la collab est encore à l'étape ${step}. La passer à l'étape 9 « Paiement marque reçu ».`,
          lien: collabLien(c),
          correction: null,
          decision: true,
        });
      } else if (step < ETAPE_PUBLICATION) {
        // Avant la publication, c'est souvent un acompte : à savoir, pas une erreur.
        add({
          id: `paiement_avant_publication:${c.id}`,
          regle: "paiement_avant_publication",
          gravite: "basse",
          titre: `Payée avant publication : ${nomCollab(c)}`,
          detail: `La facture${refs ? ` ${refs}` : ""} est payée${paidDay ? ` (${jourCourt(paidDay)})` : ""} alors que la collab n'est qu'à l'étape ${step}. Un acompte : rien à faire ; sinon, avancer la collab.`,
          lien: collabLien(c),
          correction: null,
          decision: false,
        });
      }
    }
  }

  // 4. Collab dont le créateur n'existe pas dans le roster (une ligne par nom).
  if (input.creators) {
    const roster = new Set(input.creators.map((c) => foldName(c.name)).filter(Boolean));
    const absents = new Map<string, CtrlCollab[]>();
    for (const c of collabs) {
      const k = foldName(c.creator);
      if (!k || c.status === "archivee" || roster.has(k)) continue;
      absents.set(k, [...(absents.get(k) ?? []), c]);
    }
    for (const [k, list] of absents) {
      const nom = titleCase(txt(list[0].creator));
      add({
        id: `createur_hors_roster:${k.replace(/[^a-z0-9]+/g, "-")}`,
        regle: "createur_hors_roster",
        gravite: "moyenne",
        titre: `Hors roster : ${nom}`,
        detail: `${list.length > 1 ? `${list.length} collabs citent` : "La collab " + nomCollab(list[0]) + " cite"} « ${txt(list[0].creator)} », absent du roster : ses chiffres, sa commission et ses reversements ne se rattachent à personne. Corriger le nom dans la collab, ou ajouter le créateur au roster.`,
        lien: collabLien(list[0]),
        correction: null,
        decision: true,
      });
    }
  }

  // 5. Prospect encore ouvert alors qu'une collab en cours existe pour la marque et le créateur.
  // Pas une erreur : une collab bouclée (étape 11, terminée, archivée), un prospect créé APRÈS
  // la collab (un renouvellement), un prospect proposé pour un autre créateur.
  if (input.prospects && input.collabs) {
    const jour = (v: unknown) => txt(v).slice(0, 10);
    for (const p of input.prospects) {
      if (PROSPECT_CLOS.has(foldName(p.stage))) continue;
      const pour = txt(p.creator) || txt(p.proposal?.creator);
      const candidate = (c: CtrlCollab) =>
        collabOuverte(c) &&
        (!pour || foldName(pour) === foldName(c.creator)) &&
        !(jour(p.created_at) && jour(c.created_at) && jour(p.created_at) > jour(c.created_at));
      const linked = p.collab_id ? collabs.find((c) => c.id === p.collab_id) ?? null : null;
      if (p.collab_id && !(linked && candidate(linked))) continue;
      const matches = linked ? [linked] : collabs.filter((c) => memeMarque(c.brand, p.brand) && candidate(c));
      if (!matches.length) continue;
      const one = matches.length === 1 ? matches[0] : null;
      // « Corriger » seulement si l'ordre est sûr : prospect daté, créé le jour de la collab ou avant.
      const sure = !!one && !!jour(p.created_at) && !!jour(one.created_at);
      add({
        id: `prospect_ouvert:${p.id}`,
        regle: "prospect_ouvert",
        gravite: "moyenne",
        titre: `Prospect encore ouvert : ${txt(p.brand)}`,
        detail: `Le prospect ${txt(p.brand)} est encore « ${txt(p.stage) || "sans étape"} » alors que ${one ? `la collab ${nomCollab(one)} est en cours` : `${matches.length} collabs de la marque sont en cours`}. ${sure ? "Le passer en « Signé » et le relier à cette collab." : "Le passer en « Signé » sur la bonne collab depuis Prospection, si c'est bien ce deal."}`,
        lien: { vue: "prospection" },
        correction: sure && one ? { type: "prospect_signe", prospectId: p.id, collabId: one.id, texte: `Passer le prospect en « Signé », relié à ${nomCollab(one)}` } : null,
        decision: !sure,
      });
    }
  }

  // 6. Cachet illisible (montant introuvable ou ambigu) ou devise que l'app ne lit pas.
  for (const c of collabs) {
    if (!collabVivante(c)) continue;
    const lu = lectureCachet(c.cachet);
    if (lu !== "illisible" && lu !== "devise") continue;
    add({
      id: `cachet_illisible:${c.id}`,
      regle: "cachet_illisible",
      gravite: "moyenne",
      titre: `${lu === "devise" ? "Devise inconnue" : "Cachet illisible"} : ${nomCollab(c)}`,
      detail:
        lu === "devise"
          ? `Cachet « ${txt(c.cachet)} » : une devise que l'app ne reconnaît pas, la facture partirait en euros. Écrire le montant en euros, ou en USD, GBP ou CHF.`
          : `Cachet « ${txt(c.cachet)} » : l'app n'y lit pas un montant unique, la facture et les chiffres seraient faux. Écrire un seul montant (« 1 500 € HT »), ou « gifting ».`,
      lien: collabLien(c),
      correction: null,
      decision: true,
    });
  }

  // 7. Collab qui pointe vers un brief supprimé.
  if (input.briefs) {
    const ids = new Set(input.briefs.map((b) => String(b.id)));
    for (const c of collabs) {
      const b = txt(c.brief_id);
      if (!b || ids.has(b)) continue;
      add({
        id: `brief_casse:${c.id}`,
        regle: "brief_casse",
        gravite: "basse",
        titre: `Lien de brief cassé : ${nomCollab(c)}`,
        detail: `La collab ${nomCollab(c)} pointe vers un brief qui n'existe plus (supprimé). Retirer le lien ; un brief restauré depuis la Corbeille se relie de nouveau.`,
        lien: collabLien(c),
        correction: { type: "brief_delier", collabId: c.id, briefId: b, texte: "Retirer le lien vers le brief supprimé" },
        decision: false,
      });
    }
  }

  // 8. Tâche cochée dont le statut n'est pas « Fait ».
  for (const t of input.todos ?? []) {
    if (t.done !== true || txt(t.status) === "Fait") continue;
    add({
      id: `tache_cochee:${t.id}`,
      regle: "tache_cochee",
      gravite: "basse",
      titre: `Tâche cochée, statut ${txt(t.status) || "vide"}`,
      detail: `« ${txt(t.text)} » est cochée mais son statut est « ${txt(t.status) || "vide"} » : elle compte encore dans certains totaux. Passer son statut à « Fait ».`,
      lien: { vue: "todo", item: t.id },
      correction: { type: "tache_fait", todoId: t.id, texte: "Passer le statut à « Fait »" },
      decision: false,
    });
  }

  // 9. Créateur actif à la fiche incomplète (une ligne par créateur).
  if (input.creators) {
    const sousContrat = input.contractHistory != null ? createursSousContrat(input.contractHistory) : null;
    for (const c of input.creators) {
      if (foldName(c.status || "actif") !== "actif") continue;
      const manque = [
        !txt(c.email) && !txt(c.email_pro) ? "email" : null,
        !txt(c.phone) ? "téléphone" : null,
        !txt(c.photo_url) ? "photo" : null,
        !txt(c.platform) ? "plateforme" : null,
        sousContrat && !sousContrat.has(foldName(c.name)) ? "contrat de représentation" : null,
      ].filter((x): x is string => !!x);
      if (!manque.length) continue;
      add({
        id: `fiche_incomplete:${foldName(c.name).replace(/[^a-z0-9]+/g, "-")}`,
        regle: "fiche_incomplete",
        gravite: "basse",
        titre: `Fiche incomplète : ${titleCase(c.name)}`,
        detail: `Il manque : ${manque.join(", ")}.${manque.includes("contrat de représentation") ? " Le contrat se prépare dans Contrats, Représentation." : ""}`,
        lien: { vue: "roster", createur: c.name },
        correction: null,
        decision: false,
      });
    }
  }

  // 10. Étiquettes de contacts hors de la liste de la page Contacts (une seule ligne).
  if (input.contacts) {
    const hors = new Map<string, number>();
    for (const c of input.contacts) {
      const t = txt(c.tag);
      if (!t || ETIQUETTES_CONTACTS.includes(t) || ETIQUETTES_SYSTEME.includes(t)) continue;
      hors.set(t, (hors.get(t) ?? 0) + 1);
    }
    if (hors.size) {
      const n = [...hors.values()].reduce((s, x) => s + x, 0);
      const top = [...hors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, k]) => `« ${t} » (${k})`);
      add({
        id: "etiquettes_contacts:liste",
        regle: "etiquettes_contacts",
        gravite: "basse",
        titre: `${n} contact${n > 1 ? "s" : ""} avec une étiquette libre`,
        detail: `Étiquettes hors de la liste (${ETIQUETTES_CONTACTS.join(", ")}) : ${top.join(", ")}${hors.size > 6 ? "…" : ""}. Les ramener à une étiquette de la liste pour que les filtres marchent.`,
        lien: { vue: "contacts" },
        correction: null,
        decision: false,
      });
    }
  }

  return out.sort((a, b) => ORDRE_GRAVITE[a.gravite] - ORDRE_GRAVITE[b.gravite] || ORDRE_REGLE.indexOf(a.regle) - ORDRE_REGLE.indexOf(b.regle));
}

// ── Problèmes masqués (« Ignorer ») ──────────────────────────────────────────
export type Ignores = Record<string, { at?: string; by?: string } | true>;

/** Lit le blob `controleIgnores` (valeur bizarre → vide). */
export function lireIgnores(raw: unknown): Ignores {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Ignores) : {};
}
/** Retire les problèmes masqués. */
export function sansIgnores(list: Probleme[], ignores: Ignores): Probleme[] {
  return list.filter((p) => !ignores[p.id]);
}

/** Une ligne de texte par problème (connecteur Claude, Alfred). */
export function ligneProbleme(p: Probleme): string {
  const corr = p.correction ? ` · correction sûre : ${p.correction.texte} (bouton « Corriger » dans Aujourd'hui)` : "";
  return `- [${p.gravite}] ${p.titre} · ${p.detail}${corr} · décision de Marc : ${p.decision ? "oui" : "non"} · ${p.url} [controle ${p.id}]`;
}
