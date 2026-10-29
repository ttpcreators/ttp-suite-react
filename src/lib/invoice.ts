/**
 * Calcul unique d'une facture (HT / TVA / TTC / commission / reversement créateur).
 * Partagé entre Facturation (édition), Reversements (paie) et les gains du créateur
 * (creator-report) pour que les trois écrans donnent EXACTEMENT le même « dû au créateur ».
 *
 * Règles (contrat de représentation) :
 *  - la commission se calcule sur le HT (hors taxe), jamais sur la TVA (due à l'État) ;
 *  - aucune commission sous COMMISSION_FLOOR_EUR de rémunération brute (HT) ;
 *  - chaque montant est arrondi au centime, la TVA sur le total HT (HT + TVA = TTC pile).
 */

export type LineItem = { id: string; label: string; qty: number; unit: number };
export type Totals = { ht: number; tva: number; ttc: number; commission: number; reversal: number };

// Seuil du contrat : pas de commission si la rémunération brute (HT) est < ce montant.
// (Défaut du contrat de représentation, cf. representationContract `seuil`.)
export const COMMISSION_FLOOR_EUR = 100;

/** Reste dû sous ce montant = écart d'arrondi (anciens versements arrondis à l'euro), pas un dû. */
export const PAYOUT_TOLERANCE_EUR = 0.5;

/** Arrondi au centime (0,1 + 0,2 → 0,3 ; jamais « -0 »). */
export const cents = (n: number): number => (Number.isFinite(n) ? Math.round(n * 100) / 100 || 0 : 0);
const finite = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? n : Number(n) || 0);

export function totalsOf(
  items: LineItem[],
  franchise: boolean,
  vatRate: number,
  commissionRate: number,
): Totals {
  const ht = cents((items ?? []).reduce((s, it) => s + finite(it?.qty) * finite(it?.unit), 0));
  const tva = franchise ? 0 : cents(ht * (finite(vatRate) / 100));
  const ttc = cents(ht + tva);
  // Commission sur le HT, et zéro sous le seuil.
  const commission = ht < COMMISSION_FLOOR_EUR ? 0 : cents(ht * (finite(commissionRate) / 100));
  const reversal = cents(ht - commission);
  return { ht, tva, ttc, commission, reversal };
}

/** Détail d'une facture tel que rangé dans le blob agence (`invoiceDetails`). */
export type InvoiceDetailLike = {
  items?: LineItem[] | null;
  franchise?: boolean | null;
  vatRate?: number | null;
  commissionRate?: number | null;
  /** Facture établie au nom et pour le compte du créateur (mandat) : sa TVA lui revient. */
  onBehalf?: boolean | null;
};

/**
 * Totaux d'une facture ENREGISTRÉE, même règle partout (Facturation, Reversements,
 * gains du créateur) :
 *  - facture détaillée (au moins une ligne) : ses lignes, sa TVA, SON taux ;
 *  - sinon (ancienne facture) : le montant enregistré, supposé HT sans TVA, au taux de la fiche.
 */
export function invoiceTotals(amount: number, detail: InvoiceDetailLike | null | undefined, rosterRate: number): Totals & { rate: number } {
  if (detail && Array.isArray(detail.items) && detail.items.length > 0) {
    const rate = detail.commissionRate != null && Number.isFinite(Number(detail.commissionRate)) ? Number(detail.commissionRate) : rosterRate;
    return { ...totalsOf(detail.items, !!detail.franchise, finite(detail.vatRate), rate), rate };
  }
  return { ...totalsOf([{ id: "x", label: "", qty: 1, unit: finite(amount) }], true, 0, rosterRate), rate: rosterRate };
}

/** Montant HT d'une facture enregistrée (chiffre d'affaires) : ses lignes si elle est
 *  détaillée, sinon le montant enregistré (ancienne facture, supposée HT sans TVA). */
export function invoiceHT(amount: number, detail?: InvoiceDetailLike | null): number {
  return invoiceTotals(amount, detail, 0).ht;
}
