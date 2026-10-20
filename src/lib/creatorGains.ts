import type { StatusTone } from "./statusTone";
import { parseAmount } from "./money";
import { isOverdueInvoice } from "./relance";

/**
 * Gains de l'espace créateur (logique PURE, testable sous Node), à partir des
 * factures que l'espace lit déjà (`invoices` du créateur). Mêmes règles que le
 * reste de l'app :
 *   - encaissé = factures payées (comme le KPI « CA encaissé ») ;
 *   - total facturé = tout sauf les brouillons (une facture en préparation n'est pas
 *     encore facturée) ;
 *   - en retard = statut « retard », ou « attente » dont l'échéance est passée (règle
 *     de la page Relances). Le rouge « late » est réservé à cet argent en retard.
 */

export type GainInvoice = { ref: string; party: string; amount: string | null; date: string | null; status: string | null };

export type GainsSummary = {
  /** Payé. */
  cashed: number;
  /** En attente, échéance pas encore passée. */
  pending: number;
  /** En retard (argent dû). */
  late: number;
  /** À recevoir = en attente + en retard. */
  toReceive: number;
  /** Factures en préparation chez l'agence (brouillons). */
  upcoming: number;
  /** Total facturé (hors brouillons). */
  billed: number;
  /** Marques en retard de paiement (sans doublon, dans l'ordre des factures). */
  lateParties: string[];
};

/** Pastille d'une facture : un sens par couleur (voir statusTone.ts). */
export function invoiceTone(inv: Pick<GainInvoice, "status" | "date">, now: Date = new Date()): { tone: StatusTone; label: string } {
  if (inv.status === "payee") return { tone: "ok", label: "Payée" };
  if (inv.status === "attente" || inv.status === "retard") {
    return isOverdueInvoice({ status: inv.status, date: inv.date }, now) ? { tone: "late", label: "En retard" } : { tone: "wait", label: "En attente" };
  }
  return { tone: "closed", label: "En préparation" };
}

export function gainsSummary(invoices: GainInvoice[], now: Date = new Date()): GainsSummary {
  const s: GainsSummary = { cashed: 0, pending: 0, late: 0, toReceive: 0, upcoming: 0, billed: 0, lateParties: [] };
  for (const inv of invoices) {
    const amt = parseAmount(inv.amount);
    if (inv.status !== "brouillon") s.billed += amt;
    const { tone } = invoiceTone(inv, now);
    if (tone === "ok") s.cashed += amt;
    else if (tone === "wait") s.pending += amt;
    else if (tone === "late") {
      s.late += amt;
      const p = (inv.party ?? "").trim();
      if (p && !s.lateParties.includes(p)) s.lateParties.push(p);
    } else if (inv.status === "brouillon") s.upcoming += amt;
  }
  s.toReceive = s.pending + s.late;
  return s;
}
