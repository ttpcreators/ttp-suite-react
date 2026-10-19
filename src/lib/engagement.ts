/**
 * Calcul du taux d'engagement d'une campagne, à partir des chiffres relevés sur les
 * captures d'écran d'insights envoyées par les créateurs (Instagram / TikTok).
 *
 * Deux bases de calcul, parce que les deux existent dans le métier et ne disent PAS
 * la même chose :
 *
 *  • « sur la couverture » (reach) = interactions / comptes touchés.
 *    C'est le taux qu'attend une marque : il mesure la performance RÉELLE du contenu
 *    auprès des gens qui l'ont vu. Insensible au nombre d'abonnés.
 *
 *  • « sur les abonnés » = (interactions / nb de publications) / abonnés.
 *    C'est le taux « carte de visite » d'un compte (celui des media kits et des outils
 *    type HypeAuditor). On divise d'abord par le nombre de publications pour obtenir
 *    la moyenne PAR publication — sinon 10 posts gonflent mécaniquement le taux.
 *
 * Les deux sont exposés : on ne choisit pas à la place de l'utilisateur.
 */

export type PostStat = {
  id: string;
  /** Reel · Post · Story · TikTok… (libre) */
  kind: string;
  /** Comptes touchés (« reach »). */
  reach: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  /** Vues / lectures — informatif, N'ENTRE PAS dans les interactions (voir plus bas). */
  views: number;
};

export type EngTotals = {
  posts: number;
  reach: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  views: number;
  /** likes + commentaires + enregistrements + partages. */
  interactions: number;
  /** interactions / couverture (en %). null si couverture inconnue. */
  erReach: number | null;
  /** (interactions / publications) / abonnés (en %). null si abonnés inconnus. */
  erFollowers: number | null;
  /** Couverture moyenne par publication. */
  avgReach: number;
  /** Interactions moyennes par publication. */
  avgInteractions: number;
};

export const emptyStat = (id: string, kind = "Reel"): PostStat => ({
  id,
  kind,
  reach: 0,
  likes: 0,
  comments: 0,
  saves: 0,
  shares: 0,
  views: 0,
});

/**
 * Lit un nombre saisi « à la main » depuis une capture : « 12 345 », « 12,3 K »,
 * « 1.2M », « 480k », « 2 M ». Renvoie 0 si illisible (jamais NaN : un NaN qui
 * remonte dans les totaux contaminerait tout l'affichage).
 */
export function parseNum(input: string | number | null | undefined): number {
  if (typeof input === "number") return Number.isFinite(input) ? input : 0;
  if (!input) return 0;
  // Tolère « ~12k », « ≈ 12 000 », « +12k » et un mot après le nombre (« 45K abonnés »).
  const raw = String(input)
    .trim()
    .toLowerCase()
    .replace(/^[~≈≃+\s]+/, "")
    .replace(/\s+[a-zà-ÿ]{2,}\.?$/, "")
    .trim();
  if (!raw) return 0;
  // Suffixe multiplicateur K / M (accepté collé ou espacé : « 480k », « 1,2 M »).
  const m = /^([\d\s.,  ]+)\s*([km])?$/.exec(raw);
  if (!m) return 0;
  let num = m[1].replace(/[\s  ]/g, "");
  // Décimale française OU anglaise. Les séparateurs de milliers sautent d'abord :
  // « 12.345 » (12 mille) vs « 12.3 K » (12,3 mille) → on tranche sur la position.
  if (num.includes(",") && num.includes(".")) {
    // Les deux : le DERNIER est la décimale, l'autre est un séparateur de milliers.
    num = num.lastIndexOf(",") > num.lastIndexOf(".") ? num.replace(/\./g, "").replace(",", ".") : num.replace(/,/g, "");
  } else if (num.includes(",")) {
    // Virgule seule : soit séparateur(s) de milliers (« 1,200,000 », « 12,345 »),
    // soit décimale française (« 6,42 »). Des groupes de 3 chiffres → milliers (on
    // retire toutes les virgules) ; sinon c'est la décimale. (Un simple replace(",",".")
    // ne remplaçait que la 1re virgule → « 1,200,000 » devenait 1.2.)
    num = /^\d{1,3}(,\d{3})+$/.test(num) ? num.replace(/,/g, "") : num.replace(",", ".");
  } else if (num.includes(".")) {
    // Un point + exactement 3 chiffres derrière et pas de suffixe → séparateur de milliers.
    const after = num.slice(num.lastIndexOf(".") + 1);
    if (after.length === 3 && !m[2]) num = num.replace(/\./g, "");
  }
  const n = Number.parseFloat(num);
  if (!Number.isFinite(n)) return 0;
  const mult = m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1;
  return Math.max(0, n * mult);
}

/**
 * Totaux + taux d'engagement.
 *
 * Les VUES sont volontairement exclues des interactions : une vue n'est pas un acte
 * d'engagement, et l'inclure gonflerait le taux au point de le rendre faux (et donc
 * indéfendable face à une marque qui recalcule).
 */
