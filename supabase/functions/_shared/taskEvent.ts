/**
 * Évènement d'agenda « Tâche : <texte de la tâche> » posé pour une tâche de la to-do (audit
 * données 2026-11-22). Quand la tâche est faite, l'évènement à venir n'a plus de raison d'être :
 * la to-do de l'app (writeTodoStatus) et l'outil MCP cocher_tache le retirent de l'agenda.
 * Seul lien fiable (pas de colonne todo sur `events`) : le titre EXACT. Logique pure, testée.
 */

/** Les titres exacts possibles de l'évènement d'une tâche (espace normale ou insécable avant « : »). */
export function taskEventTitles(text: string | null | undefined): string[] {
  const t = String(text ?? "").trim();
  if (!t) return [];
  return ["Tâche : ", "Tâche : ", "Tâche : "].map((p) => p + t);
}
