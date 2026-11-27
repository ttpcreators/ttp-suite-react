// ============================================================================
// _shared/exclusivites.ts : suivi des exclusivités des créateurs (logique PURE).
// ----------------------------------------------------------------------------
// Partagé par l'app (page Exclusivités, choix d'un créateur en prospection, en
// collab, en réponse à une marque) et par le connecteur Claude (ttp-mcp), pour
// que personne ne propose un créateur engagé en exclusivité avec un concurrent.
// Données : blob agence, clé `exclusivites` (liste d'objets à id). Testé par
// exclusivites.test.ts. Lecture des contrats (PDF ou contrats faits dans l'app) :
// règles fixes, sans IA (même choix que les tâches tirées des mails).
//
// Deux niveaux (alertesExclu), les mêmes partout où le registre est lu :
//  - « bloque » : exclusivité CONFIRMÉE, en cours ou à venir, qui cite la marque parmi les
//    concurrents, ou dont la catégorie se lit dans le nom (ou le secteur) de la marque ;
//  - « à vérifier » : ligne « à confirmer » (lue toute seule dans un contrat reçu par mail,
//    souvent une erreur de lecture) ou exclusivité confirmée sans aucun concurrent saisi. Ni
//    un feu vert ni un refus : on vérifie avant de proposer le créateur. Jamais présentée
//    comme une exclusivité sûre, jamais passée sous silence.
// ============================================================================

import { tagConnu } from "./contactTags.ts";
import { couper } from "./texteSur.ts";

export type Exclusivite = {
  id: string;
  /** Nom du créateur tel qu'au roster. */
  creator: string;
  /** Marque avec qui l'exclusivité est signée. */
  brand: string;
  /** Secteur ou catégorie interdite (« boissons énergisantes », « même catégorie de produits »). */
  scope: string;
  /** Marques concurrentes citées par le contrat (interdites pendant la période). */
  competitors: string[];
  /** AAAA-MM-JJ. */
  start: string;
  /** AAAA-MM-JJ, null = sans date de fin connue. */
  end: string | null;
  /** Points clés de la collab gardés en mémoire (droits, livrables, montant, délais…). */
  points: string[];
  collabId?: string | null;
  source: "manuel" | "contrat" | "pdf" | "mail";
  /** Lue toute seule dans un contrat reçu par mail : en attente de la confirmation de l'agence.
   *  Tant qu'elle n'est pas confirmée, elle ne bloque aucun créateur. */
  pending?: boolean;
  /** Phrase du contrat qui parle de l'exclusivité (lecture automatique). */
  quote?: string | null;
  /** Mail d'où vient le contrat (lien « Voir le mail »). */
  mail?: { threadId: string; box: string; subject?: string } | null;
  /** Référence du contrat de l'app, ou nom du PDF lu. */
  contractRef?: string | null;
  /** Chemin du PDF dans le bucket documents. */
  docPath?: string | null;
  createdAt: number;
};

/** Minuscules, sans accents ni ponctuation, espaces resserrés. */
export const foldName = (s: string | null | undefined) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’‘]/g, "'").toLowerCase().replace(/[^a-z0-9']+/g, " ").trim();

const sameBrand = (a: string, b: string) => {
  const x = foldName(a).replace(/ /g, "");
  const y = foldName(b).replace(/ /g, "");
  return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x))));
};

/** Liste lue dans le blob (valeurs bizarres écartées). */
export function readExclusivites(raw: unknown): Exclusivite[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Exclusivite[])
    .filter((e) => e && typeof e === "object" && typeof e.id === "string" && typeof e.creator === "string" && typeof e.brand === "string")
    .map((e) => ({
      ...e,
      scope: typeof e.scope === "string" ? e.scope : "",
      competitors: Array.isArray(e.competitors) ? e.competitors.filter((c) => typeof c === "string" && c.trim()) : [],
      points: Array.isArray(e.points) ? e.points.filter((p) => typeof p === "string" && p.trim()) : [],
      start: typeof e.start === "string" ? e.start.slice(0, 10) : "",
      end: typeof e.end === "string" && e.end ? e.end.slice(0, 10) : null,
    }));
}

export type ExcluState = "a_venir" | "en_cours" | "terminee";

/** État à une date (AAAA-MM-JJ). */
export function excluState(e: Pick<Exclusivite, "start" | "end">, today: string): ExcluState {
  if (e.start && e.start > today) return "a_venir";
  if (e.end && e.end < today) return "terminee";
  return "en_cours";
}

