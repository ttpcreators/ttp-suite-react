import { supabase } from "./supabase";
import { getAppState, saveAppStateKey } from "./appState";

/**
 * Corbeille GLOBALE de l'app. Toute suppression « douce » (via dbTrash) copie la
 * ligne complète dans le blob app_state `trashBin` AVANT de la retirer de sa
 * table. On peut ensuite restaurer (ré-insertion) ou supprimer définitivement.
 * Purge automatique après 30 jours (déclenchée à l'ouverture de la Corbeille).
 */

export type TrashEntry = {
  id: string;
  table: string;
  label: string;
  sub?: string;
  data: Record<string, unknown>;
  deletedAt: string;
};

export const TRASH_TTL_DAYS = 30;

/** Libellé lisible par table (pour l'affichage de la corbeille). */
export const TABLE_LABELS: Record<string, string> = {
  briefs: "Brief",
  contacts: "Contact",
  ideas: "Idée",
  todos: "À faire",
  prospects: "Prospect",
  creators: "Créateur",
  invoices: "Facture",
};

let _uid = 0;
function uid(): string {
  _uid += 1;
  return `tr${Date.now().toString(36)}${_uid}`;
}

async function readBin(): Promise<TrashEntry[]> {
  const state = await getAppState();
  return (state.trashBin as TrashEntry[]) ?? [];
}

/**
 * Suppression douce : sauvegarde la ligne dans la corbeille puis la supprime de
 * sa table. Renvoie true si la suppression en base a réussi.
 */
export async function dbTrash(table: string, id: string, label: string, sub?: string): Promise<boolean> {
  const { data } = await supabase.from(table).select("*").eq("id", id).limit(1);
  const row = (data?.[0] as Record<string, unknown>) ?? { id };
  const entry: TrashEntry = { id: uid(), table, label, sub, data: row, deletedAt: new Date().toISOString() };
  const bin = await readBin();
  await saveAppStateKey("trashBin", [entry, ...bin]);

  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) {
    console.warn(`[trash] delete ${table}:`, error.message);
    return false;
  }
  return true;
}

/** Restaure une entrée : ré-insère la ligne dans sa table + retire de la corbeille. */
export async function restoreEntry(entry: TrashEntry): Promise<boolean> {
  const data: Record<string, unknown> = { ...entry.data };
  for (const k of ["id", "created_at", "updated_at"]) delete data[k];
  const { error } = await supabase.from(entry.table).insert(data);
  if (error) {
    console.warn(`[trash] restore ${entry.table}:`, error.message);
    return false;
  }
  const bin = (await readBin()).filter((e) => e.id !== entry.id);
  await saveAppStateKey("trashBin", bin);
  return true;
}

/** Supprime définitivement une entrée de la corbeille. */
export async function purgeEntry(id: string): Promise<void> {
  const bin = (await readBin()).filter((e) => e.id !== id);
  await saveAppStateKey("trashBin", bin);
}

/** Vide toute la corbeille. */
export async function emptyTrash(): Promise<void> {
  await saveAppStateKey("trashBin", []);
}

/** Jours restants avant purge automatique (0 = à purger). */
export function daysLeft(entry: TrashEntry): number {
  const deleted = new Date(entry.deletedAt).getTime();
  const elapsed = (Date.now() - deleted) / 86400000;
  return Math.max(0, Math.ceil(TRASH_TTL_DAYS - elapsed));
}

/** Purge les entrées de plus de 30 jours. Renvoie la liste nettoyée (ou null si rien changé). */
export async function purgeExpired(bin: TrashEntry[]): Promise<TrashEntry[] | null> {
  const now = Date.now();
  const kept = bin.filter((e) => (now - new Date(e.deletedAt).getTime()) / 86400000 < TRASH_TTL_DAYS);
  if (kept.length === bin.length) return null;
  await saveAppStateKey("trashBin", kept);
  return kept;
}
