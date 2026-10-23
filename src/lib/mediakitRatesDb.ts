import { supabase } from "./supabase";
import { dbUpdate } from "./db";
import { mergeRates, type KitRate, type RatesMerge } from "./mediakitRates";

/*
 * Lecture et écriture de la grille de tarifs d'un media kit (`creators.mediakit.rates`).
 * Toujours relue FRAÎCHE juste avant d'écrire, et seule `rates` change : le reste du kit
 * (bio, photos, plateformes, thème…) n'est jamais écrasé.
 */

type Kit = { rates?: KitRate[]; hideRates?: boolean } & Record<string, unknown>;

/** Media kit actuel du créateur ({} s'il n'en a pas encore), ou null si la lecture échoue. */
export async function readKit(creatorId: string): Promise<Kit | null> {
  const { data, error } = await supabase.from("creators").select("mediakit").eq("id", creatorId).maybeSingle();
  if (error) return null;
  const mk = (data as { mediakit?: Kit | null } | null)?.mediakit;
  return mk && typeof mk === "object" ? mk : {};
}

/** Fusionne `computed` dans la grille du kit (relue fraîche) et l'enregistre. */
export async function writeKitRates(creatorId: string, computed: KitRate[]): Promise<RatesMerge | null> {
  const fresh = await readKit(creatorId);
  if (!fresh) return null;
  const merge = mergeRates(Array.isArray(fresh.rates) ? fresh.rates : [], computed);
  const ok = await dbUpdate("creators", creatorId, { mediakit: { ...fresh, rates: merge.rates } });
  return ok ? merge : null;
}
