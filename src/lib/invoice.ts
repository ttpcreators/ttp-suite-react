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
  /** Devise de la facture (« EUR » si absente) et valeur d'une unité en euros (`fxRate`). */
  currency?: string | null;
  fxRate?: number | null;
};

/** Devises proposées sur une facture. */
export const CURRENCIES = ["EUR", "USD", "GBP", "CHF"] as const;

/** Taux de conversion vers l'euro d'une facture : 1 en euros, sinon son `fxRate` (null s'il manque). */
export function eurRateOf(detail: Pick<InvoiceDetailLike, "currency" | "fxRate"> | null | undefined): number | null {
  const cur = String(detail?.currency ?? "EUR").toUpperCase();
  if (cur === "EUR") return 1;
  const r = Number(detail?.fxRate);
  return Number.isFinite(r) && r > 0 ? r : null;
}

/** Totaux convertis en euros (devise étrangère sans taux : laissés tels quels, signalés à l'écran). */
function inEuros<T extends Totals>(t: T, rate: number | null): T {
  if (rate == null || rate === 1) return t;
  return { ...t, ht: cents(t.ht * rate), tva: cents(t.tva * rate), ttc: cents(t.ttc * rate), commission: cents(t.commission * rate), reversal: cents(t.reversal * rate) };
}

/**
 * Totaux d'une facture ENREGISTRÉE, même règle partout (Facturation, Reversements,
 * gains du créateur) :
 *  - facture détaillée (au moins une ligne) : ses lignes, sa TVA, SON taux ;
 *  - sinon (ancienne facture) : le montant enregistré, supposé HT sans TVA, au taux de la fiche.
 * Facture en devise étrangère : les totaux sont rendus EN EUROS (taux `fxRate` de la facture),
 * pour que le chiffre d'affaires, la commission et les reversements ne prennent jamais 1 $ pour 1 €.
 */
export function invoiceTotals(amount: number, detail: InvoiceDetailLike | null | undefined, rosterRate: number): Totals & { rate: number } {
  if (detail && Array.isArray(detail.items) && detail.items.length > 0) {
    const rate = detail.commissionRate != null && Number.isFinite(Number(detail.commissionRate)) ? Number(detail.commissionRate) : rosterRate;
    const fx = eurRateOf(detail);
    let t = totalsOf(detail.items, !!detail.franchise, finite(detail.vatRate), rate);
    // Devise étrangère : le seuil « pas de commission sous 100 € » se juge sur le HT EN EUROS.
    if (fx != null && fx !== 1) {
      const commission = cents(t.ht * fx) < COMMISSION_FLOOR_EUR ? 0 : cents(t.ht * (finite(rate) / 100));
      t = { ...t, commission, reversal: cents(t.ht - commission) };
    }
    return { ...inEuros(t, fx), rate };
  }
  return { ...totalsOf([{ id: "x", label: "", qty: 1, unit: finite(amount) }], true, 0, rosterRate), rate: rosterRate };
}

/** Montant HT d'une facture enregistrée (chiffre d'affaires) : ses lignes si elle est
 *  détaillée, sinon le montant enregistré (ancienne facture, supposée HT sans TVA). */
export function invoiceHT(amount: number, detail?: InvoiceDetailLike | null): number {
  return invoiceTotals(amount, detail, 0).ht;
}

/**
 * Montant TTC d'une facture en devise étrangère, dans SA devise (« 1 000,00 $US »), tel
 * qu'il est écrit sur la facture envoyée à la marque. null pour une facture en euros ou
 * sans lignes : le montant enregistré (en euros) fait alors foi.
 */
export function foreignAmountLabel(detail: InvoiceDetailLike | null | undefined): string | null {
  const cur = String(detail?.currency ?? "EUR").toUpperCase();
  if (cur === "EUR" || !detail || !Array.isArray(detail.items) || !detail.items.length) return null;
  const ttc = totalsOf(detail.items, !!detail.franchise, finite(detail.vatRate), 0).ttc;
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: cur, minimumFractionDigits: 2 }).format(ttc).replace(/[\u202f]/g, "\u00a0");
  } catch {
    return `${ttc} ${cur}`;
  }
}
