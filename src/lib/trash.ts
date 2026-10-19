import { supabase } from "./supabase";
import { pokeTeam } from "./team";
import { getAppState, invalidateAppState, listAppStateKey } from "./appState";

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
  collabs: "Collab",
  gifting: "Gifting",
  contacts: "Contact",
  ideas: "Idée",
  todos: "À faire",
  prospects: "Prospect",
  creators: "Créateur",
  invoices: "Facture",
  creator_pool: "Scouting créateur",
  athlete_pool: "Scouting sportif",
};

let _uid = 0;
function uid(): string {
  _uid += 1;
  return `tr${Date.now().toString(36)}${_uid}`;
}

async function readBin(): Promise<TrashEntry[]> {
  // Lecture FRAÎCHE (le cache peut être périmé vs un autre poste).
  invalidateAppState();
  const state = await getAppState();
  return (state.trashBin as TrashEntry[]) ?? [];
}

// Modifications du blob `trashBin` : seules les entrées ajoutées / retirées sont
// envoyées (écriture partielle côté base, sous verrou) → deux postes qui mettent à la
// corbeille en même temps ne s'effacent plus, même entre onglets. Les appels restent
// sérialisés dans l'onglet. `change` est soit le changement direct, soit une fonction
// qui reçoit la liste FRAÎCHE (relue) et renvoie le changement (ou null = ne rien
// écrire). Renvoie le succès de l'écriture.
type BinChange = { add?: TrashEntry[]; remove?: string[] };
let _binChain: Promise<unknown> = Promise.resolve();
function mutateBin(change: BinChange | ((bin: TrashEntry[]) => BinChange | null)): Promise<boolean> {
  const run = _binChain.then(async () => {
    const c = typeof change === "function" ? change(await readBin()) : change;
    if (c === null) return true; // rien à écrire
    return listAppStateKey("trashBin", c.add ?? [], c.remove ?? [], true);
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
  const saved = await mutateBin({ add: [entry] });
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
    await mutateBin({ remove: [entry.id] });
    return false;
  }
  pokeTeam(table); // prévient l'équipe agence (« Marc a supprimé… »)
  return true;
}

/** Résultat d'une restauration : "partial" = ligne ré-insérée mais entrée
 *  toujours présente dans la corbeille (retrait du blob échoué). */
export type RestoreResult = "ok" | "partial" | "failed";

/** Restaure une entrée : ré-insère la ligne dans sa table + retire de la corbeille. */
export async function restoreEntry(entry: TrashEntry): Promise<RestoreResult> {
  const data: Record<string, unknown> = { ...entry.data };
  // On CONSERVE l'id d'origine (la ligne a été supprimée → aucun conflit) : sinon la
  // ligne restaurée reçoit un nouvel uuid et les données indexées par id (commentaires
  // `itemNotes` des idées/tâches) deviennent orphelines. On ne réinitialise que les
  // horodatages laissés à la base.
  for (const k of ["created_at", "updated_at"]) delete data[k];
  const { error } = await supabase.from(entry.table).insert(data);
  if (error) {
    console.warn(`[trash] restore ${entry.table}:`, error.message);
    return "failed";
  }
  const removed = await mutateBin({ remove: [entry.id] }).catch(() => false);
  return removed ? "ok" : "partial";
}

/** Supprime définitivement une entrée de la corbeille. Renvoie true si OK. */
export async function purgeEntry(id: string): Promise<boolean> {
  return mutateBin({ remove: [id] }).catch(() => false);
}

/** Vide toute la corbeille (les entrées relues à l'instant). Renvoie true si OK. */
export async function emptyTrash(): Promise<boolean> {
  return mutateBin((bin) => ({ remove: bin.map((e) => e.id) })).catch(() => false);
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
    const keep = (e: TrashEntry) => (now - new Date(e.deletedAt).getTime()) / 86400000 < TRASH_TTL_DAYS;
    const kept = fresh.filter(keep);
    if (kept.length === fresh.length) return null; // rien à purger → pas d'écriture
    result = kept;
    return { remove: fresh.filter((e) => !keep(e)).map((e) => e.id) };
  });
  return result;
}
