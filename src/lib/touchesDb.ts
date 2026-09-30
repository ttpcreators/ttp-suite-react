import { supabase } from "./supabase";
import { dbUpdate } from "./db";
import { parseTouches, buildTouchesPatch, type Touch } from "./touches";

/**
 * Écriture du journal de touches SANS écraser les ajouts concurrents (autre
 * appareil, cron gmail-reconcile qui ajoute des « gm<id> ») : on relit la
 * ligne juste avant, on applique le changement, puis on écrit.
 */
export type TouchChange = { add: Touch } | { remove: string };

export type TouchesRow = { touches: Touch[]; last_contacted: string | null };

/** Applique un changement à une liste (pur, testable). */
export function applyTouchChange(list: Touch[], change: TouchChange): Touch[] {
  if ("add" in change) return [change.add, ...list.filter((t) => t.id !== change.add.id)];
  return list.filter((t) => t.id !== change.remove);
}

/**
 * Relit `touches,last_contacted`, applique le changement et écrit.
 * Renvoie les nouvelles valeurs de la ligne, ou null en cas d'échec.
 */
export async function updateTouches(contactId: string, change: TouchChange): Promise<TouchesRow | null> {
  const { data, error } = await supabase.from("contacts").select("touches,last_contacted").eq("id", contactId).maybeSingle();
  if (error || !data) return null;
  const cur = data as { touches?: unknown; last_contacted?: string | null };
  const next = applyTouchChange(parseTouches(cur.touches), change);
  const patch = buildTouchesPatch(next, cur.last_contacted ?? null);
  if (!(await dbUpdate("contacts", contactId, patch))) return null;
  return { touches: next, last_contacted: (patch.last_contacted as string | undefined) ?? cur.last_contacted ?? null };
}
