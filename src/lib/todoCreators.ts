/*
 * To-do · plusieurs créateurs sur une tâche (règles pures, testées).
 *
 * En base : `todos.creators` (text[]) = la liste ; `todos.creator` = le PREMIER de la
 * liste (gardé pour tous les lecteurs existants : notifications, corbeille, connecteur…).
 * Tant que le SQL 2026-10-21-taches-plusieurs-createurs n'est pas lancé, seule la colonne
 * `creator` existe : tout ici retombe sur elle.
 */
import { titleCase } from "./utils";

export type TodoCreatorsRow = { creator?: string | null; creators?: readonly (string | null)[] | null };

const key = (s: string) => s.trim().toLocaleLowerCase("fr");

/** Liste propre : noms rognés, vides retirés, doublons (casse ignorée) retirés, ordre gardé. */
export function normalizeCreators(list: readonly (string | null | undefined)[] | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list ?? []) {
    const name = (raw ?? "").trim();
    if (!name || seen.has(key(name))) continue;
    seen.add(key(name));
    out.push(name);
  }
  return out;
}

/** Créateurs d'une tâche : la liste si elle est remplie, sinon l'ancien champ seul. */
export function todoCreators(row: TodoCreatorsRow): string[] {
  const list = normalizeCreators(row.creators);
  return list.length ? list : normalizeCreators([row.creator]);
}

/** La tâche concerne-t-elle ce créateur (casse ignorée) ? */
export function hasCreator(row: TodoCreatorsRow, name: string): boolean {
  const k = key(name);
  return !!k && todoCreators(row).some((n) => key(n) === k);
}

/** Prénom affiché (« JUSTINE GENTET » → « Justine »). */
export const firstName = (name: string): string => titleCase(name.trim().split(/\s+/)[0] ?? "");

/**
 * Libellé d'un choix de créateurs : « Sélectionner… » (rien), le nom complet (un seul),
 * « Justine + 2 » (plusieurs : prénom du premier + nombre des autres).
 */
export function creatorsLabel(list: readonly string[], empty = "Sélectionner…"): string {
  const names = normalizeCreators(list);
  if (names.length === 0) return empty;
  if (names.length === 1) return titleCase(names[0]);
  return `${firstName(names[0])} + ${names.length - 1}`;
}

/** Noms complets à la suite : « Justine Gentet, Léna Martin et Inès ». */
export function joinNames(list: readonly string[], fmt: (s: string) => string = titleCase): string {
  const names = normalizeCreators(list).map(fmt);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
}

/**
 * Pour l'espace créateur : les AUTRES créateurs d'une tâche partagée, discrètement
 * (« Avec Justine », « Avec Justine et Léna », « Avec Justine, Léna et 2 autres »).
 * null si la tâche n'est qu'à lui.
 */
export function sharedWithLabel(row: TodoCreatorsRow, me: string): string | null {
  return sharedWithText(row, me, (fr, v) => fr.replace(/\{(\w+)\}/g, (_m, k: string) => String(v[k] ?? "")));
}

/**
 * Même chose, à travers une fonction de traduction `t(gabarit, variables)` (espace
 * créateur bilingue). Gabarits : « Avec {a} », « Avec {a} et {b} »,
 * « Avec {a}, {b} et {n} autre(s) ».
 */
export function sharedWithText(
  row: TodoCreatorsRow,
  me: string,
  t: (fr: string, vars: Record<string, string | number>) => string,
): string | null {
  const others = todoCreators(row).filter((n) => key(n) !== key(me));
  if (others.length === 0) return null;
  const [a, b] = others.slice(0, 2).map(firstName);
  const rest = others.length - 2;
  if (rest > 0) return t(rest > 1 ? "Avec {a}, {b} et {n} autres" : "Avec {a}, {b} et {n} autre", { a, b, n: rest });
  return b ? t("Avec {a} et {b}", { a, b }) : t("Avec {a}", { a });
}

/** Ajoute ou retire un créateur de la liste (case à cocher). */
export function toggleCreator(list: readonly string[], name: string): string[] {
  const names = normalizeCreators(list);
  return names.some((n) => key(n) === key(name)) ? names.filter((n) => key(n) !== key(name)) : [...names, name.trim()];
}

/** Avatars empilés : les `max` premiers, puis le nombre restant (« +N »). */
export function avatarStack<T>(list: readonly T[], max = 3): { shown: T[]; more: number } {
  return { shown: list.slice(0, max), more: Math.max(0, list.length - max) };
}

/** Valeur entre guillemets pour un filtre PostgREST (`or=(…)`). */
const quoted = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * Filtre `.or(...)` : tâches dont ce créateur est le premier OU fait partie de la liste.
 * Ex. `creator.eq."LÉNA MARTIN",creators.cs.{"LÉNA MARTIN"}`.
 */
export function creatorOrFilter(name: string): string {
  const q = quoted(name);
  return `creator.eq.${q},creators.cs.{${q}}`;
}

/** Erreur « colonne creators absente » (SQL pas encore lancé). */
export function creatorsColumnMissing(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!e) return false;
  return /creators/i.test(e.message ?? "") && (e.code === "42703" || e.code === "PGRST204" || /column|schema cache|does not exist/i.test(e.message ?? ""));
}

/**
 * Champs à écrire pour une liste de créateurs : `creator` = le premier (ou null, tâche
 * agence), `tag`, et `creators` seulement si la colonne existe.
 */
export function creatorsPatch(list: readonly string[], withColumn: boolean): { creator: string | null; tag: string; creators?: string[] } {
  const names = normalizeCreators(list);
  return {
    creator: names[0] ?? null,
    tag: names.length ? "CRÉATEUR" : "AGENCE",
    ...(withColumn ? { creators: names } : {}),
  };
}
