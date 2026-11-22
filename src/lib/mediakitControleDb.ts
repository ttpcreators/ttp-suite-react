import { supabase } from "@/lib/supabase";
import { dbUpdate } from "@/lib/db";
import { getAppState, invalidateAppState, type AppState } from "@/lib/appState";
import { appliquerCorrections, controlerKit, type Mesure } from "../../supabase/functions/_shared/mediakitControle.ts";

/**
 * Met les chiffres réels dans le media kit d'un créateur (bouton « Mettre à jour » de la fiche
 * roster). Relit le kit et les mesures à l'instant (jamais à partir de ce que la page a
 * affiché), ne change que les chiffres « à corriger » (même règle que maj_chiffres_mediakit
 * d'Alfred : bio, marques, tarifs et photos restent tels quels), puis enregistre.
 */
export async function mettreChiffresReels(id: string, name: string): Promise<{ ok: true; changements: string[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.from("creators").select("mediakit, ig, tt, yt").eq("id", id).maybeSingle();
  if (error || !data) return { ok: false, error: "Fiche illisible, réessaie" };
  invalidateAppState();
  let mesures: Mesure[] = [];
  try {
    const st = (await getAppState()) as AppState;
    mesures = (st["engagementHistory"] as Mesure[] | undefined) ?? [];
  } catch {
    return { ok: false, error: "Mesures illisibles, réessaie" };
  }
  const row = data as { mediakit: unknown; ig: unknown; tt: unknown; yt: unknown };
  const res = appliquerCorrections(row.mediakit, controlerKit({ name, ...row }, mesures));
  if ("error" in res) return { ok: false, error: res.error };
  if (!res.changements.length) return { ok: true, changements: [] };
  const ok = await dbUpdate("creators", id, { mediakit: res.mediakit });
  return ok ? { ok: true, changements: res.changements } : { ok: false, error: "Enregistrement échoué, réessaie" };
}
