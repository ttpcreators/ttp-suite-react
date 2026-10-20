import type { StatusTone } from "@/lib/statusTone";

/**
 * Scouting (page Vivier) : statuts de pipeline, étapes « Où on en est », couleur de
 * l'engagement et tri de la liste. Fonctions pures, testées dans scouting.test.ts.
 */

export type ScoutStatus = "observation" | "contacter" | "discussion" | "signe" | "ecarte";

/** Couleur de chaque statut (un sens par couleur, voir statusTone.ts). */
export const SCOUT_TONE: Record<ScoutStatus, StatusTone> = {
  observation: "info",
  contacter: "wait",
  discussion: "progress",
  signe: "ok",
  ecarte: "closed",
};

/** Les 4 étapes du parcours (« Écarté » est une sortie, pas une étape). */
export const SCOUT_STEPS: ScoutStatus[] = ["observation", "contacter", "discussion", "signe"];

/**
 * Étape suivante du parcours : celle que propose le bouton principal de la fiche.
 * Un profil écarté repart en observation ; un profil signé n'a plus d'étape (null).
 */
export function nextScoutStep(s: ScoutStatus): ScoutStatus | null {
  if (s === "ecarte") return "observation";
  const i = SCOUT_STEPS.indexOf(s);
  return i >= 0 && i < SCOUT_STEPS.length - 1 ? SCOUT_STEPS[i + 1] : null;
}

/** Position d'une étape par rapport au statut actuel : faite, en cours ou à venir. */
export function stepState(step: ScoutStatus, current: ScoutStatus): "done" | "current" | "todo" {
  if (current === "ecarte") return "todo";
  const a = SCOUT_STEPS.indexOf(step);
  const b = SCOUT_STEPS.indexOf(current);
  return a < b ? "done" : a === b ? "current" : "todo";
}

/**
 * Couleur de l'engagement public (en %) : bon à partir de 3 %, moyen de 1 à 3 %,
 * faible sous 1 %. Inconnu : null (rien à colorer).
 */
export function engagementTone(er: number | null | undefined): StatusTone | null {
  if (er == null || !Number.isFinite(er)) return null;
  if (er >= 3) return "ok";
  if (er >= 1) return "wait";
  return "closed";
}

/** Largeur de la petite barre d'engagement (en %) : proportionnelle, pleine à 6 % et plus, jamais invisible. */
export function engagementBarPct(er: number | null | undefined, full = 6): number {
  if (er == null || !Number.isFinite(er) || er <= 0) return 0;
  return Math.round(Math.min(100, Math.max(4, (er / full) * 100)));
}

export type ScoutSort = "abonnes" | "engagement" | "evolution" | "nom" | "ajout";
export const SCOUT_SORTS: ScoutSort[] = ["abonnes", "engagement", "evolution", "nom", "ajout"];

/** Ce que le tri lit sur une ligne (null = inconnu, toujours rangé en bas). */
export type SortKeys = { name: string; followers: number | null; er: number | null; growth: number | null };

/**
 * Trie une copie de la liste. « ajout » garde l'ordre reçu (celui de la base) ;
 * les valeurs inconnues passent après les connues, à égalité on garde l'ordre reçu.
 */
export function sortScouting<T>(rows: T[], by: ScoutSort, keys: (r: T) => SortKeys): T[] {
  if (by === "ajout") return [...rows];
  const withKeys = rows.map((r, i) => ({ r, i, k: keys(r) }));
  const num = (k: SortKeys): number | null => (by === "abonnes" ? k.followers : by === "engagement" ? k.er : k.growth);
  withKeys.sort((a, b) => {
    if (by === "nom") return a.k.name.localeCompare(b.k.name, "fr", { sensitivity: "base" }) || a.i - b.i;
    const x = num(a.k);
    const y = num(b.k);
    if (x == null && y == null) return a.i - b.i;
    if (x == null) return 1;
    if (y == null) return -1;
    return y - x || a.i - b.i;
  });
  return withKeys.map((x) => x.r);
}
