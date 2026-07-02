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
  // Sync Google Agenda : toute modif UI d'un `event` doit repasser en
  // sync_source='agence' pour être re-poussée vers Google (le trigger DB le
  // force aussi ; on le pose ici pour cohérence du cache optimiste).
  const finalPatch = table === "events" ? { ...patch, sync_source: "agence" } : patch;
  const { error } = await supabase.from(table).update(finalPatch).eq("id", id);
  if (error) {
    console.warn(`[db] update ${table}:`, error.message);
    return false;
  }
  return true;
}

export async function dbDelete(table: string, id: string): Promise<boolean> {
  // Sync Google Agenda : sur `events`, on ne supprime PAS physiquement (sinon la
  // suppression ne serait jamais propagée à Google). On pose un tombstone
  // (deleted=true) que le push transforme en suppression Google, puis pg_cron purge.
  if (table === "events") {
    const { error } = await supabase
      .from("events")
      .update({ deleted: true, deleted_at: new Date().toISOString(), sync_source: "agence" })
      .eq("id", id);
    if (error) {
      console.warn(`[db] soft-delete events:`, error.message);
      return false;
    }
    return true;
  }

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
