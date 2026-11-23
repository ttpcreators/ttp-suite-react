/**
 * Reversements créateurs : ce que l'agence doit à chaque créateur, au centime.
 * La règle vit dans UN seul fichier, supabase/functions/_shared/reversements.ts, partagé
 * avec le connecteur Claude (outil `reversements` d'Alfred) et le résumé du matin : la page
 * et Alfred donnent toujours le même reste à verser. Ce module la réexporte avec les types
 * de l'app.
 *   - dû = part créateur (HT moins commission) des factures PAYÉES par la marque ;
 *   - versé = virements enregistrés (blob `creatorPayouts`) ;
 *   - reste = dû moins versé.
 * L'argent dû à un ancien créateur (sorti du roster) reste dû : il garde sa ligne.
 */
import {
  activeRosterNames,
  allocate,
  overpaid,
  owesMoney,
  reversementRows as sharedRows,
  reversementTotals,
  type RevLine,
  type RevRow as SharedRow,
} from "../../supabase/functions/_shared/reversements.ts";

export { activeRosterNames, allocate, overpaid, owesMoney, reversementTotals, type RevLine };

export type RevInvoice = {
  id: string; amount: string | null; status: string | null; creator: string | null;
  /** Pour le détail (facultatifs) : marque, numéro, dates, collab. */
  party?: string | null; ref?: string | null; date?: string | null; paid_at?: string | null; collab_id?: string | null;
};
export type Payout = { id: string; date: string; amount: number; note?: string };
export type PayoutsMap = Record<string, Payout[]>;
export type RevRow = SharedRow<Payout>;

export const reversementRows = (input: Parameters<typeof sharedRows<Payout>>[0]): RevRow[] => sharedRows<Payout>(input);
