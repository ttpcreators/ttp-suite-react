/*
 * To-do · colonne `todos.pour_createur` (SQL 2026-11-27) : accès base. La logique pure vit
 * dans todoDemande.ts. L'app marche AVANT le SQL : la présence de la colonne est relue à
 * chaque lecture `select *` de la To-do (elle apparaît donc toute seule après le SQL), et
 * sondée une fois sinon. Tant qu'elle manque, pour_createur n'est jamais envoyé.
 */
import { supabase } from "./supabase";
import { pourCreateurColumnMissing } from "./todoDemande";

let known: boolean | null = null;
let probing: Promise<boolean> | null = null;

/** Note ce que dit une lecture `select *` déjà faite (la colonne est là ou pas). */
export function notePourCreateurColumn(rows: readonly Record<string, unknown>[] | null | undefined): void {
  if (rows && rows.length) known = "pour_createur" in rows[0];
}

/** La colonne `todos.pour_createur` existe-t-elle ? */
export function todosHavePourCreateur(): Promise<boolean> {
  if (known !== null) return Promise.resolve(known);
  probing ??= (async () => {
    const { error } = await supabase.from("todos").select("pour_createur").limit(1);
    if (!error) known = true;
    else if (pourCreateurColumnMissing(error)) known = false;
    probing = null;
    return known ?? false; // autre erreur (réseau) : on n'envoie pas la colonne, on réessaiera
  })();
  return probing;
}
