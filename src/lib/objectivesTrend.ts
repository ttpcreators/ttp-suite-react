/**
 * Objectifs : calculs purs de la page (aucun accès base, aucun DOM).
 *   • moyenne de réussite par mois (chaque objectif borné 0..100 %) ;
 *   • meilleur mois ;
 *   • barres du graphique « Réussite mois par mois » (mois courant vide = « À définir ») ;
 *   • statut d'un objectif (atteint, en bonne voie, en retard, non atteint).
 */

/** Ce dont les calculs ont besoin d'un objectif : sa progression stockée (%). */
export type TrendObjective = { pct?: number | string | null };

/** Blob 'objByMonth' : clé "AAAA-MM" (ancien format : clé "0" = mois courant). */
export type ObjByMonthLike = Record<string, TrendObjective[] | undefined>;

export type MonthPoint = { month: string; pct: number };

/** Barre du graphique : mois avec données, ou mois courant encore vide (`empty`). */
export type TrendBar = { month: string; pct: number; empty: boolean };

export const isMonthKey = (k: string) => /^\d{4}-\d{2}$/.test(k);

/** Progression d'un objectif bornée 0..100 (un dépassement ne gonfle pas la moyenne). */
export function clampPct(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/** Part moyenne atteinte (%) d'une liste d'objectifs, arrondie ; 0 si vide. */
export function averagePct(list: TrendObjective[]): number {
  if (!list.length) return 0;
  return Math.round(list.reduce((s, o) => s + clampPct(o.pct), 0) / list.length);
}

/**
 * Moyenne par mois, du plus ancien au plus récent, pour tous les mois qui ont au
 * moins un objectif. Ancienne clé "0" → mois courant (si ce mois n'a pas déjà sa clé).
 */
export function monthlyAverages(obj: ObjByMonthLike, currentKey: string): MonthPoint[] {
  const map = new Map<string, TrendObjective[]>();
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (Array.isArray(v) && v.length && isMonthKey(k)) map.set(k, v);
  }
  const legacy = obj?.["0"];
  if (!map.has(currentKey) && Array.isArray(legacy) && legacy.length) map.set(currentKey, legacy);
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, list]) => ({ month, pct: averagePct(list) }));
}

/**
 * Meilleur mois : la moyenne la plus haute. À égalité, le plus récent.
 * null s'il n'y a aucun mois, ou si aucun n'a dépassé 0 %.
 */
export function bestMonth(points: MonthPoint[]): MonthPoint | null {
  let best: MonthPoint | null = null;
  for (const p of points) {
    if (p.pct > 0 && (!best || p.pct >= best.pct)) best = p;
  }
  return best;
}

/**
 * Barres du graphique : les `limit` derniers mois avec données, plus le mois
 * courant en barre vide (« À définir ») s'il n'a encore aucun objectif.
 * Aucune donnée du tout → [] (la page affiche un message à la place).
 */
export function trendBars(points: MonthPoint[], currentKey: string, limit = 12): TrendBar[] {
  if (!points.length) return [];
  const bars: TrendBar[] = points.map((p) => ({ month: p.month, pct: p.pct, empty: false }));
  if (!points.some((p) => p.month === currentKey)) {
    bars.push({ month: currentKey, pct: 0, empty: true });
    bars.sort((a, b) => (a.month < b.month ? -1 : 1));
  }
  return bars.slice(-Math.max(1, limit));
}

/** Statut d'un objectif pour sa pastille. */
export type ObjectiveStatus = "reached" | "onTrack" | "behind" | "missed";

/**
 * Atteint dès 100 %. Mois passé non atteint → « missed ». Mois courant : comparé
 * au rythme attendu (part du mois écoulée) → « onTrack » ou « behind ».
 * Mois à venir non atteint → « onTrack » (rien n'est encore en retard).
 */
export function objectiveStatus(pct: unknown, monthKey: string, today: Date): ObjectiveStatus {
  const p = clampPct(pct);
  if (p >= 100) return "reached";
  const cur = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  if (monthKey < cur) return "missed";
  if (monthKey > cur) return "onTrack";
  const days = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const expected = (today.getDate() / days) * 100;
  return p >= expected ? "onTrack" : "behind";
}
