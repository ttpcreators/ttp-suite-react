import { supabase } from "./supabase";
import { dbInsert } from "./db";
import { pokeTeam } from "./team";
import { collabIdMissing } from "./collabLinks";

/*
 * Dépôts du créateur depuis son espace (contenu, facture, stats) dans la table documents.
 * Un dépôt fait depuis une mission garde le lien vers sa collab : colonne
 * `documents.collab_id` (SQL 2026-11-27). L'app part en ligne avant ce SQL : sans la
 * colonne, le dépôt se fait sans le lien, comme avant.
 */

/**
 * Ajoute la ligne du dépôt. Avec `collabId`, elle garde le lien vers la collab. Colonne
 * absente ou lien refusé par la base (`collabIdMissing` : 42703, PGRST204 ou message qui
 * cite collab_id), on recommence une fois sans le lien : le dépôt ne doit jamais échouer à
 * cause de lui. null : ligne refusée (l'appelant retire le fichier et prévient).
 */
export async function insertCreatorDoc<T extends Record<string, unknown>>(row: T, collabId?: string | null): Promise<(T & { id: string }) | null> {
  if (collabId) {
    // Insertion directe : dbInsert avale l'erreur, il faut la lire pour savoir si on recommence.
    const { data, error } = await supabase.from("documents").insert({ ...row, collab_id: collabId }).select();
    if (!error) {
      pokeTeam("documents");
      return (data?.[0] as (T & { id: string }) | undefined) ?? null;
    }
    if (!collabIdMissing(error)) {
      console.warn("[db] insert documents:", error.message);
      return null;
    }
  }
  return dbInsert("documents", row);
}
