/*
 * To-do « Chaque semaine » : règles pures (testées). Une tâche hebdomadaire est
 * « faite » si son dernier « Fait » date de cette semaine (depuis lundi 0 h).
 */

export type RoutineDone = { at: string; by?: string };
export type Routine = {
  id: string; text: string; weekday: number | null; priority: string;
  done_log: RoutineDone[] | null; sort_order: number; created_at: string;
};

/** Lundi 0 h (heure de l'appareil) de la semaine de `now`. */
export function weekStart(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/** Faite cette semaine ? */
export function doneThisWeek(r: Pick<Routine, "done_log">, now = new Date()): boolean {
  const log = Array.isArray(r.done_log) ? r.done_log : [];
  const last = log[log.length - 1];
  return !!last && new Date(last.at) >= weekStart(now);
}
