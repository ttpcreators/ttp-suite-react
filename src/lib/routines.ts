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

/**
 * Historique après un clic sur la case, calculé sur le `done_log` FRAIS de la base (un
 * collègue a pu cocher entre-temps). `wantDone` = ce que la personne a voulu d'après son
 * écran. null : la base est déjà dans cet état, rien à écrire. Décocher retire tous les
 * « Fait » de la semaine (deux personnes ont pu cocher), jamais ceux d'avant.
 */
export function nextDoneLog(fresh: RoutineDone[] | null, wantDone: boolean, entry: RoutineDone, now = new Date()): RoutineDone[] | null {
  const log = Array.isArray(fresh) ? fresh : [];
  if (doneThisWeek({ done_log: log }, now) === wantDone) return null;
  if (wantDone) return [...log, entry].slice(-100);
  const since = weekStart(now);
  return log.filter((x) => !(new Date(x.at) >= since));
}
