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
  gifting: "Gifting",
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

// Sérialise les modifications du blob `trashBin` (read-modify-write). Sans ça, deux
// opérations concurrentes (deux suppressions rapides, ou une suppression pendant la
// purge auto au montage de la Corbeille) lisent la même liste et s'écrasent : une
// entrée corbeille est perdue ALORS QUE la ligne source est déjà supprimée → perte
// irrécupérable. `fn` reçoit la liste FRAÎCHE et renvoie la nouvelle (ou null = ne
// rien écrire). Renvoie le succès de l'écriture. (Sérialisation intra-onglet ; les
// écritures cross-onglets restent last-writer-wins, borne acceptable ici.)
let _binChain: Promise<unknown> = Promise.resolve();
function mutateBin(fn: (bin: TrashEntry[]) => TrashEntry[] | null): Promise<boolean> {
  const run = _binChain.then(async () => {
    const next = fn(await readBin());
    if (next === null) return true; // rien à écrire
    return saveAppStateKey("trashBin", next);
  });
  _binChain = run.catch(() => {});
  return run;
}

/**
 * Suppression douce : sauvegarde la ligne dans la corbeille puis la supprime de
 * sa table. Renvoie true si la suppression en base a réussi.
 */
export async function dbTrash(table: string, id: string, label: string, sub?: string): Promise<boolean> {
  // 1) Lire la ligne COMPLÈTE. Si la lecture échoue (réseau/RLS) ou renvoie 0 ligne,
  //    on n'a rien de restaurable → on N'AVANCE PAS. Avant, on capturait une coquille
  //    { id } puis on supprimait quand même → perte de données définitive.
  const { data, error: readErr } = await supabase.from(table).select("*").eq("id", id).limit(1);
  if (readErr) {
    console.warn(`[trash] read ${table}:`, readErr.message);
    return false;
  }
  const row = data?.[0] as Record<string, unknown> | undefined;
  if (!row) {
    console.warn(`[trash] read ${table}: ligne introuvable (${id})`);
    return false;
  }
  // 2) Persister dans la corbeille AVANT de supprimer. Si l'écriture du blob échoue,
  //    on NE supprime PAS (sinon la ligne disparaît sans copie récupérable — perte
  //    silencieuse avec un faux « déplacé dans la corbeille ✓»).
  const entry: TrashEntry = { id: uid(), table, label, sub, data: row, deletedAt: new Date().toISOString() };
  const saved = await mutateBin((bin) => [entry, ...bin]);
  if (!saved) {
    console.warn(`[trash] écriture corbeille échouée (${table}) → suppression annulée`);
    return false;
  }

  // 3) Supprimer de la table source.
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) {
    console.warn(`[trash] delete ${table}:`, error.message);
    // La ligne existe toujours : on retire l'entrée corbeille qu'on venait d'ajouter
    // (best-effort) pour éviter un doublon fantôme dans la corbeille.
    await mutateBin((bin) => bin.filter((e) => e.id !== entry.id));
    return false;
  }
  return true;
}

/** Restaure une entrée : ré-insère la ligne dans sa table + retire de la corbeille. */
export async function restoreEntry(entry: TrashEntry): Promise<boolean> {
  const data: Record<string, unknown> = { ...entry.data };
  // On CONSERVE l'id d'origine (la ligne a été supprimée → aucun conflit) : sinon la
  // ligne restaurée reçoit un nouvel uuid et les données indexées par id (commentaires
  // `itemNotes` des idées/tâches) deviennent orphelines. On ne réinitialise que les
  // horodatages laissés à la base.
  for (const k of ["created_at", "updated_at"]) delete data[k];
  const { error } = await supabase.from(entry.table).insert(data);
  if (error) {
    console.warn(`[trash] restore ${entry.table}:`, error.message);
    return false;
  }
  await mutateBin((bin) => bin.filter((e) => e.id !== entry.id));
  return true;
}

/** Supprime définitivement une entrée de la corbeille. */
export async function purgeEntry(id: string): Promise<void> {
  await mutateBin((bin) => bin.filter((e) => e.id !== id));
}

/** Vide toute la corbeille. */
export async function emptyTrash(): Promise<void> {
  await mutateBin(() => []);
}

/** Jours restants avant purge automatique (0 = à purger). */
export function daysLeft(entry: TrashEntry): number {
  const deleted = new Date(entry.deletedAt).getTime();
  const elapsed = (Date.now() - deleted) / 86400000;
  return Math.max(0, Math.ceil(TRASH_TTL_DAYS - elapsed));
}

/** Purge les entrées de plus de 30 jours. Renvoie la liste nettoyée (ou null si rien changé).
 *  Écriture sérialisée sur une lecture fraîche (le param n'est plus utilisé pour l'écriture,
 *  gardé pour compat. d'appel). */
export async function purgeExpired(_bin: TrashEntry[]): Promise<TrashEntry[] | null> {
  const now = Date.now();
  let result: TrashEntry[] | null = null;
  await mutateBin((fresh) => {
    const kept = fresh.filter((e) => (now - new Date(e.deletedAt).getTime()) / 86400000 < TRASH_TTL_DAYS);
    if (kept.length === fresh.length) return null; // rien à purger → pas d'écriture
    result = kept;
    return kept;
  });
  return result;
}
