import { supabase } from "./supabase";

/**
 * Helpers de mutation Supabase (miroir de _dbInsert / _dbUpdate / _dbDelete de
 * l'ancienne app). Les tables ont la RLS : agence = tout, créateur = ses données.
 */

export async function dbInsert<T extends Record<string, unknown>>(
  table: string,
  row: T,
): Promise<(T & { id: string }) | null> {
  const { data, error } = await supabase.from(table).insert(row).select();
  if (error) {
    console.warn(`[db] insert ${table}:`, error.message);
    return null;
  }
  return (data && (data[0] as T & { id: string })) || null;
}

export async function dbUpdate(
  table: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { error } = await supabase.from(table).update(patch).eq("id", id);
  if (error) {
    console.warn(`[db] update ${table}:`, error.message);
    return false;
  }
  return true;
}

export async function dbDelete(table: string, id: string): Promise<boolean> {
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) {
    console.warn(`[db] delete ${table}:`, error.message);
    return false;
  }
  return true;
}

/** Prochain sort_order pour un tableau existant. */
export function nextOrder(rows: { sort_order?: number | null }[]): number {
  return rows.reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0) + 1;
}