/** Jours restants (null sans date de fin). */
export function daysLeft(e: Pick<Exclusivite, "end">, today: string): number | null {
  if (!e.end) return null;
  return Math.round((Date.parse(`${e.end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}

// ── La catégorie interdite ───────────────────────────────────────────────────
/** Mots trop généraux pour dire un secteur (« même catégorie de produits », « autres marques »). */
const MOTS_VAGUES = new Set([
  "meme", "toute", "toutes", "tout", "tous", "categorie", "categories", "secteur", "secteurs", "produit", "produits",
  "marque", "marques", "autre", "autres", "concurrent", "concurrente", "concurrents", "concurrentes", "concurrence",
  "activite", "activites", "domaine", "domaines", "univers", "segment", "segments", "gamme", "gammes", "article",
  "articles", "service", "services", "notamment", "type", "types", "nature", "famille", "familles", "ligne", "lignes",
  "entreprise", "entreprises", "societe", "societes", "generale", "general", "grand", "grande", "public", "france",
  "monde", "industrie", "dans", "pour", "avec", "sans", "leur", "leurs", "chez", "entre", "vers", "plus", "cette",
  "industry", "sector", "category", "categories", "product", "products", "brand", "brands", "same", "other", "with",
]);

/**
 * Le mot qui dit chaque secteur interdit : le premier mot parlant de chaque partie
 * (« nutrition sportive et compléments alimentaires » → nutrition, complement ;
 * « produits de beauté » → beaute). Vide pour une catégorie vague (« même catégorie de produits »).
 */
export function termesSecteur(scope: string): string[] {
  const out: string[] = [];
  for (const part of foldName(scope).split(/\b(?:et|ou|and|or)\b/)) {
    const mot = part.split(" ").map((w) => w.replace(/^(?:d|l|qu)'/, "")).find((w) => w.length >= 4 && !MOTS_VAGUES.has(w) && !/\d/.test(w));
    const t = mot ? mot.replace(/(?<=.{4})[sx]$/, "") : "";
    if (t.length >= 4 && !out.includes(t)) out.push(t);
  }
  return out;
}

/** La catégorie interdite se lit-elle dans le nom de la marque (« Maison des Parfums » pour « parfum ») ? Le mot, sinon null. */
export function secteurDansNom(scope: string, brand: string): string | null {
  const nom = foldName(brand);
  if (!nom) return null;
  const mots = nom.split(" ");
  const colle = nom.replace(/ /g, "");
  return termesSecteur(scope).find((t) => mots.some((w) => w.startsWith(t)) || (t.length >= 6 && colle.includes(t))) ?? null;
}

/** Secteur d'une marque : jamais une catégorie de fiche contact (Marque, Agence, Média…), qui dit un type, pas un secteur. */
const estSecteur = (t: unknown): t is string => typeof t === "string" && foldName(t).length >= 4 && !tagConnu(t);

export type RaisonBloque = "concurrent" | "nom" | "secteur";

/**
 * Pourquoi la marque `brand` tombe sous cette exclusivité : citée parmi les concurrents, ou
 * catégorie interdite lue dans son nom, ou l'un de ses secteurs (`brandTags`) dans la catégorie.
 * null sinon, et toujours pour la marque de l'exclusivité elle-même.
 */
export function pourquoiBloque(e: Exclusivite, brand: string, brandTags: readonly string[] = []): RaisonBloque | null {
  if (!brand.trim() || sameBrand(e.brand, brand)) return null;
  if (e.competitors.some((c) => sameBrand(c, brand))) return "concurrent";
  const scope = foldName(e.scope);
  if (!scope) return null;
  if (secteurDansNom(e.scope, brand)) return "nom";
  return brandTags.filter(estSecteur).some((t) => {
    const f = foldName(t);
    return scope.includes(f) || f.includes(scope);
  }) ? "secteur" : null;
}

/**
 * Une marque `brand` tombe-t-elle sous cette exclusivité ? Oui si elle est citée parmi les
 * concurrents, si la catégorie interdite se lit dans son nom, ou si l'un de ses secteurs
 * (`brandTags`) correspond à la catégorie. Jamais pour la marque de l'exclusivité elle-même.
 */
export function hitsBrand(e: Exclusivite, brand: string, brandTags: readonly string[] = []): boolean {
  return pourquoiBloque(e, brand, brandTags) !== null;
}

/** Exclusivités CONFIRMÉES en cours ou à venir d'un créateur qui bloquent cette marque. */
export function conflictsFor(list: readonly Exclusivite[], creator: string, brand: string, today: string, brandTags: readonly string[] = []): Exclusivite[] {
  return list.filter((e) => !e.pending && foldName(e.creator) === foldName(creator) && excluState(e, today) !== "terminee" && hitsBrand(e, brand, brandTags));
}

/** Même créateur : même nom replié, ou un prénom seul égal au prénom de l'autre (« Zoé » et « ZOÉ X »). */
export function memeCreateur(a: string, b: string): boolean {
  const x = foldName(a);
  const y = foldName(b);
  if (!x || !y) return false;
  return x === y || (!x.includes(" ") && y.split(" ")[0] === x) || (!y.includes(" ") && x.split(" ")[0] === y);
}

export type NiveauExclu = "bloque" | "a_verifier";
export type PourquoiExclu = RaisonBloque | "a_confirmer" | "sans_concurrents" | "categorie";
export type AlerteExclu = { e: Exclusivite; niveau: NiveauExclu; pourquoi: PourquoiExclu };

/**
 * Ce que le registre dit avant de proposer `creator` (ou n'importe quel créateur, sans
 * `creator`) à la marque `brand`. Lignes en cours ou à venir, jamais pour la marque de
 * l'exclusivité elle-même :
 *  - confirmée qui touche la marque (pourquoiBloque) : « bloque » ;
 *  - confirmée sans aucun concurrent saisi : « à vérifier » (sans_concurrents), la catégorie ne
 *    se compare pas toute seule ;
 *  - confirmée avec des concurrents, avec `categories` : « à vérifier » (categorie), la liste
 *    n'est pas forcément complète (pour un contrôle fait exprès, verifier_exclusivite) ;
 *  - « à confirmer » qui touche la marque ou n'a aucun concurrent : « à vérifier » (a_confirmer),
 *    y compris une ligne sans créateur reconnu quand on demande pour un créateur précis.
 * Le créateur se compare avec memeCreateur (une ligne écrite au prénom seul compte aussi).
 */
export function alertesExclu(
  list: readonly Exclusivite[],
  brand: string,
  today: string,
  o: { creator?: string | null; brandTags?: readonly string[]; categories?: boolean } = {},
): AlerteExclu[] {
  if (!brand.trim()) return [];
  const qui = o.creator?.trim() ? o.creator : null;
  const out: AlerteExclu[] = [];
  for (const e of list) {
    if (excluState(e, today) === "terminee" || sameBrand(e.brand, brand)) continue;
    const sien = foldName(e.creator);
    if (qui && !memeCreateur(e.creator, qui) && !(e.pending && !sien)) continue;
    const p = pourquoiBloque(e, brand, o.brandTags ?? []);
    if (e.pending) {
      if (p || !e.competitors.length) out.push({ e, niveau: "a_verifier", pourquoi: "a_confirmer" });
    } else if (!sien) {
      continue; // confirmée sans créateur : la page ne le permet pas
    } else if (p) out.push({ e, niveau: "bloque", pourquoi: p });
    else if (!e.competitors.length) out.push({ e, niveau: "a_verifier", pourquoi: "sans_concurrents" });
    else if (o.categories && e.scope.trim()) out.push({ e, niveau: "a_verifier", pourquoi: "categorie" });
  }
  return out;
}

/** Début des raisons « à vérifier » des listes de créateurs (le choix d'un créateur ne les met pas en dernier). */
export const A_VERIFIER = "À vérifier";
export const estAVerifier = (raison: string | null | undefined) => !!raison && raison.startsWith(A_VERIFIER);

/**
 * Créateurs à vérifier pour une marque (lignes « à confirmer », exclusivités confirmées sans
 * concurrents) : nom (minuscules) → « À vérifier : exclu Nike non confirmée ». Ceux que
 * blockedCreators bloque déjà n'y sont pas ; une ligne sans créateur ne s'attache à personne.
 */
export function aVerifierCreators(list: readonly Exclusivite[], brand: string, today: string, brandTags: readonly string[] = []): Map<string, string> {
  const bloques = blockedCreators(list, brand, today, brandTags);
  const out = new Map<string, string>();
  for (const a of alertesExclu(list, brand, today, { brandTags })) {
    const k = a.e.creator.trim().toLowerCase();
    if (a.niveau !== "a_verifier" || !k || bloques.has(k) || out.has(k)) continue;
    out.set(k, `${A_VERIFIER} : exclu ${a.e.brand.trim() || "?"}${a.pourquoi === "a_confirmer" ? " non confirmée" : ""}`);
  }
  return out;
}

const finTexte = (e: Exclusivite) => (e.end ? ` jusqu'au ${e.end}` : "");

/** Une alerte en une phrase (Claude, page Exclusivités). */
export function texteAlerte(a: AlerteExclu, brand: string): string {
  const e = a.e;
  const marque = e.brand.trim() || "marque non lue";
  switch (a.pourquoi) {
    case "concurrent":
      return excluLine(e);
    case "nom":
      return `${excluLine(e)} : « ${secteurDansNom(e.scope, brand) ?? e.scope} » se lit dans le nom de ${brand}`;
    case "secteur":
      return `${excluLine(e)} : le secteur de ${brand} est dans la catégorie interdite`;
    case "a_confirmer": {
      const quote = e.quote?.trim() ? ` Phrase lue : « ${e.quote.length > 220 ? `${couper(e.quote, 219)}…` : e.quote} »` : "";
      return `exclusivité ${marque}${e.scope.trim() ? ` (catégorie « ${e.scope} »)` : ""}${e.start ? ` du ${e.start}` : ""}${e.end ? ` au ${e.end}` : ""} lue toute seule dans un contrat reçu par mail, jamais confirmée : peut-être une erreur de lecture.${quote}`;
    }
    case "sans_concurrents":
      return `exclusivité ${marque}${finTexte(e)} dans la catégorie « ${e.scope.trim() || "non précisée"} », sans liste de concurrents : vérifier que ${brand} n'en fait pas partie`;
    case "categorie":
      return `exclusivité ${marque}${finTexte(e)}, catégorie « ${e.scope} » : ses concurrents listés ne sont pas forcément tous, vérifier que ${brand} n'est pas de cette catégorie`;
  }
}

/** Ligne « à confirmer » pour Claude : « à vérifier : exclu Nike (lue dans un contrat, jamais confirmée) ». */
export function aVerifierLine(e: Exclusivite): string {
  return `à vérifier : ${excluLine({ ...e, brand: e.brand.trim() || "marque non lue" })}, lue toute seule dans un contrat reçu par mail et jamais confirmée (peut-être une erreur de lecture)`;
}

/**
 * Créateur demandé (prénom seul, autre casse, sans accents) → sa fiche parmi `noms` : nom
 * exact replié, puis prénom (ou début du nom), puis début d'un mot, puis morceau du nom.
 * Plusieurs fiches à la même étape : `plusieurs` (il faut le nom complet).
 */
export function trouverCreateur(noms: readonly string[], saisie: string): { nom: string } | { plusieurs: string[] } | { aucun: true } {
  const s = foldName(saisie);
  if (!s) return { aucun: true };
  const tous = [...new Set(noms.map((n) => String(n ?? "").trim()).filter(Boolean))];
  const etapes: ((f: string) => boolean)[] = [
    (f) => f === s,
    (f) => f.split(" ")[0] === s || f.startsWith(`${s} `),
    (f) => f.startsWith(s) || f.split(" ").some((w) => w.startsWith(s)),
    (f) => (s.length >= 3 && f.includes(s)) || (f.length >= 3 && s.includes(f)),
  ];
  for (const test of etapes) {
    // Deux écritures du même nom (« ZOÉ X », « Zoé X ») comptent pour une seule fiche : la première.
    const parNom = new Map<string, string>();
    for (const n of tous) if (test(foldName(n)) && !parNom.has(foldName(n))) parNom.set(foldName(n), n);
    const ok = [...parNom.values()];
    if (ok.length === 1) return { nom: ok[0] };
    if (ok.length > 1) return { plusieurs: ok };
  }
  return { aucun: true };
}

/** Créateurs bloqués pour une marque : nom (minuscules) → raison courte (« Exclu Nike · 12 déc. »). */
export function blockedCreators(
  list: readonly Exclusivite[],
  brand: string,
  today: string,
  brandTags: readonly string[] = [],
  fmtDate: (iso: string) => string = (d) => d,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of list) {
    if (e.pending || excluState(e, today) === "terminee" || !hitsBrand(e, brand, brandTags)) continue;
    const k = e.creator.trim().toLowerCase();
    if (!out.has(k)) out.set(k, `Exclu ${e.brand}${e.end ? ` · ${fmtDate(e.end)}` : ""}`);
  }
  return out;
}

/** Créateurs en exclusivité EN COURS (toutes marques) : pour prévenir dans les listes. */
export function activeByCreator(list: readonly Exclusivite[], today: string): Map<string, Exclusivite[]> {
  const out = new Map<string, Exclusivite[]>();
  for (const e of list) {
    if (e.pending || excluState(e, today) !== "en_cours") continue;
    const k = e.creator.trim().toLowerCase();
    out.set(k, [...(out.get(k) ?? []), e]);
  }
  return out;
}

/** Phrase pour Claude / un mail : « Léna : exclu Nike jusqu'au 2026-12-12 (secteur sport, concurrents Adidas, Puma). » */
export function excluLine(e: Exclusivite): string {
  const bits = [e.scope && `secteur ${e.scope}`, e.competitors.length && `concurrents ${e.competitors.join(", ")}`].filter(Boolean);
  return `exclu ${e.brand}${e.end ? ` jusqu'au ${e.end}` : " (sans date de fin)"}${bits.length ? ` (${bits.join(", ")})` : ""}`;
}

// ── Dates ─────────────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");
export const isoOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export function addToIso(iso: string, n: number, unit: "jours" | "mois"): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (unit === "jours") d.setUTCDate(d.getUTCDate() + n);
  else {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return isoOf(d);
}

// ── Contrats faits dans l'app (Contrats → Marque × Créateur) ─────────────────
/** Réglage « Exclusivité » du contrat de l'app → brouillon de suivi (null si « Aucune »). */
export function fromAppContract(c: {
  id: string; ctName: string; brand: string; ref?: string; ts: number;
  form?: { exclScope?: string; excl?: boolean; duration?: string; deliverables?: string; value?: string; rights?: string; rightsDuration?: string };
}, months?: number | null): Omit<Exclusivite, "id" | "createdAt"> | null {
  const f = c.form ?? {};
  const scope = f.exclScope ?? (f.excl ? "cat30" : "non");
  if (!scope || scope === "non") return null;
  const start = isoOf(new Date(c.ts));
  const end = scope === "cat30" ? addToIso(start, 30, "jours") : scope === "cat90" ? addToIso(start, 90, "jours") : months ? addToIso(start, months, "mois") : null;
  const points = [
    f.deliverables && `Livrables : ${f.deliverables}`,
    f.value && `Montant : ${f.value}`,
    f.rightsDuration && f.rights && f.rights !== "aucun" ? `Droits d'usage : ${f.rights}, ${f.rightsDuration}` : "",
  ].filter((x): x is string => !!x);
  return {
    creator: c.ctName, brand: c.brand,
    scope: scope === "total" ? "même secteur d'activité" : "même catégorie de produits",
    competitors: [], start, end, points, source: "contrat", contractRef: c.ref ?? null, docPath: null, collabId: null,
  };
}

// ── Lecture d'un contrat PDF (texte extrait), sans IA ────────────────────────
export type ContractReading = {
  creator: string | null;
  brand: string | null;
  exclusivity: { quote: string; scope: string; competitors: string[]; start: string | null; end: string | null } | null;
  points: string[];
};

const MONTHS: Record<string, number> = {
  janvier: 1, january: 1, fevrier: 2, february: 2, mars: 3, march: 3, avril: 4, april: 4, mai: 5, may: 5, juin: 6, june: 6,
  juillet: 7, july: 7, aout: 8, august: 8, septembre: 9, september: 9, octobre: 10, october: 10, novembre: 11, november: 11,
  decembre: 12, december: 12,
};
/** Première date écrite (« 12 novembre 2026 », « 12/11/2026 », « 2026-11-12 ») → AAAA-MM-JJ. */
export function firstDate(text: string): string | null {
  const t = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const iso = /\b(20\d\d)-(\d{1,2})-(\d{1,2})\b/.exec(t);
  if (iso) return `${iso[1]}-${pad(+iso[2])}-${pad(+iso[3])}`;
  const fr = /\b(\d{1,2})(?:er)?\s+(janvier|january|fevrier|february|mars|march|avril|april|mai|may|juin|june|juillet|july|aout|august|septembre|september|octobre|october|novembre|november|decembre|december)\s+(20\d\d)\b/.exec(t);
  if (fr) return `${fr[3]}-${pad(MONTHS[fr[2]])}-${pad(+fr[1])}`;
  const num = /\b(\d{1,2})[/.](\d{1,2})[/.](20\d\d)\b/.exec(t);
  if (num && +num[2] <= 12) return `${num[3]}-${pad(+num[2])}-${pad(+num[1])}`;
  return null;
}

const NUMBERS: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, douze: 12, quinze: 15, trente: 30, soixante: 60, quatrevingt: 80, quatrevingtdix: 90, one: 1, two: 2, three: 3, four: 4, twelve: 12, thirty: 30, sixty: 60, ninety: 90 };

/** Durée écrite (« 3 mois », « trente (30) jours », « 6 months ») → { n, unit }. */
export function findDuration(text: string): { n: number; unit: "jours" | "mois" } | null {
  const t = foldName(text).replace(/quatre vingt dix/g, "quatrevingtdix").replace(/quatre vingt/g, "quatrevingt");
  const m = /\b(\d{1,3}|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|douze|quinze|trente|soixante|quatrevingt|quatrevingtdix|one|two|three|four|twelve|thirty|sixty|ninety)(?: \d{1,3})? (jours?|days?|mois|months?|semaines?|weeks?|ans?|annees?|years?)\b/.exec(t);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBERS[m[1]] ?? 0;
  if (!n) return null;
  const u = m[2];
  if (/^(semaine|week)/.test(u)) return { n: n * 7, unit: "jours" };
  if (/^(an|annee|year)/.test(u)) return { n: n * 12, unit: "mois" };
  return { n, unit: /^(mois|month)/.test(u) ? "mois" : "jours" };
}

// ── Clause d'exclusivité : ce qui en est une, et ce qui dit le contraire ─────
// Tout se lit sur le texte replié (foldName : minuscules, sans accents, apostrophes gardées).
// Avant (lignes « à confirmer » de novembre 2026) : « non exclusive », « sans aucune
// exclusivité » ou « exclusivement » suffisaient à proposer une exclusivité.

/** Tournures qui disent qu'il n'y a PAS d'exclusivité : retirées avant de chercher la clause. */
const NEGATIONS: RegExp[] = [
  // « Exclusivité : non », « Exclusivité : aucune », « Exclusivité : non exclusif » (pas « aucune marque concurrente »).
  /\b(?:l'|d')?exclusivit\w*(?: \S+){0,2}? (?:aucune?|neant|none|non(?: ?exclusi\w*)?)\b(?!(?: \S+){0,3}? (?:marques?|concurren\w*|compet\w*|autres?|other)\b)/g,
  // « exclusivement » veut dire « seulement » (« payée exclusivement en produits »).
  /\bexclusivement\b/g,
  // « non exclusive », « non-exclusif », « nonexclusive », « non exclusivité ».
  /\bnon ?exclusi\w*/g,
  // « sans (aucune) exclusivité », « aucune clause d'exclusivité », « pas d'exclusivité », « n'est pas
  // consentie à titre exclusif », « absence d'exclusivité », « no exclusivity », « not an exclusive »,
  // « aucune clause de non-concurrence ». Pas « sans préjudice de l'exclusivité » ni « ne pourra pas
  // rompre l'exclusivité », qui la confirment.
  /\b(?:sans(?! prejudice\b)|aucune?|d'aucune?|absence|pas(?! (?:rompre|violer|enfreindre|porter|contrevenir|remettre|deroger|meconnaitre|nuire)\b)|ni|nulle|nullement|jamais|no|without(?! prejudice\b)|not|never)(?: \S+){0,3}? (?:d'|l')?(?:exclusi\w*|non ?concurren\w*|non ?compet\w*)/g,
  // « libre de toute exclusivité », « exempt de toute exclusivité ».
  /\b(?:libres?|exempte?s?|degagee?s?) de toute (?:clause d'|obligation d')?exclusi\w*/g,
];

/** Le mot dans un autre sens : licence ou cession sur les contenus, tribunal compétent, propriété, responsabilité. */
const AUTRES_SENS: RegExp[] = [
  /\b(?:licence|license|cession|exploitation|droits? d'(?:exploitation|utilisation|usage|auteur|diffusion|reproduction)|competence|juridiction|jurisdiction|tribunaux?|responsabilite|responsibility|propriete|property|proprietaire|owner|titulaire|charge|frais)(?: \S+){0,4}? (?:d'|l')?exclusi\w*/g,
  /\bexclusi\w*(?: \S+)? (?:licence|license|cession|competence|juridiction|jurisdiction|responsabilite|responsibility|propriete|property|proprietaire|owner|titulaire)\b/g,
];

/** Mots qui disent à eux seuls une exclusivité. */
const FORTE = /\b(?:l'|d')?exclusi(?:f|fs|ve|ves|vite|vites|vity|vities)\b|\bnon ?concurren|\bnon ?compet/;
/** Une interdiction… */
const INTERDIT =
  /\bs'interdi|\binterdi(?:t|te|ts|tes|ction)\b|\bs'engage\w* a ne\b|\bs'abst|\bne (?:pourra|pourront|peut|peuvent|doit|devra|devront|saurait|fera|signera|acceptera|collaborera|travaillera)\b|\bn'(?:accepte|acceptera|accepteront|engagera|aura)\b|\baucune? (?:\S+ ){0,2}?(?:collaboration|partenariat|contrat|campagne|prestation|promotion|publication|concurren\w*)|\bpas de (?:\S+ ){0,2}?concurren\w*|\bshall not\b|\bmust not\b|\bmay not\b|\bwill not\b|\bagrees? not to\b|\bundertakes? not to\b|\bnot to (?:promote|work|endorse|collaborate|partner|advertise)\b|\brefrain/;
/** … qui vise des concurrents : avec INTERDIT, une clause d'exclusivité sans le mot. */
const RIVAL =
  /\bconcurren|\bcompeting\b|\bcompetitors?\b|\bcompetitive\b|\brival|\b(?:autres?|other) (?:marques?|brands?|annonceurs?|entreprises?|societes?|partenaires?)\b|\bmeme (?:categorie|secteur|segment|domaine|univers)\b|\bsame (?:category|sector|industry|segment)\b|\btiers? (?:du|de la) meme\b/;
/** « reste libre de collaborer avec des marques concurrentes » : le contraire d'une exclusivité. */
const LIBRE = /\b(?:libre|librement|liberte|free|freely)(?: \S+){0,3}? (?:collabor|travaill|contract|partenari|s'associer|promouv|conclure|work|partner|promot|engag)\w*/;

/** La phrase dit-elle qu'il n'y a pas d'exclusivité (« non exclusive », « aucune exclusivité »…) ? */
export function nieExclusivite(phrase: string): boolean {
  const t = ` ${foldName(phrase)} `;
  return NEGATIONS.some((re) => t.replace(re, " ") !== t);
}

/**
 * Clause d'exclusivité dans cette phrase ? « forte » : le mot (exclusivité, exclusif,
 * non-concurrence) employé pour le créateur ; « faible » : une interdiction qui vise des
 * concurrents (« s'interdit toute collaboration avec une marque concurrente »). null sinon,
 * et quand la phrase dit le contraire.
 */
export function clauseExclusivite(phrase: string): "forte" | "faible" | null {
  let t = ` ${foldName(phrase)} `;
  for (const re of [...NEGATIONS, ...AUTRES_SENS]) t = t.replace(re, " ");
  if (FORTE.test(t)) return "forte";
  if (INTERDIT.test(t) && RIVAL.test(t) && !LIBRE.test(t)) return "faible";
  return null;
}

/**
 * Phrase lue qui ne prouve pas une exclusivité : elle dit le contraire, ou ne parle ni
 * d'exclusivité ni d'interdiction. À confirmer seulement après avoir relu le contrat.
 */
export function phraseDouteuse(phrase: string): boolean {
  if (nieExclusivite(phrase)) return true;
  return !clauseExclusivite(phrase) && !INTERDIT.test(` ${foldName(phrase)} `);
}

/** Titre d'article (« Article 6 – Exclusivité », « 6. Exclusivité ») : ouvre un article, n'est pas une clause. */
const estEntete = (s: string) => s.length <= 80 && /^(?:art(?:icle|\.)\s*\d+|\d{1,2}(?:\.\d{1,2})?\s*[.)–-]\s)/i.test(s.trim());

/** Marques citées après « notamment », « tels que », « such as », « à savoir »… */
function listedBrands(sentence: string): string[] {
  const m = /(?:notamment|tels? que|telles? que|such as|including|a savoir|comme|par exemple|e\.g\.)\s*:?\s*([^.;]+)/i.exec(sentence.normalize("NFD").replace(/[̀-ͯ]/g, ""));
  if (!m) return [];
  return m[1]
    .split(/,|\bet\b|\band\b|\bou\b|\bor\b|\//i)
    .map((s) => s.replace(/[()«»"“”]/g, "").trim())
    .filter((s) => s.length >= 2 && s.length <= 30 && /^[A-Z0-9]/.test(s));
}

/** Secteur écrit après « secteur », « catégorie », « marques de/du »… */
function sectorOf(sentence: string): string {
  const f = foldName(sentence);
  const m = /\b(?:secteur|categorie|category|domaine|industry|sector|segment|univers)(?: d'activite)?(?: de| des| du| d'| of| :)?\s+(?:la |le |les |l')?([a-z0-9' ]{3,60}?)(?=\s+(?:pendant|pour|durant|a compter|des|jusqu|during|for|until|from|sur|notamment|tels?|telles?|such|including|comme|par exemple|,)|$)/.exec(f);
  if (m) return m[1].trim();
  const m2 = /\bmarques? (?:concurrentes? )?(?:de|du|des|d'|dans le|dans la|of)\s+(?:la |le |les |l')?([a-z0-9' ]{3,40}?)(?=\s+(?:pendant|pour|durant|a compter|des|jusqu|during|for|until|notamment|tels?|telles?|such|including|comme|,)|$)/.exec(f);
  return m2 ? m2[1].trim() : "";
}

/**
 * Lit le texte d'un contrat : créateur et marque (cherchés parmi les noms connus), clause
 * d'exclusivité (secteur, concurrents, début, fin) et points clés (montant, livrables,
 * droits d'usage, délai de paiement, territoire, résiliation). `signed` = date du contrat
 * si connue (début par défaut).
 */
export function readContract(text: string, known: { creators: readonly string[]; brands: readonly string[] }, today: string): ContractReading {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = clean.split(/(?<=[.;!?])\s+(?=[A-ZÀ-ÖØ-Ý0-9«"(•\-–])|\s+(?=(?:Art(?:icle|\.)\s*\d+))/).map((s) => s.trim()).filter((s) => s.length > 8);
  const f = ` ${foldName(clean)} `;
  const findKnown = (names: readonly string[]) =>
    [...names].sort((a, b) => b.length - a.length).find((n) => {
      const k = foldName(n);
      if (k.length < 3) return false;
      return f.includes(` ${k} `) || f.includes(` ${k.split(" ")[0]} ${k.split(" ").slice(-1)[0]} `);
    }) ?? null;
  const creator = findKnown(known.creators);
  const brand = findKnown(known.brands);

  // Exclusivité : les phrases qui en sont une (jamais celles qui disent le contraire). Dans un
  // article titré « Exclusivité », une phrase qui interdit ou donne une durée en fait partie.
  // Un article dont une phrase dit « aucune exclusivité » ne compte que par ses vraies clauses.
  type Lue = { s: string; k: "forte" | "faible"; entete: boolean; contexte: boolean; article: number };
  const lues: Lue[] = [];
  const articlesNies = new Set<number>();
  let article = -1;
  let articleExclu = false;
  sentences.forEach((s, i) => {
    const entete = estEntete(s);
    const k = clauseExclusivite(s);
    if (entete) {
      article = i;
      articleExclu = k === "forte";
    }
    if (nieExclusivite(s) && article >= 0) articlesNies.add(article);
    if (k) lues.push({ s, k, entete, contexte: false, article });
    else if (articleExclu && !entete && !nieExclusivite(s) && (INTERDIT.test(` ${foldName(s)} `) || findDuration(s))) lues.push({ s, k: "faible", entete, contexte: true, article });
  });
  const excl = lues.filter((x) => !((x.entete || x.contexte) && articlesNies.has(x.article)));
  let exclusivity: ContractReading["exclusivity"] = null;
  if (excl.length) {
    // La phrase citée : une vraie phrase (pas un titre), avec une durée si possible, le mot « exclusivité » d'abord.
    const rang = (x: Lue) => (x.entete ? 4 : 0) + (findDuration(x.s) ? 0 : 2) + (x.k === "forte" ? 0 : 1);
    const best = [...excl].sort((a, b) => rang(a) - rang(b))[0].s;
    const around = excl.map((x) => x.s).join(" ");
    const signedAt = firstDate(clean);
    const start = firstDate(best) ?? signedAt ?? today;
    const dur = findDuration(best) ?? findDuration(around);
    const endWritten = /jusqu'?(?:au|a)|until|ending/.test(foldName(best)) ? firstDate(best.split(/jusqu|until|ending/i).slice(1).join(" ")) : null;
    exclusivity = {
      // Citations coupées sans casser d'emoji (_shared/texteSur.ts) : elles vont en base.
      quote: best.length > 400 ? `${couper(best, 399)}…` : best,
      scope: sectorOf(best) || sectorOf(around) || (/(meme categorie|same category)/.test(foldName(around)) ? "même catégorie de produits" : ""),
      competitors: [...new Set(excl.flatMap((x) => listedBrands(x.s)))].slice(0, 12),
      start,
      end: endWritten ?? (dur ? addToIso(start, dur.n, dur.unit) : null),
    };
  }

  // Points clés : une phrase courte par sujet.
  // Minuscules sans accents, symboles gardés (« € ») ; une vraie phrase plutôt qu'un titre d'article.
  const low = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’‘]/g, "'").toLowerCase();
  const pick = (re: RegExp, label: string) => {
    const hits = sentences.filter((x) => re.test(low(x)));
    const s = hits.find((x) => x.length >= 40) ?? hits[0];
    if (!s) return null;
    const short = s.length > 180 ? `${couper(s, 179)}…` : s;
    return `${label} : ${short}`;
  };
  const points = [
    pick(/(\d[\d  .,]*\s?(€|eur\b|euros\b)|(remuneration|montant|prix|fee|compensation)[^.]{0,60}\d)/, "Montant"),
    pick(/\b(\d+|un|une|deux|trois)\s+(reels?|stor(y|ies)|posts?|videos?|tiktoks?|publications?|contenus?|shorts?)\b/, "Livrables"),
    pick(/\b(droits? d'(usage|utilisation|exploitation)|cession|usage rights|paid (media|ads)|whitelisting|ads)\b/, "Droits d'usage"),
    pick(/\b(paiement|payment|payable|regle(ment)?|facture)[^.]{0,80}\b(\d+)\s*(jours|days)\b/, "Paiement"),
    pick(/\b(territoire|territory|monde entier|worldwide|union europeenne)\b/, "Territoire"),
    pick(/\b(resiliation|termination|resilier)\b/, "Résiliation"),
  ].filter((x): x is string => !!x);

  return { creator, brand, exclusivity, points };
}

// ── Contrats reçus par mail ─────────────────────────────────────────────────

const CONTRACT_RE = /\b(contrats?|contracts?|agreements?|avenants?|accords? de (partenariat|collaboration)|conventions?|docusign|yousign|terms of collaboration|bon de commande signe)\b/;

/** Modèle vierge (« …_Template.pdf », « … Vierge.pdf ») : pas le contrat de quelqu'un, rien à suivre. */
const MODELE_RE = /\b(?:template|vierge|blank|exemple|example|specimen|sample)\b/;

/** Pièce jointe qui ressemble à un contrat : un PDF dont le nom ou l'objet du mail parle de contrat, sauf un modèle vierge. */
export function looksLikeContract(fileName: string, subject: string): boolean {
  if (!/\.pdf$/i.test(fileName.trim())) return false;
  const nom = foldName(fileName.replace(/[_\-.]+/g, " "));
  if (MODELE_RE.test(nom)) return false;
  return CONTRACT_RE.test(nom) || CONTRACT_RE.test(foldName(subject));
}

/**
 * Ligne « à confirmer » déjà tirée du même fil de mails pour la même affaire : même marque et
 * même créateur, ou l'un des deux pas lu. Un nouveau message du fil qui rejoint le contrat
 * met cette ligne à jour au lieu d'en créer une autre (avant : une ligne par message).
 */
export function memeAffaire(e: Exclusivite, p: Pick<Exclusivite, "brand" | "creator" | "mail">): boolean {
  if (!e.pending || !e.mail?.threadId || e.mail.threadId !== p.mail?.threadId) return false;
  const marque = !e.brand.trim() || !p.brand.trim() || sameBrand(e.brand, p.brand);
  const createur = !e.creator.trim() || !p.creator.trim() || foldName(e.creator) === foldName(p.creator);
  return marque && createur;
}

/** La ligne « à confirmer » mise à jour par le contrat plus récent du même fil (id et date d'ajout gardés, rien de lu perdu). */
export function fusionnerProposition(e: Exclusivite, p: Omit<Exclusivite, "id" | "createdAt">): Exclusivite {
  return {
    ...e,
    ...p,
    id: e.id,
    createdAt: e.createdAt,
    creator: p.creator.trim() || e.creator,
    brand: p.brand.trim() || e.brand,
    scope: p.scope.trim() || e.scope,
    competitors: p.competitors.length ? p.competitors : e.competitors,
    points: p.points.length ? p.points : e.points,
    end: p.end ?? e.end,
    docPath: p.docPath ?? e.docPath ?? null,
  };
}

/**
 * Proposition d'exclusivité « à confirmer » tirée d'un contrat reçu par mail, ou null quand
 * le contrat n'a pas de clause d'exclusivité. Créateur et marque : ceux lus dans le contrat,
 * sinon ceux du mail (créatrice destinataire, marque de l'expéditeur).
 */
export function proposalFromMail(
  r: ContractReading,
  ctx: { creatorHint: string | null; brandHint: string | null; fileName: string; docPath: string | null; mail: { threadId: string; box: string; subject?: string }; today: string },
): Omit<Exclusivite, "id" | "createdAt"> | null {
  if (!r.exclusivity) return null;
  return {
    creator: r.creator ?? ctx.creatorHint ?? "",
    brand: r.brand ?? ctx.brandHint ?? "",
    scope: r.exclusivity.scope,
    competitors: r.exclusivity.competitors,
    start: r.exclusivity.start ?? ctx.today,
    end: r.exclusivity.end,
    points: r.points,
    source: "mail",
    contractRef: ctx.fileName,
    docPath: ctx.docPath,
    pending: true,
    quote: r.exclusivity.quote,
    mail: ctx.mail,
  };
}
