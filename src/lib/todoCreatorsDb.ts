/*
 * To-do · plusieurs créateurs : accès base (la logique pure vit dans todoCreators.ts).
 * L'app marche AVANT le SQL 2026-10-21-taches-plusieurs-createurs : la présence de la
 * colonne `todos.creators` est détectée une fois puis gardée en mémoire.
 */
import { supabase } from "./supabase";
import { creatorOrFilter, creatorsColumnMissing } from "./todoCreators";

let known: boolean | null = null;
let probing: Promise<boolean> | null = null;

/** Note ce que dit une lecture déjà faite (`select *` : la colonne est là ou pas). */
export function noteCreatorsColumn(rows: readonly Record<string, unknown>[] | null | undefined): void {
  if (known === null && rows && rows.length) known = "creators" in rows[0];
}

/** La colonne `todos.creators` existe-t-elle ? (une seule vérification par session) */
export function todosHaveCreators(): Promise<boolean> {
  if (known !== null) return Promise.resolve(known);
  probing ??= (async () => {
    const { error } = await supabase.from("todos").select("creators").limit(1);
    if (!error) known = true;
    else if (creatorsColumnMissing(error)) known = false;
    probing = null;
    return known ?? false; // autre erreur (réseau) : on n'envoie pas la colonne, on réessaiera
  })();
  return probing;
}

/**
 * Tâches d'un créateur (premier de la liste OU dans la liste). Sans la colonne, repli
 * sur l'ancien filtre `creator = nom` et sur `columns` sans `creators`.
 */
export async function selectTodosFor<T>(name: string, columns: string): Promise<{ data: T[] | null; error: { message: string } | null }> {
  const cols = `${columns},creator,creators`;
  if (known !== false) {
    const r = await supabase.from("todos").select(cols).or(creatorOrFilter(name)).order("sort_order");
    if (!r.error) {
      known = true;
      return { data: r.data as T[] | null, error: null };
    }
    if (!creatorsColumnMissing(r.error)) return { data: null, error: r.error };
    known = false;
  }
  const r = await supabase.from("todos").select(`${columns},creator`).eq("creator", name).order("sort_order");
  return { data: r.data as T[] | null, error: r.error };
}
