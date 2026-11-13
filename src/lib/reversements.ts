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

export type RevInvoice = {
  id: string; amount: string | null; status: string | null; creator: string | null;
  /** Pour le détail (facultatifs) : marque, numéro, dates, collab. */
  party?: string | null; ref?: string | null; date?: string | null; paid_at?: string | null; collab_id?: string | null;
};

/**
 * Une facture payée par la marque, dans le détail d'un créateur : sa part, et ce que les
 * virements déjà faits couvrent (les plus anciennes factures d'abord).
 */
export type RevLine = {
  id: string; brand: string; ref: string; paidOn: string; collabId: string | null;
  /** Part du créateur sur cette facture. */
  du: number;
  /** Déjà couvert par les virements. */
  covered: number;
  state: "reverse" | "partiel" | "a_reverser";
};
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
  /** Factures payées qui font ce montant, des plus récentes aux plus anciennes. */
  lines: RevLine[];
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
  /** Factures sans reversement : la marque a payé le créateur (collab en mode « créateur »)
   *  ou facture de commission de l'agence au créateur (src/lib/compta.ts). */
  skip?: ReadonlySet<string>;
}): RevRow[] {
  const roster = new Map<string, { name: string; rate: number }>();
  for (const [name, rate] of Object.entries(input.rosterRates)) roster.set(key(name), { name, rate });
  const saved = new Map<string, number>();
  for (const [name, rate] of Object.entries(input.savedRates ?? {})) if (Number.isFinite(Number(rate))) saved.set(key(name), Number(rate));
  const rateOf = (k: string) => roster.get(k)?.rate ?? saved.get(k) ?? input.defaultRate;

  type Acc = { name: string; encaisse: number; ht: number; commission: number; du: number; keys: string[]; lines: Omit<RevLine, "covered" | "state">[] };
  const acc = new Map<string, Acc>();
  const bump = (raw: string): Acc => {
    const k = key(raw);
    let a = acc.get(k);
    if (!a) {
      a = { name: roster.get(k)?.name ?? raw.trim(), encaisse: 0, ht: 0, commission: 0, du: 0, keys: [], lines: [] };
      acc.set(k, a);
    }
    return a;
  };
  for (const iv of input.invoices) {
    if (iv.status !== "payee" || !key(iv.creator) || input.skip?.has(iv.id)) continue;
    const a = bump(iv.creator as string);
    const t = invoiceTotals(parseAmount(iv.amount), input.details[iv.id], rateOf(key(iv.creator)));
    a.encaisse += t.ttc;
    a.ht += t.ht;
    a.commission += t.commission;
    // Facture au nom du créateur (mandat) : la TVA facturée est la sienne, elle lui est reversée.
    const share = t.reversal + (input.details[iv.id]?.onBehalf ? t.tva : 0);
    a.du += share;
    a.lines.push({
      id: iv.id, brand: (iv.party ?? "").trim(), ref: (iv.ref ?? "").trim(),
      paidOn: String(iv.paid_at ?? iv.date ?? "").slice(0, 10), collabId: iv.collab_id ?? null, du: cents(share),
    });
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
      lines: allocate(a.lines, reverse),
    });
  }
  return out.sort((x, y) => y.reste - x.reste);
}

/** Reste à verser (au-delà de l'écart d'arrondi toléré). */
export const owesMoney = (r: Pick<RevRow, "reste">) => r.reste > PAYOUT_TOLERANCE_EUR;
/** Versé plus que dû (facture supprimée ou repassée « en attente » après un virement). */
export const overpaid = (r: Pick<RevRow, "reste">) => r.reste < -PAYOUT_TOLERANCE_EUR;

/** Répartit le total versé sur les factures, les plus anciennes d'abord. */
export function allocate(lines: Omit<RevLine, "covered" | "state">[], paid: number): RevLine[] {
  let left = cents(paid);
  const oldestFirst = [...lines].sort((x, y) => x.paidOn.localeCompare(y.paidOn) || x.id.localeCompare(y.id));
  const out = oldestFirst.map((l): RevLine => {
    const covered = cents(Math.max(0, Math.min(l.du, left)));
    left = cents(left - covered);
    const state = l.du - covered <= PAYOUT_TOLERANCE_EUR ? "reverse" : covered > 0 ? "partiel" : "a_reverser";
    return { ...l, covered, state };
  });
  return out.reverse();
}
