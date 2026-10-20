import { dbUpdate } from "./db";
import { myDisplayName } from "./team";

export type TodoStatusPatch = { status: string; done: boolean; done_at?: string | null; done_by?: string | null };

/**
 * Écrit le statut d'une tâche + la trace du « Fait » (date et auteur). Repli sans la
 * trace tant que le SQL équipe n'est pas lancé. Renvoie ce qui a été enregistré.
 * Partagé par la page To-do et « Aujourd'hui » (bouton « Terminer »).
 */
export async function writeTodoStatus(id: string, status: string): Promise<TodoStatusPatch | null> {
  const isDone = status === "Fait";
  const traced: TodoStatusPatch = isDone
    ? { status, done: true, done_at: new Date().toISOString(), done_by: await myDisplayName() }
    : { status, done: false, done_at: null, done_by: null };
  if (await dbUpdate("todos", id, traced)) return traced;
  const plain: TodoStatusPatch = { status, done: isDone };
  return (await dbUpdate("todos", id, plain)) ? plain : null;
}
