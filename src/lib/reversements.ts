import { parseAmount } from "./money";
import { cents, invoiceTotals, PAYOUT_TOLERANCE_EUR, type InvoiceDetailLike } from "./invoice";

/**
 * Reversements créateurs (logique PURE, testée par reversements.test.ts) : ce que
 * l'agence doit à chaque créateur, au centime, avec la même règle que Facturation et
 * que les gains du créateur (`creator-report` + creatorGains.realGains) :
 *   - dû = part créateur (HT moins commission) des factures PAYÉES par la marque ;
 *   - versé = virements enregistrés (blob `creatorPayouts`) ;
 *   - reste = dû moins versé.
 * Un créateur se reconnaît sans tenir compte des majuscules ni des espaces autour du nom
 * (« Léna Test » = « LÉNA TEST »), comme côté serveur : pas de ligne en double, pas de
 * taux par défaut pris à tort.
 */

export type RevInvoice = { id: string; amount: string | null; status: string | null; creator: string | null };
export type Payout = { id: string; date: string; amount: number; note?: string };
export type PayoutsMap = Record<string, Payout[]>;

export type RevRow = {
  /** Nom affiché (celui de la fiche roster s'il existe). */
  creator: string;
  /** Clés du blob `creatorPayouts` qui désignent ce créateur (plusieurs graphies possibles). */
  keys: string[];
  /** Clé où ranger un nouveau versement (une clé existante de préférence). */
  writeKey: string;
  /** Payé par la marque, TTC. */
  encaisse: number;
  ht: number;
  /** Taux effectif (commission / HT), sinon taux de la fiche. */
  rate: number;
  commission: number;
  du: number;
  reverse: number;
  reste: number;
  payouts: Payout[];
};

const key = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export function reversementRows(input: {
  invoices: RevInvoice[];
  details: Record<string, InvoiceDetailLike | undefined>;
  payouts: PayoutsMap;
  /** Taux de la fiche roster, par nom. */
  rosterRates: Record<string, number>;
  /** Taux mémorisés à l'enregistrement d'une facture (blob `creatorCommission`), par nom. */
  savedRates: Record<string, number>;
  defaultRate: number;
}): RevRow[] {
  const roster = new Map<string, { name: string; rate: number }>();
  for (const [name, rate] of Object.entries(input.rosterRates)) roster.set(key(name), { name, rate });
  const saved = new Map<string, number>();
  for (const [name, rate] of Object.entries(input.savedRates ?? {})) if (Number.isFinite(Number(rate))) saved.set(key(name), Number(rate));
  const rateOf = (k: string) => roster.get(k)?.rate ?? saved.get(k) ?? input.defaultRate;

  type Acc = { name: string; encaisse: number; ht: number; commission: number; du: number; keys: string[] };
  const acc = new Map<string, Acc>();
  const bump = (raw: string): Acc => {
    const k = key(raw);
    let a = acc.get(k);
    if (!a) {
      a = { name: roster.get(k)?.name ?? raw.trim(), encaisse: 0, ht: 0, commission: 0, du: 0, keys: [] };
      acc.set(k, a);
    }
    return a;
  };
  for (const iv of input.invoices) {
    if (iv.status !== "payee" || !key(iv.creator)) continue;
    const a = bump(iv.creator as string);
    const t = invoiceTotals(parseAmount(iv.amount), input.details[iv.id], rateOf(key(iv.creator)));
    a.encaisse += t.ttc;
    a.ht += t.ht;
    a.commission += t.commission;
    a.du += t.reversal;
  }
  // Les créateurs qui ont déjà des versements apparaissent aussi (même sans facture payée).
  for (const [k, list] of Object.entries(input.payouts ?? {})) {
    if (!key(k) || !Array.isArray(list)) continue;
    bump(k).keys.push(k);
  }

  const out: RevRow[] = [];
  for (const [k, a] of acc) {
    const payouts = a.keys.flatMap((pk) => input.payouts[pk] ?? []).sort((x, y) => String(y.date ?? "").localeCompare(String(x.date ?? "")));
    const reverse = cents(payouts.reduce((s, p) => s + (Number(p.amount) || 0), 0));
    const ht = cents(a.ht);
    const commission = cents(a.commission);
    const du = cents(a.du);
    const writeKey = a.keys.find((pk) => (input.payouts[pk] ?? []).length > 0) ?? a.keys[0] ?? a.name;
    out.push({
      creator: a.name,
      keys: a.keys,
      writeKey,
      encaisse: cents(a.encaisse),
      ht,
      rate: ht > 0 ? Math.round((commission / ht) * 100) : rateOf(k),
      commission,
      du,
      reverse,
      reste: cents(du - reverse),
      payouts,
    });
  }
  return out.sort((x, y) => y.reste - x.reste);
}

/** Reste à verser (au-delà de l'écart d'arrondi toléré). */
export const owesMoney = (r: Pick<RevRow, "reste">) => r.reste > PAYOUT_TOLERANCE_EUR;
/** Versé plus que dû (facture supprimée ou repassée « en attente » après un virement). */
export const overpaid = (r: Pick<RevRow, "reste">) => r.reste < -PAYOUT_TOLERANCE_EUR;
