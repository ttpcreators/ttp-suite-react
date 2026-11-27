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
//    concurrents, ou dont la catégorie se lit dans le nom (mot entier pour un mot court :
//    « mode » ne bloque pas « Modern ») ou le secteur de la marque ;
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
  // Mots qui qualifient sans dire un secteur (« concurrents directs », « haut de gamme », « bien être ») :
  // pris seuls, ils bloqueraient « Direct… », « Bien… » ou « High… ».
  "bien", "etre", "haut", "haute", "high", "fast", "direct", "directe",
]);

/** Singulier d'un mot de catégorie (« parfums » → parfum, « probiotiques » → probiotique ; « stress » reste). */
const singulier = (w: string) => (w.length > 4 && !w.endsWith("ss") ? w.replace(/[sx]$/, "") : w);
const motVague = (w: string) => MOTS_VAGUES.has(w) || MOTS_VAGUES.has(singulier(w));
/** Un mot au pluriel près, pour comparer (« parfums » = « parfum », « bijoux » = « bijou »). */
const radical = (w: string) => (w.length > 3 ? w.replace(/[sx]$/, "") : w);

/** Une catégorie repliée comme foldName, mais un mot à trait d'union reste un seul mot (« bien-etre », « high-tech »). */
const plierCategorie = (s: string) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’‘]/g, "'").toLowerCase()
    .replace(/[^a-z0-9'-]+/g, " ").replace(/(?<![a-z0-9])-+|-+(?![a-z0-9])/g, " ").replace(/\bbien etre\b/g, "bien-etre")
    .replace(/\s+/g, " ").trim();

/**
 * Le terme qui dit chaque secteur interdit : le premier mot parlant de chaque partie, coupée aux
 * virgules, « ; », « / », et, ou (« nutrition sportive et compléments alimentaires » → nutrition,
 * complement ; « minceur, digestion ou sommeil » → minceur, digestion, sommeil ; « produits de
 * beauté » → beaute). Un mot à trait d'union est un seul terme (« bien-être » → « bien etre »).
 * Vide pour une catégorie vague (« même catégorie de produits », « concurrents directs »).
 */
export function termesSecteur(scope: string): string[] {
  const out: string[] = [];
  for (const morceau of String(scope ?? "").split(/[,;/]/)) {
    for (const part of plierCategorie(morceau).split(/\b(?:et|ou|and|or)\b/)) {
      const mot = part.split(" ").map((w) => w.replace(/^(?:d|l|qu)'/, "")).find((w) => w.replace(/-/g, "").length >= 4 && !motVague(w) && !/\d/.test(w));
      const t = mot ? mot.split("-").filter(Boolean).map(singulier).join(" ") : "";
      if (t.replace(/ /g, "").length >= 4 && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

/** Les mots du terme se suivent-ils dans le nom, chacun au pluriel près (« sous vetements » pour « sous vetement ») ? */
const motsQuiSeSuivent = (mots: readonly string[], terme: readonly string[]) =>
  mots.some((_, i) => terme.every((t, j) => i + j < mots.length && radical(mots[i + j]) === radical(t)));

/**
 * La catégorie interdite se lit-elle dans le nom de la marque (« Maison des Parfums » pour
 * « parfum ») ? Le terme, sinon null. Toujours le mot entier, au pluriel près. Un terme de
 * 6 lettres ou plus se lit aussi au début d'un mot ou collé (« Parfumerie », « Lumenparfum ») ;
 * un terme plus court jamais (« mode » ne se lit pas dans « Modern », ni « tech » dans
 * « Technogrid »). `motEntier` : le mot entier seulement, quelle que soit sa longueur (conformité).
 */
export function secteurDansNom(scope: string, brand: string, o: { motEntier?: boolean } = {}): string | null {
  const nom = foldName(brand);
  if (!nom) return null;
  const mots = nom.split(" ");
  const colle = nom.replace(/ /g, "");
  return termesSecteur(scope).find((t) => {
    const terme = t.split(" ");
    const tc = terme.join("");
    // Le mot entier (« Maison Parfums »), ou un terme à trait d'union écrit en un mot (« Bienetre Shop »).
    if (motsQuiSeSuivent(mots, terme) || mots.some((w) => radical(w) === radical(tc))) return true;
    return !o.motEntier && tc.length >= 6 && colle.includes(tc);
  }) ?? null;
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

/** La raison d'un blocage en clair : « Kora est cité parmi ses concurrents », « « parfum » se lit dans le nom de Kora ». */
export function raisonBloque(e: Exclusivite, brand: string, p: RaisonBloque): string {
  switch (p) {
    case "concurrent":
      return `${brand} est cité parmi ses concurrents`;
    case "nom":
      return `« ${secteurDansNom(e.scope, brand) ?? e.scope} » se lit dans le nom de ${brand}`;
    case "secteur":
      return `le secteur de ${brand} est dans la catégorie interdite`;
  }
}

/** Exclusivités CONFIRMÉES en cours ou à venir d'un créateur qui bloquent cette marque (ligne au prénom seul comprise). */
export function conflictsFor(list: readonly Exclusivite[], creator: string, brand: string, today: string, brandTags: readonly string[] = []): Exclusivite[] {
  return list.filter((e) => !e.pending && memeCreateur(e.creator, creator) && excluState(e, today) !== "terminee" && hitsBrand(e, brand, brandTags));
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
 *    y compris une ligne sans créateur reconnu quand on demande pour un créateur précis ; avec
 *    `categories`, aussi celle qui a une liste de concurrents et une catégorie (la liste lue après
 *    « notamment » n'est jamais complète).
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
      if (p || !e.competitors.length || (o.categories && e.scope.trim())) out.push({ e, niveau: "a_verifier", pourquoi: "a_confirmer" });
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
 * blockedCreators bloque déjà n'y sont pas (sous le même nom ou un prénom seul) ; une ligne sans
 * créateur ne s'attache à personne.
 */
export function aVerifierCreators(list: readonly Exclusivite[], brand: string, today: string, brandTags: readonly string[] = []): Map<string, string> {
  const bloques = [...blockedCreators(list, brand, today, brandTags).keys()];
  const out = new Map<string, string>();
  for (const a of alertesExclu(list, brand, today, { brandTags })) {
    const k = a.e.creator.trim().toLowerCase();
    if (a.niveau !== "a_verifier" || !k || bloques.some((b) => memeCreateur(b, k)) || out.has(k)) continue;
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
    case "secteur":
      return `${excluLine(e)} : ${raisonBloque(e, brand, a.pourquoi)}`;
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

/**
 * La raison donnée par blockedCreators ou aVerifierCreators pour une fiche du roster : sous son
 * nom, ou sous un prénom seul (ligne écrite « Zoé » pour « Zoé X », memeCreateur).
 */
export function raisonPour(m: ReadonlyMap<string, string> | null | undefined, nom: string): string | undefined {
  if (!m?.size || !nom.trim()) return undefined;
  const exacte = m.get(nom.trim().toLowerCase());
  if (exacte !== undefined) return exacte;
  for (const [cle, raison] of m) if (memeCreateur(cle, nom)) return raison;
  return undefined;
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
// Tout se lit sur la phrase repliée (plierClause : minuscules, sans accents, apostrophes
// gardées) où virgules, points-virgules, deux-points et parenthèses restent des mots à part :
// une négation ne compte que collée au mot, et aucune fenêtre de mots ne franchit une virgule.
// Avant : en novembre 2026, « non exclusive », « sans aucune exclusivité » ou « exclusivement »
// suffisaient à proposer une exclusivité ; puis une négation lue jusqu'à 3 mots avant le mot
// faisait manquer de vraies clauses (« ne pourra pas, pendant l'exclusivité, travailler avec… »).

/** La phrase repliée, ponctuation utile gardée : « le createur ne pourra pas , pendant l'exclusivite , … ». */
const plierClause = (s: string) =>
  ` ${String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’‘]/g, "'").toLowerCase()
    .replace(/[^a-z0-9',;:()]+/g, " ").replace(/([,;:()])/g, " $1 ").replace(/\s+/g, " ").trim()} `;

/** Le mot qui dit l'exclusivité, ou la non-concurrence. */
const MOT_EXCLU = "(?:l'|d')?(?:exclusi[a-z]*|non ?concurren[a-z]*|non ?compet[a-z]*)";
/** Ce qui peut se glisser entre la négation et le mot : « aucune clause d'… », « pas d'obligation de… ». */
const ENTRE = "(?:aucune? |toute )?(?:(?:clause|obligation|engagement|regime|droit|caractere|periode|accord|contrainte|condition|pacte|garantie)s? (?:d'|de ))?";
/**
 * Après le mot : une exclusivité tournée vers les autres n'est pas niée (« aucun engagement
 * d'exclusivité avec une autre marque », « no exclusivity with any competitor » : une interdiction).
 */
const VERS_AUTRES = "\\b(?! (?:avec|envers|aupres de|a|au|aux|with|to) (?:une |un |des |d'|toute |tout |aucune? |any |an? )?(?:(?:marques?|societes?|entreprises?|brands?|companies) )?(?:autres?\\b|concurren|compet|tiers\\b|rival|other\\b))";

/** Tournures qui disent qu'il n'y a PAS d'exclusivité : retirées avant de chercher la clause (dans cet ordre). */
const NEGATIONS: RegExp[] = [
  // « Exclusivité : non. », « Exclusivité : aucune », « Exclusivité : néant », « Exclusivité : non exclusif » : en fin de
  // phrase ou avant une ponctuation (pas « Exclusivité : aucune marque concurrente », ni « … aucune collaboration »).
  /\b(?:l'|d')?exclusivit[a-z]* (?:: )?(?:aucune?|neant|none|n a|sans objet|non(?: ?exclusi[a-z]*| applicable| concernee?s?| prevue?s?)?)(?= (?:[,;:()]|$))/g,
  // « non exclusive », « non-exclusif », « nonexclusive », « non exclusivité ».
  /\bnon ?exclusi[a-z]*/g,
  // Négation collée au mot : « pas d'exclusivité », « aucune (clause d') exclusivité », « sans (aucune) exclusivité »,
  // « absence d'exclusivité », « ni non-concurrence », « n'est pas exclusif », « n'est pas consentie à titre exclusif »,
  // « n'est pas tenu à une exclusivité », « pas exclusivement avec la Marque ». Jamais par-dessus un autre mot :
  // « ne pourra pas, pendant l'exclusivité », « ne peut en aucun cas rompre l'exclusivité » ou « sans préjudice de
  // l'exclusivité » la confirment.
  new RegExp(
    `\\b(?:pas|aucune?|d'aucune?|sans|absence|ni|nulle|nullement|aucunement|jamais) (?:d'|de )?${ENTRE}(?:(?:consenti|accorde|octroye|concede|conclu|donne|reserve)e?s? )?(?:(?:tenu|soumis|lie|astreint|oblige|engage)e?s? (?:a |par |au |aux )?(?:une |la |l'|des |toute )?)?(?:a titre |de (?:maniere|facon) )?${MOT_EXCLU}${VERS_AUTRES}`,
    "g",
  ),
  // « no exclusivity », « not an exclusive », « will not be exclusive », « without any exclusivity », « no non-compete »,
  // « is not bound by any exclusivity », « does not grant any exclusivity » (pas « shall not, during the exclusivity… »).
  new RegExp(
    `\\b(?:no|not|without|never)(?: be)?(?: (?:bound|subject|granted|grant|give|given|create|confer|imply|include|entitled)(?: by| to| with)?)?(?: an?| any)? (?:exclusi[a-z]*|non ?compet[a-z]*)${VERS_AUTRES}`,
    "g",
  ),
  // « libre de toute exclusivité », « exempt de toute clause d'exclusivité ».
  /\b(?:libres?|exempte?s?|degagee?s?) de toute (?:clause d'|obligation d')?exclusi[a-z]*/g,
];

/** Ce qui peut qualifier une licence avant « exclusive » : « licence gratuite, mondiale et exclusive ». */
const ADJ_LICENCE = "(?:gratuite?s?|mondiale?s?|perpetuelle?s?|irrevocables?|personnelle?s?|(?:in)?cessibles?|transferables?|totale?s?|entiere?s?|pleine?s?|seule?s?|worldwide|perpetual|irrevocable|royalty free|sole)";
/**
 * Le mot dans un autre sens, seulement quand il qualifie directement la licence ou le droit sur
 * les contenus, le tribunal, la propriété ou la charge : « licence exclusive », « droit
 * d'exploitation exclusif », « compétence exclusive », « exclusif d'une licence ». Jamais par-dessus
 * un autre mot : « la cession des droits, le Créateur accorde une exclusivité » en est une.
 */
const AUTRES_SENS: RegExp[] = [
  new RegExp(
    `\\b(?:licences?|licenses?|cessions?|concessions?|droits? d'(?:exploitation|utilisation|usage|auteur|diffusion|reproduction|propriete)|competence|juridiction|jurisdiction|tribunaux|courts?|responsabilite|responsibility|liability|propriete|property|ownership|proprietaire|owner|titulaire|charge|frais|expenses?)(?: ${ADJ_LICENCE}(?: ,| et| and)?)* (?:a titre )?exclusi[a-z]*`,
    "g",
  ),
  /\bexclusi[a-z]*(?: (?:d'une?|de la|du|des|de|d'|of|an?|the))? (?:licences?|licenses?|cessions?|concessions?|competence|juridiction|jurisdiction|propriete|property|ownership|proprietaire|owner|titulaire|responsabilite|responsibility|liability)\b|\bexclusi[a-z]* d'(?:exploitation|utilisation|usage|diffusion|reproduction)\b/g,
];

/**
 * Mots qui disent à eux seuls une exclusivité, et « exclusivement avec la Marque » (« exclusivement »
 * seul veut dire « seulement » : « payée exclusivement en produits » n'est ni une clause ni une négation).
 */
const FORTE =
  /\b(?:l'|d')?exclusi(?:f|fs|ve|ves|vite|vites|vity|vities)\b|\bnon ?concurren|\bnon ?compet|\bexclusivement (?:avec|pour) (?:le compte (?:de |d'))?(?:la |le |les |l'|cette |ladite |ledit )?(?:marque|annonceur|societe|client|partenaire|entreprise|enseigne)s?\b|\bexclusively (?:with|for) (?:the )?(?:brand|company|client|advertiser|partner)s?\b/;
/** Une interdiction… (fenêtres de mots qui s'arrêtent à la ponctuation) */
const INTERDIT =
  /\bs'interdi|\binterdi(?:t|te|ts|tes|ction)\b|\bs'engage\w* a ne\b|\bs'abst|\bne (?:pourra|pourront|peut|peuvent|doit|devra|devront|saurait|fera|signera|acceptera|collaborera|travaillera)\b|\bn'(?:accepte|acceptera|accepteront|engagera|aura)\b|\baucune? (?:[a-z0-9']+ ){0,2}?(?:collaboration|partenariat|contrat|campagne|prestation|promotion|publication|concurren\w*)|\bpas de (?:[a-z0-9']+ ){0,2}?concurren\w*|\bshall not\b|\bmust not\b|\bmay not\b|\bwill not\b|\bagrees? not to\b|\bundertakes? not to\b|\bnot to (?:promote|work|endorse|collaborate|partner|advertise)\b|\brefrain/;
/** … qui vise des concurrents : avec INTERDIT, une clause d'exclusivité sans le mot. */
const RIVAL =
  /\bconcurren|\bcompeting\b|\bcompetitors?\b|\bcompetitive\b|\brival|\b(?:autres?|other) (?:marques?|brands?|annonceurs?|entreprises?|societes?|partenaires?)\b|\bmeme (?:categorie|secteur|segment|domaine|univers)\b|\bsame (?:category|sector|industry|segment)\b|\btiers? (?:du|de la) meme\b/;
/** « reste libre de collaborer avec des marques concurrentes » : le contraire d'une exclusivité. */
const LIBRE = /\b(?:libre|librement|liberte|free|freely)(?: [a-z0-9']+){0,3}? (?:collabor|travaill|contract|partenari|s'associer|promouv|conclure|work|partner|promot|engag)\w*/;

/** La phrase dit-elle qu'il n'y a pas d'exclusivité (« non exclusive », « aucune exclusivité »…) ? */
export function nieExclusivite(phrase: string): boolean {
  const t = plierClause(phrase);
  return NEGATIONS.some((re) => t.replace(re, " ") !== t);
}

/**
 * Clause d'exclusivité dans cette phrase ? « forte » : le mot (exclusivité, exclusif,
 * non-concurrence, « exclusivement avec la Marque ») employé pour le créateur ; « faible » : une
 * interdiction qui vise des concurrents (« s'interdit toute collaboration avec une marque
 * concurrente »). null sinon, et quand la phrase dit le contraire. `marque` : la marque du contrat
 * (« exclusivement avec Nova »).
 */
export function clauseExclusivite(phrase: string, marque?: string | null): "forte" | "faible" | null {
  let t = plierClause(phrase);
  for (const re of [...NEGATIONS, ...AUTRES_SENS]) t = t.replace(re, " ");
  const m = foldName(marque);
  if (FORTE.test(t) || (m.length >= 3 && new RegExp(`\\bexclusivement (?:avec|pour) (?:la marque )?${m}\\b`).test(t))) return "forte";
  if (INTERDIT.test(t) && RIVAL.test(t) && !LIBRE.test(t)) return "faible";
  return null;
}

/**
 * Phrase lue qui ne prouve pas une exclusivité : elle dit le contraire, ou ne parle ni
 * d'exclusivité ni d'interdiction. À confirmer seulement après avoir relu le contrat.
 * `marque` : la marque de la ligne (« exclusivement avec Nova »).
 */
export function phraseDouteuse(phrase: string, marque?: string | null): boolean {
  if (nieExclusivite(phrase)) return true;
  return !clauseExclusivite(phrase, marque) && !INTERDIT.test(plierClause(phrase));
}

/** Titre d'article (« Article 6 – Exclusivité », « 6. Exclusivité », « 6.2 – Durée ») : court, n'est pas une clause. */
const estEntete = (s: string) => s.length <= 80 && /^(?:art(?:icle|\.)\s*\d+|\d{1,2}(?:\.\d{1,2})?\s*[.)–-]\s)/i.test(s.trim());
/**
 * Début d'un article, même dans une longue phrase : « Article 6 – Licence : … », « 6. Droits
 * d'utilisation : … ». Pas un sous-numéro (« 6.2 … ») : il reste dans son article.
 */
const ouvreArticle = (s: string) => /^(?:art(?:icle|\.)\s*\d+|\d{1,2}\s*[.)–-]\s)/i.test(s.trim());

/**
 * Marques citées après « notamment », « tels que », « such as », « à savoir », « les marques
 * suivantes : »… Des mots entiers (« comme » ne se lit pas dans « commerciale »).
 */
function listedBrands(sentence: string): string[] {
  const m = /(?:\b(?:notamment|tels? que|telles? que|such as|including|a savoir|comme|par exemple|suivante?s?|following)\b|\be\.g\.)\s*:?\s*([^.;]+)/i.exec(sentence.normalize("NFD").replace(/[̀-ͯ]/g, ""));
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
  // L'article change à chaque titre, et à toute phrase « Article 6 … » ou « 6. … », même longue :
  // avant, un article suivant sans titre court restait rattaché à « Exclusivité ».
  type Lue = { s: string; k: "forte" | "faible"; entete: boolean; contexte: boolean; article: number };
  const lues: Lue[] = [];
  const articlesNies = new Set<number>();
  let article = -1;
  let articleExclu = false;
  sentences.forEach((s, i) => {
    const entete = estEntete(s);
    const k = clauseExclusivite(s, brand);
    if (entete || ouvreArticle(s)) {
      article = i;
      articleExclu = entete && k === "forte";
    }
    if (nieExclusivite(s) && article >= 0) articlesNies.add(article);
    if (k) lues.push({ s, k, entete, contexte: false, article });
    else if (articleExclu && !entete && !nieExclusivite(s) && (INTERDIT.test(plierClause(s)) || findDuration(s))) lues.push({ s, k: "faible", entete, contexte: true, article });
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
 * Ligne « à confirmer » déjà tirée du même fil de mails pour la même affaire : même marque (ou
 * marque pas lue d'un côté) et même créateur. Une ligne qui a déjà son créateur ne prend que le
 * contrat du même créateur : un contrat sans créateur lu peut être celui d'un autre (contrat de
 * couple, deux créateurs dans le fil). Un nouveau message du fil qui rejoint le contrat met
 * cette ligne à jour au lieu d'en créer une autre (avant : une ligne par message).
 */
export function memeAffaire(e: Exclusivite, p: Pick<Exclusivite, "brand" | "creator" | "mail">): boolean {
  if (!e.pending || !e.mail?.threadId || e.mail.threadId !== p.mail?.threadId) return false;
  const marque = !e.brand.trim() || !p.brand.trim() || sameBrand(e.brand, p.brand);
  const createur = !e.creator.trim() || (!!p.creator.trim() && memeCreateur(e.creator, p.creator));
  return marque && createur;
}

/**
 * La ligne à écrire pour une proposition tirée d'un mail : la ligne « à confirmer » de la même
 * affaire, mise à jour (`nouvelle` false : sa tâche existe déjà), ou une nouvelle ligne (il faut
 * aussi sa tâche). `registre` : relu juste avant d'écrire, null si la lecture a raté (nouvelle
 * ligne : rien n'est réécrit à l'aveugle ; une ligne confirmée ou modifiée dans la page entre-temps
 * n'est plus « à confirmer », donc jamais touchée). `exclus` : lignes à ne pas toucher (celles
 * déjà écrites pour le même message : deux PDF d'un même message sont deux contrats).
 */
export function ligneDeProposition(
  registre: readonly Exclusivite[] | null,
  p: Omit<Exclusivite, "id" | "createdAt">,
  o: { id: () => string; now: number; exclus?: ReadonlySet<string> },
): { row: Exclusivite; nouvelle: boolean } {
  const avant = registre?.find((e) => !o.exclus?.has(e.id) && memeAffaire(e, p));
  return avant ? { row: fusionnerProposition(avant, p), nouvelle: false } : { row: { ...p, id: o.id(), createdAt: o.now }, nouvelle: true };
}

/**
 * La ligne « à confirmer » mise à jour par le contrat plus récent du même fil (gmail-poll lit les
 * messages du plus ancien au plus récent) : id et date d'ajout gardés, et ce que ce contrat ne dit
 * pas (créateur, marque, catégorie, concurrents, fin, PDF) reste celui de la ligne.
 */
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
