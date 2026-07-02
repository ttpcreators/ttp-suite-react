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
  // Google Calendar sync : toute mutation UI de `events` doit repasser en
  // sync_source='agence' pour être re-poussée vers Google. Une ligne d'origine
  // Google (sync_source='google') qui n'est PAS re-flaguée ne serait jamais
  // resynchronisée. Le trigger DB le force aussi (defense-in-depth), on le pose
  // ici pour cohérence du cache optimiste côté client.
  const finalPatch =
    table === "events" ? { ...patch, sync_source: "agence" } : patch;
  const { error } = await supabase.from(table).update(finalPatch).eq("id", id);
  if (error) {
    console.warn(`[db] update ${table}:`, error.message);
    return false;
  }
  return true;
}

export async function dbDelete(table: string, id: string): Promise<boolean> {
  // Google Calendar sync : sur `events`, on NE fait PAS de delete physique
  // (la suppression ne serait jamais propagée à Google). On pose un tombstone
  // (deleted=true) que le PUSH transforme en gcalDelete, puis pg_cron purge à J+7.
  // (Un trigger BEFORE DELETE côté DB agit aussi en filet de sécurité.)
  if (table === "events") {
    const { error } = await supabase
      .from("events")
      .update({
        deleted: true,
        deleted_at: new Date().toISOString(),
        sync_source: "agence",
      })
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
