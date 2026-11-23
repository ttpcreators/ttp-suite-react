/*
 * Ce que le créateur voit de la To-do et du planning de l'agence.
 *
 * Une tâche créée par l'agence (ou Alfred, ou une fonction : `source = "agency"`)
 * est INTERNE tant qu'elle n'est pas cochée « Visible par le créateur »
 * (`visible_createur`). Ses propres tâches (`source = "creator"`) restent à lui.
 * Un rendez-vous marqué `interne`, ou recopié d'une tâche (« Tâche : … »), est
 * interne aussi.
 *
 * La vraie barrière est la règle de la base (SQL 2026-11-24-taches-internes-privees) ;
 * ces fonctions font voir à l'aperçu agence exactement ce que voit le créateur, et
 * cachent les tâches internes avant même le SQL (colonne absente = interne).
 */

export type TodoVisibilite = { source?: string | null; visible_createur?: boolean | null };

export function visiblePourCreateur(t: TodoVisibilite): boolean {
  return t.source !== "agency" || t.visible_createur === true;
}

export type EvenementVisibilite = { title?: string | null; interne?: boolean | null };

/** Rendez-vous recopié depuis une tâche de la To-do (« Tâche : relancer… »). */
const TACHE = /^\s*t[âa]che\s*:/i;

export function evenementInterne(e: EvenementVisibilite): boolean {
  return e.interne === true || TACHE.test(e.title ?? "");
}

/** La colonne `todos.visible_createur` ou `events.interne` n'existe pas encore (SQL pas lancé). */
export function visibiliteColumnMissing(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const m = err.message ?? "";
  return (err.code === "42703" || /does not exist|column/i.test(m)) && /visible_createur|interne/.test(m);
}
