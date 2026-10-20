/**
 * Statuts : UN sens par couleur dans toute l'app (jetons --st-* de index.css).
 *   ok        payé, signé, à jour, validé
 *   progress  en cours, envoyé
 *   info      brief, idée, Megan, nouveau
 *   wait      à relancer, en attente, à vérifier
 *   late      argent en retard UNIQUEMENT
 *   closed    clôturé, écarté, refusé
 */
export type StatusTone = "ok" | "progress" | "info" | "wait" | "late" | "closed";

export const STATUS_TONES: StatusTone[] = ["ok", "progress", "info", "wait", "late", "closed"];

/** Pastille douce : fond teinté + texte de la couleur du statut. */
export const TONE_SOFT: Record<StatusTone, string> = {
  ok: "bg-ok-soft text-ok",
  progress: "bg-progress-soft text-progress",
  info: "bg-info-soft text-info",
  wait: "bg-wait-soft text-wait",
  late: "bg-late-soft text-late",
  closed: "bg-closed-soft text-closed",
};

/** Point plein (légendes, listes). */
export const TONE_DOT: Record<StatusTone, string> = {
  ok: "bg-ok",
  progress: "bg-progress",
  info: "bg-info",
  wait: "bg-wait",
  late: "bg-late",
  closed: "bg-closed",
};

/** Texte seul (montants, jours de retard). */
export const TONE_TEXT: Record<StatusTone, string> = {
  ok: "text-ok",
  progress: "text-progress",
  info: "text-info",
  wait: "text-wait",
  late: "text-late",
  closed: "text-closed",
};

/** Aplat plein + texte lisible dessus (boutons de choix, disques). */
export const TONE_SOLID: Record<StatusTone, string> = {
  ok: "bg-ok text-on-status",
  progress: "bg-progress text-on-status",
  info: "bg-info text-on-status",
  wait: "bg-wait text-on-status",
  late: "bg-late text-on-status",
  closed: "bg-closed text-on-status",
};

/** Tuile sélectionnable : contour + fond doux de la couleur du statut. */
export const TONE_TILE: Record<StatusTone, string> = {
  ok: "border-ok/70 bg-ok-soft text-ok",
  progress: "border-progress/70 bg-progress-soft text-progress",
  info: "border-info/70 bg-info-soft text-info",
  wait: "border-wait/70 bg-wait-soft text-wait",
  late: "border-late/70 bg-late-soft text-late",
  closed: "border-closed/70 bg-closed-soft text-closed",
};
