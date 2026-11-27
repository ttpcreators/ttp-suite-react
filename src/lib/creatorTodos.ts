/*
 * « À faire » de l'espace créateur, sur le modèle de la To-do agence (règles PURES,
 * testées par creatorTodos.test.ts) : filtres, tuiles du haut, groupes par priorité,
 * retard et report d'échéance. Seules les tâches « Pour toi » comptent (todoVisibility.ts).
 */
import { toISODate } from "./dates";
import { pourToi } from "./todoVisibility";

export type CtTodo = {
  id: string;
  text: string;
  due: string | null;
  priority: string | null;
  done: boolean;
  status?: string | null;
  source?: string | null;
  /** Tâche de l'agence demandée au créateur (SQL 2026-11-27 ; undefined tant que la colonne manque). */
  pour_createur?: boolean | null;
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

/** Jours de retard d'une tâche ouverte dont l'échéance est passée (0 sinon). Une tâche suivie
 *  par l'agence n'est jamais en retard pour le créateur : ce n'est pas à lui de la faire. */
export function ctLateDays(r: CtTodo, today: string): number {
  if (r.done || !pourToi(r)) return 0;
  const iso = toISODate(r.due);
  if (!iso || iso >= today) return 0;
  return Math.round((localDay(today).getTime() - localDay(iso).getTime()) / DAY);
}

export function ctMatchFilter(f: CtFilter, r: CtTodo, today: string): boolean {
  return f === "encours" ? !r.done : f === "retard" ? ctLateDays(r, today) > 0 : f === "terminees" ? r.done : true;
}

/** Tuiles du haut (chacune filtre la liste) : seulement les tâches « Pour toi ». */
export function ctKpis(rows: readonly CtTodo[], today: string): Record<CtKpi, number> {
  const mine = rows.filter(pourToi);
  return {
    encours: mine.filter((r) => !r.done).length,
    retard: mine.filter((r) => ctLateDays(r, today) > 0).length,
    prioritaires: mine.filter((r) => !r.done && r.priority === "haute").length,
    terminees: mine.filter((r) => r.done).length,
  };
}

/*
 * Ce que le créateur peut faire d'une tâche (vague 1). Trois sortes :
 *   « sienne »   : pas une tâche de l'agence, il fait tout ;
 *   « demandee » : l'agence la lui demande ; il la termine, ajoute sous-tâches et fichiers,
 *                  mais ne la modifie, ne la reporte ni ne la supprime ;
 *   « suivie »   : travail de l'agence, il la lit et répond (« Où j'en suis ») seulement.
 * Avant le SQL, toute tâche visible de l'agence est « demandee » (voir pourToi).
 */
export type CtSorte = "sienne" | "demandee" | "suivie";
export const ctSorte = (r: Pick<CtTodo, "source" | "pour_createur">): CtSorte =>
  r.source !== "agency" ? "sienne" : pourToi(r) ? "demandee" : "suivie";

/** `modifier` couvre le titre, les détails, la priorité et « Reporter ». */
export type CtDroits = { terminer: boolean; modifier: boolean; supprimer: boolean; sousTaches: boolean; deposer: boolean };
export function ctDroits(r: Pick<CtTodo, "source" | "pour_createur">): CtDroits {
  const s = ctSorte(r);
  return { terminer: s !== "suivie", modifier: s === "sienne", supprimer: s === "sienne", sousTaches: s !== "suivie", deposer: s !== "suivie" };
}

/**
 * Retirer une pièce jointe : toutes sur sa tâche ; sur une tâche demandée, seulement les
 * siennes (rangées sous `mesFichiers`, son dossier « creator-uploads/<son id>/ ») ; aucune
 * sur une tâche suivie par l'agence.
 */
export function ctPeutRetirer(r: Pick<CtTodo, "source" | "pour_createur">, path: string, mesFichiers: string): boolean {
  const s = ctSorte(r);
  return s === "sienne" || (s === "demandee" && mesFichiers !== "" && path.startsWith(mesFichiers));
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