export function totalsOf(stats: PostStat[], followers = 0, postsOverride?: number): EngTotals {
  const sum = (f: (s: PostStat) => number) => stats.reduce((acc, s) => acc + Math.max(0, f(s) || 0), 0);
  // Mode « saisie globale » : l'utilisateur donne les totaux et le NOMBRE de publications
  // directement (il n'a pas envie de détailler 8 posts). Sinon, une ligne = une publication.
  const posts = postsOverride && postsOverride > 0 ? Math.round(postsOverride) : stats.length;
  const reach = sum((s) => s.reach);
  const likes = sum((s) => s.likes);
  const comments = sum((s) => s.comments);
  const saves = sum((s) => s.saves);
  const shares = sum((s) => s.shares);
  const views = sum((s) => s.views);
  const interactions = likes + comments + saves + shares;
  const fol = Math.max(0, followers || 0);
  return {
    posts,
    reach,
    likes,
    comments,
    saves,
    shares,
    views,
    interactions,
    erReach: reach > 0 ? (interactions / reach) * 100 : null,
    erFollowers: fol > 0 && posts > 0 ? (interactions / posts / fol) * 100 : null,
    avgReach: posts > 0 ? reach / posts : 0,
    avgInteractions: posts > 0 ? interactions / posts : 0,
  };
}

// ───────────── Taux global : seulement sur une base HOMOGÈNE ─────────────

export type EngPlatform = "instagram" | "tiktok" | "youtube";

/** Réseau d'une publication d'après son type (« TikTok », « Short », « YouTube » ; le reste = Instagram). */
export function platformOfKind(kind: string): EngPlatform {
  const k = (kind || "").toLowerCase();
  if (k.includes("tiktok")) return "tiktok";
  if (k.includes("short") || k.includes("youtube")) return "youtube";
  return "instagram";
}

/** Couverture connue sur CHAQUE publication (TikTok et YouTube n'en donnent pas). */
export function allHaveReach(stats: PostStat[]): boolean {
  return stats.length > 0 && stats.every((s) => s.reach > 0);
}

/** Le réseau commun à toutes les publications, ou null si elles en mélangent plusieurs. */
export function singlePlatform(stats: PostStat[]): EngPlatform | null {
  const set = new Set(stats.map((s) => platformOfKind(s.kind)));
  return set.size === 1 ? [...set][0] : null;
}

/**
 * Taux d'engagement global d'une campagne, calculé SEULEMENT sur une base homogène :
 *  1. chaque publication a une couverture → taux sur la couverture ;
 *  2. sinon, toutes sur UN seul réseau et ses abonnés connus → taux sur les abonnés DE CE réseau ;
 *  3. sinon → pas de taux global (null). Diviser des interactions TikTok par des abonnés
 *     Instagram donnait des taux 4 à 5 fois trop hauts.
 */
export function reliableEr(
  stats: PostStat[],
  followersBy: Partial<Record<EngPlatform, number>>,
): { er: number | null; basis: "reach" | "followers" | null; followers: number } {
  if (allHaveReach(stats)) return { er: totalsOf(stats).erReach, basis: "reach", followers: 0 };
  const p = singlePlatform(stats);
  const fol = p ? Math.max(0, followersBy[p] || 0) : 0;
  if (p && fol > 0) return { er: totalsOf(stats, fol).erFollowers, basis: "followers", followers: fol };
  return { er: null, basis: null, followers: 0 };
}

/** Grands nombres : même règle partout (« 1,3K », « 480K », « 1,2M », « 1Md »), voir timeSeries. */
export { fmtCompact } from "./timeSeries";

/** 6,42 → « 6,4 % ». */
export function fmtPct(n: number | null, digits = 1): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return trimZeros(n.toFixed(digits)) + " %";
}

function trimZeros(s: string): string {
  return s.replace(/\.?0+$/, "").replace(".", ",");
}

/**
 * Seuils « bon taux » : UNE seule source pour toute l'app (repère du calculateur, bilan
 * automatique, proposition de renouvellement). Ordres de grandeur usuels du secteur,
 * indicatifs : ~4 % sur la couverture, ~3 % sur les abonnés.
 */
export const GOOD_ER_REACH = 4;
export const GOOD_ER_FOLLOWERS = 3;

/**
 * Repère de lecture du taux d'engagement (base couverture). Sert à afficher un avis
 * honnête à côté du chiffre plutôt que de laisser l'utilisateur deviner si c'est bon.
 * Ordres de grandeur usuels du secteur — indicatifs, pas une vérité absolue.
 */
export function erVerdict(er: number | null): { label: string; tone: "good" | "ok" | "low" } | null {
  if (er === null) return null;
  if (er >= 8) return { label: "Excellent", tone: "good" };
  if (er >= GOOD_ER_REACH) return { label: "Bon", tone: "good" };
  if (er >= 2) return { label: "Correct", tone: "ok" };
  return { label: "Faible", tone: "low" };
}
