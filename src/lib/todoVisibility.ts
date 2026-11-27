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

/*
 * Parmi les tâches qu'il voit (vague 1, SQL 2026-11-27) : « Pour toi » = la sienne, ou une
 * tâche de l'agence qu'elle lui DEMANDE (`pour_createur`). Les autres tâches visibles de
 * l'agence vont dans « Ton agence s'en occupe » : il les lit et y répond, sans les cocher.
 * Colonne absente (SQL pas lancé) : undefined, donc tout reste « Pour toi » comme avant.
 * Même règle en SQL : source is distinct from 'agency' or pour_createur. Formule unique de
 * l'app : la To-do de l'agence la reprend aussi (todoDemande.ts, push et cases).
 */
export type TodoPourToi = { source?: string | null; pour_createur?: boolean | null };

export function pourToi(t: TodoPourToi): boolean {
  return t.source !== "agency" || t.pour_createur !== false;
}

/** La colonne `todos.pour_createur` n'existe pas encore (SQL 2026-11-27 pas lancé). Sert aussi à la To-do de l'agence (todoDemande.ts). */
export function pourCreateurColumnMissing(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  const m = err.message ?? "";
  return (err.code === "42703" || err.code === "PGRST204" || /does not exist|column|schema cache/i.test(m)) && /pour_createur/.test(m);
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
