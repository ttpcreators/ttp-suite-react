import { dbUpdate } from "./db";
import { myDisplayName, pokeTeam } from "./team";
import { supabase } from "./supabase";
import { synchroAgendaApresEcriture } from "./googleCalendar";
import { todayISO } from "./dates";
import { taskEventTitles } from "../../supabase/functions/_shared/taskEvent.ts";

export type TodoStatusPatch = { status: string; done: boolean; done_at?: string | null; done_by?: string | null };

/**
 * Écrit le statut d'une tâche + la trace du « Fait » (date et auteur). Repli sans la
 * trace tant que le SQL équipe n'est pas lancé. Renvoie ce qui a été enregistré.
 * Partagé par la page To-do, « Aujourd'hui » (bouton « Terminer ») et l'espace créateur.
 * Tâche faite : son évènement d'agenda « Tâche : … » à venir est retiré (clearTaskEvents).
 */
export async function writeTodoStatus(id: string, status: string): Promise<TodoStatusPatch | null> {
  const isDone = status === "Fait";
  const traced: TodoStatusPatch = isDone
    ? { status, done: true, done_at: new Date().toISOString(), done_by: await myDisplayName() }
    : { status, done: false, done_at: null, done_by: null };
  let saved: TodoStatusPatch | null = null;
  if (await dbUpdate("todos", id, traced)) saved = traced;
  else {
    const plain: TodoStatusPatch = { status, done: isDone };
    if (await dbUpdate("todos", id, plain)) saved = plain;
  }
  if (saved && isDone) void clearTaskEvents(id);
  return saved;
}

/**
 * Tâche faite : retire de l'agenda son évènement « Tâche : <texte> » d'aujourd'hui ou à venir
 * (titre exact, seul lien fiable). Même tombstone que dbDelete (deleted = true) pour que la
 * suppression parte aussi vers Google Agenda. Best-effort : un échec ne bloque pas la tâche.
 */
async function clearTaskEvents(id: string): Promise<void> {
  try {
    const { data } = await supabase.from("todos").select("text").eq("id", id).maybeSingle<{ text: string | null }>();
    const titles = taskEventTitles(data?.text);
    if (!titles.length) return;
    const { data: gone } = await supabase
      .from("events")
      .update({ deleted: true, deleted_at: new Date().toISOString(), sync_source: "agence" })
      .in("title", titles)
      .gte("date", todayISO())
      .eq("deleted", false)
      .select("id");
    if (gone?.length) {
      pokeTeam("events", { deleted: true });
      synchroAgendaApresEcriture(); // retiré aussi de Google Agenda dans les secondes qui suivent
    }
  } catch {
    /* best-effort */
  }
}
