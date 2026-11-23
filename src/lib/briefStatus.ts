/**
 * Statut d'un brief et ordre d'affichage de la liste (page Briefs).
 * L'ordre suit ce qui demande une action : « À valider » d'abord, puis en cours,
 * en attente, et les terminés à la fin.
 */

export type BriefCol = "attente" | "valider" | "cours" | "terminé";

/** Colonne (canonique) d'un brief selon son statut stocké. */
export function colKey(status: string | null | undefined): BriefCol {
  // Insensible aux accents : "terminé" (é précomposé) ne contient PAS "termine".
  const s = String(status ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (s.includes("termin")) return "terminé";
  if (s.includes("cours")) return "cours";
  if (s.includes("valider")) return "valider";
  return "attente";
}

/** Rang d'affichage : plus petit = plus haut dans la liste. */
export const ACTION_ORDER: Record<BriefCol, number> = { valider: 0, cours: 1, attente: 2, "terminé": 3 };

/** Trie par ce qui demande une action, sans casser l'ordre manuel à l'intérieur d'un statut. */
export function sortByAction<T extends { status: string | null | undefined }>(rows: readonly T[]): T[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => ACTION_ORDER[colKey(a.r.status)] - ACTION_ORDER[colKey(b.r.status)] || a.i - b.i)
    .map((x) => x.r);
}

/** Valeur d'un champ, ou "" si vide (l'app range « — » pour un champ effacé). */
export function filled(v: string | null | undefined): string {
  const s = String(v ?? "").trim();
  return s === "—" || s === "-" || s === "–" ? "" : s;
}
