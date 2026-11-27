/*
 * To-do de l'agence : tâche DEMANDÉE au créateur, ou SUIVIE par l'agence (vague 1, contrat a).
 *
 * Colonne `todos.pour_createur` (SQL 2026-11-27) : true = l'agence demande la tâche au
 * créateur, c'est à lui de la faire. Elle ne compte que pour `source = 'agency'` et entraîne
 * `visible_createur = true` (la base le pose). Avant le SQL la colonne manque : l'app ne
 * l'envoie jamais, et une tâche visible reste « pour lui », comme aujourd'hui.
 *
 * Qui est prévenu (push) : seulement les créateurs d'une tâche « Pour toi » (sa tâche, ou une
 * tâche visible que l'agence lui demande). Une tâche suivie par l'agence se lit dans son
 * espace, sans push. Logique pure, testée par todoDemande.test.ts.
 */
import { normalizeCreators, todoCreators, type TodoCreatorsRow } from "./todoCreators";

export type TacheVue = TodoCreatorsRow & { source?: string | null; visible_createur?: boolean | null; pour_createur?: boolean | null };

/** Champs de visibilité qu'on peut écrire (pour_createur seulement si la colonne existe). */
export type PatchVisibilite = { visible_createur?: boolean; pour_createur?: boolean };

const cle = (s: string) => s.trim().toLocaleLowerCase("fr");

/** Le créateur voit-il la tâche ? (même règle que visiblePourCreateur, src/lib/todoVisibility.ts) */
const vue = (t: TacheVue) => t.source !== "agency" || t.visible_createur === true;

/**
 * La tâche est-elle « pour lui » : la sienne, ou demandée par l'agence ? Même condition que
 * `pourToi` (src/lib/todoVisibility.ts, lot A) : colonne absente (undefined) = pour lui.
 */
const pourLui = (t: TacheVue) => t.source !== "agency" || t.pour_createur !== false;

/** Créateurs prévenus des nouveautés d'une tâche (push) : ceux d'une tâche visible et « pour lui ». */
export function creatorsANotifier(t: TacheVue): string[] {
  return vue(t) && pourLui(t) ? todoCreators(t) : [];
}

/**
 * Tâche créée par l'agence (formulaire, ajout rapide) : avec au moins un créateur, elle lui est
 * demandée (visible et à faire par lui) ; sans créateur (« L'agence, tâche interne »), interne.
 */
export function visibiliteCreation(nbCreateurs: number, avecColonne: boolean): PatchVisibilite {
  const on = nbCreateurs > 0;
  return { visible_createur: on, ...(avecColonne ? { pour_createur: on } : {}) };
}

/**
 * « Confier à » ou « Modifier » d'une tâche de l'agence : passer d'aucun créateur à au moins un
 * la rend visible et demandée ; n'en garder aucun (« rendue à l'agence ») la rend interne.
 * D'un créateur à un autre, rien ne change (une tâche rendue interne avec la case
 * « Côté créateur » le reste).
 */
export function patchConfier(t: TacheVue, apres: readonly string[], avecColonne: boolean): PatchVisibilite {
  if (t.source !== "agency") return {};
  const avant = todoCreators(t).length > 0;
  const ensuite = normalizeCreators(apres).length > 0;
  if (!avant && ensuite) return { visible_createur: true, ...(avecColonne ? { pour_createur: true } : {}) };
  if (avant && !ensuite) return { visible_createur: false, ...(avecColonne ? { pour_createur: false } : {}) };
  return {};
}

/** Créateurs à prévenir (push « task ») après « Confier à » ou « Modifier » : ceux qui la reçoivent. */
export function aPrevenirApresConfier(t: TacheVue, apres: readonly string[], patch: PatchVisibilite): string[] {
  if (t.source !== "agency") return [];
  const ensuite: TacheVue = { ...t, ...patch, creator: normalizeCreators(apres)[0] ?? null, creators: normalizeCreators(apres) };
  if (!vue(ensuite) || !pourLui(ensuite)) return [];
  const deja = new Set(creatorsANotifier(t).map(cle));
  return normalizeCreators(apres).filter((n) => !deja.has(cle(n)));
}

/**
 * Toast de « Confier à » et de « Modifier » : une tâche qui reste interne (rappel automatique de
 * collab, tâche rendue interne avec la case « Côté créateur ») n'est pas vue par les créateurs
 * qu'on lui donne. Renvoie la mention à ajouter, sinon "" : « Tâche confiée à X ✓ » seul
 * laisserait croire que X la voit (constat W4).
 */
export function mentionCachee(t: TacheVue, apres: readonly string[], patch: PatchVisibilite): string {
  const qui = normalizeCreators(apres);
  if (t.source !== "agency" || !qui.length || vue({ ...t, ...patch })) return "";
  return qui.length > 1 ? "interne, cachée aux créateurs" : "interne, cachée au créateur";
}

/** Même liste de créateurs, sans tenir compte de l'ordre, de la casse ni des doublons. */
export function memesCreateurs(a: readonly string[], b: readonly string[]): boolean {
  const x = new Set(normalizeCreators(a).map(cle));
  const y = new Set(normalizeCreators(b).map(cle));
  return x.size === y.size && [...x].every((n) => y.has(n));
}

/**
 * Push au créateur quand l'agence termine une tâche (constat W16) : « Ta demande est faite »
 * (task-done) seulement pour une tâche que le créateur a écrite lui-même ; « Tâche terminée »
 * (task-closed) pour une tâche que l'agence lui demandait ; rien pour une tâche interne ou
 * suivie par l'agence.
 */
export function pushFinTache(t: TacheVue): { kind: "task-done" | "task-closed"; to: string[] } | null {
  const to = creatorsANotifier(t);
  if (!to.length) return null;
  return { kind: t.source === "creator" ? "task-done" : "task-closed", to };
}

/** La colonne `todos.pour_createur` n'existe pas encore (SQL 2026-11-27 pas lancé). */
export function pourCreateurColumnMissing(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  const m = err.message ?? "";
  return (err.code === "42703" || err.code === "PGRST204" || /does not exist|column|schema cache/i.test(m)) && /pour_createur/.test(m);
}
