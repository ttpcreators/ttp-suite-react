import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useLiveKey } from "./useLive";
import { getCache, setCache } from "./viewCache";
import { getAppState, invalidateAppState, mergeAppStateKey } from "./appState";
import { todayISO } from "./dates";
import type { RelanceInvoice, Reminder, Reminders } from "./relance";

/**
 * Factures lues pour les relances (page Relances, « Aujourd'hui », palette ⌘K) :
 * UNE requête, un cache partagé (`relanceInvoices`), rafraîchie à chaque tick live.
 * `enabled` = false : rien n'est lu (palette fermée) mais le cache reste servi.
 * Un rafraîchissement raté garde la liste déjà affichée (`error` passe à true).
 */
export function useRelanceInvoices(enabled = true): { invoices: RelanceInvoice[] | null; error: boolean } {
  const [invoices, setInvoices] = useState<RelanceInvoice[] | null>(() => getCache<RelanceInvoice[]>("relanceInvoices"));
  const [error, setError] = useState(false);
  const live = useLiveKey();

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    supabase
      .from("invoices")
      .select("id,ref,party,amount,date,status,creator")
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          setError(true);
          return;
        }
        const next = (data as RelanceInvoice[]) ?? [];
        setCache("relanceInvoices", next);
        setInvoices(next);
        setError(false); // un chargement réussi efface l'erreur précédente
      });
    return () => {
      alive = false;
    };
  }, [live, enabled]);

  return { invoices, error };
}

/**
 * Enregistre une relance (date du jour + compteur) dans le blob agence `invoiceReminders`.
 * Relecture fraîche puis fusion de la SEULE facture relancée : on n'écrase jamais les
 * compteurs des autres. Renvoie la table à jour, ou null si l'écriture a échoué.
 */
export async function recordReminder(id: string): Promise<Reminders | null> {
  try {
    invalidateAppState();
    const fresh = ((await getAppState())["invoiceReminders"] as Reminders) ?? {};
    const cur = fresh[id];
    const entry: Reminder = { last: todayISO(), count: (cur?.count ?? 0) + 1 };
    const ok = await mergeAppStateKey("invoiceReminders", { [id]: entry });
    return ok ? { ...fresh, [id]: entry } : null;
  } catch {
    return null;
  }
}
