/**
 * Calcul unique d'une facture (HT / TVA / TTC / commission / reversement créateur).
 * Partagé entre Facturation (édition) et Reversements (paie) pour que les deux écrans
 * donnent EXACTEMENT le même « dû au créateur ».
 *
 * Règles (contrat de représentation) :
 *  - la commission se calcule sur le HT (hors taxe), jamais sur la TVA (due à l'État) ;
 *  - aucune commission sous COMMISSION_FLOOR_EUR de rémunération brute (HT).
 */

export type LineItem = { id: string; label: string; qty: number; unit: number };
export type Totals = { ht: number; tva: number; ttc: number; commission: number; reversal: number };

// Seuil du contrat : pas de commission si la rémunération brute (HT) est < ce montant.
// (Défaut du contrat de représentation, cf. representationContract `seuil`.)
export const COMMISSION_FLOOR_EUR = 100;

export function totalsOf(
  items: LineItem[],
  franchise: boolean,
  vatRate: number,
  commissionRate: number,
): Totals {
  const ht = items.reduce((s, it) => s + (it.qty || 0) * (it.unit || 0), 0);
  const tva = franchise ? 0 : ht * (vatRate / 100);
  const ttc = ht + tva;
  // Commission sur le HT, et zéro sous le seuil.
  const commission = ht < COMMISSION_FLOOR_EUR ? 0 : ht * (commissionRate / 100);
  const reversal = ht - commission;
  return { ht, tva, ttc, commission, reversal };
}
