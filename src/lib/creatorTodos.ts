/*
 * « À faire » de l'espace créateur, sur le modèle de la To-do agence (règles PURES,
 * testées par creatorTodos.test.ts) : filtres, tuiles du haut, groupes par priorité,
 * retard et report d'échéance.
 */
import { toISODate } from "./dates";

export type CtTodo = {
  id: string;
  text: string;
  due: string | null;
  priority: string | null;
  done: boolean;
  status?: string | null;
};

export type CtFilter = "encours" | "retard" | "terminees" | "toutes";
export type CtPriority = "haute" | "moyenne" | "basse";
export type CtKpi = "encours" | "retard" | "prioritaires" | "terminees";

const DAY = 86400000;
const localDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Statut affiché : « Fait » dès que la tâche est faite, sinon le statut gardé (« À faire » par défaut). */
export const ctStatus = (r: CtTodo): string => (r.done ? "Fait" : r.status ?? "À faire");

/** Jours de retard d'une tâche ouverte dont l'échéance est passée (0 sinon). */
export function ctLateDays(r: CtTodo, today: string): number {
  if (r.done) return 0;
  const iso = toISODate(r.due);
  if (!iso || iso >= today) return 0;
  return Math.round((localDay(today).getTime() - localDay(iso).getTime()) / DAY);
}

export function ctMatchFilter(f: CtFilter, r: CtTodo, today: string): boolean {
  return f === "encours" ? !r.done : f === "retard" ? ctLateDays(r, today) > 0 : f === "terminees" ? r.done : true;
}

/** Tuiles du haut (chacune filtre la liste). */
export function ctKpis(rows: readonly CtTodo[], today: string): Record<CtKpi, number> {
  return {
    encours: rows.filter((r) => !r.done).length,
    retard: rows.filter((r) => ctLateDays(r, today) > 0).length,
    prioritaires: rows.filter((r) => !r.done && r.priority === "haute").length,
    terminees: rows.filter((r) => r.done).length,
  };
}

/** Groupes de la liste par priorité (inconnue → « autre »), dans l'ordre haute, moyenne, basse. */
export function ctGroups<T extends CtTodo>(rows: readonly T[]): { key: CtPriority | "autre"; rows: T[] }[] {
  const keys: (CtPriority | "autre")[] = ["haute", "moyenne", "basse", "autre"];
  const keyOf = (r: T): CtPriority | "autre" => {
    const p = r.priority ?? "moyenne";
    return p === "haute" || p === "moyenne" || p === "basse" ? p : "autre";
  };
  return keys.map((key) => ({ key, rows: rows.filter((r) => keyOf(r) === key) })).filter((g) => g.rows.length > 0);
}

/** Nouvelle échéance d'un report : `n` jours après l'échéance à venir, sinon après aujourd'hui. */
export function ctPostpone(r: CtTodo, n: number, today: string): string {
  const iso = toISODate(r.due);
  const base = iso && iso > today ? iso : today;
  const d = localDay(base);
  d.setDate(d.getDate() + n);
  return isoOf(d);
}

/** Titre de ligne : 45 caractères au plus (le texte entier reste dans la fiche et au survol). */
export const clip45 = (t: string) => (t.length > 45 ? `${t.slice(0, 44).trimEnd()}…` : t);
