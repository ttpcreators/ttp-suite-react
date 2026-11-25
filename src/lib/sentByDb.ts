/*
 * « Envoyé par » (page Mails) : lecture du journal des envois (logique pure : sentBy.ts).
 * L'app marche AVANT le SQL 2026-11-25-mails-envoye-par : colonne absente → liste vide,
 * gardé en mémoire pour ne pas redemander à chaque fil.
 */
import { supabase } from "./supabase";
import type { SendLogRow } from "./sentBy";

let missing = false;
const COLS = "thread_id,gmail_message_id,created_at,envoye_par,envoye_par_nom";

const columnMissing = (e: { code?: string; message?: string }) =>
  e.code === "42703" || e.code === "PGRST204" || /envoye_par/.test(e.message ?? "");

/** Envois journalisés de ces fils (au plus 400 fils, par paquets de 100). Ne lève jamais. */
export async function loadSendLog(threadIds: string[]): Promise<SendLogRow[]> {
  const ids = [...new Set(threadIds.filter(Boolean))].slice(0, 400);
  if (missing || !ids.length) return [];
  const out: SendLogRow[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase
      .from("email_activity")
      .select(COLS)
      .eq("direction", "out")
      .in("thread_id", ids.slice(i, i + 100))
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) {
      if (columnMissing(error)) missing = true;
      return out;
    }
    out.push(...((data ?? []) as SendLogRow[]));
  }
  return out;
}
