import type { StatusTone } from "./statusTone";
import { parseAmount } from "./money";
import { isOverdueInvoice } from "./relance";
import { totalsOf } from "./invoice";

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

// ── Ce que la créatrice touche VRAIMENT (net) ───────────────────────────────
/*
 * Le montant d'une facture est le brut HT facturé à la marque. La part du créateur =
 * ce montant moins la commission de l'agence (taux de SA fiche, rien sous le seuil du
 * contrat) : exactement le calcul de Reversements pour une facture simple (`totalsOf`).
 * Le détail d'une facture avec TVA vit dans le blob agence, illisible ici : pour elle,
 * c'est la même estimation (le montant est supposé HT).
 */

/** Part nette du créateur sur un montant facturé. */
export function netShare(amount: number, ratePct: number): number {
  return Math.round(totalsOf([{ id: "x", label: "", qty: 1, unit: amount }], true, 0, ratePct).reversal);
}

/** Statut d'un versement, en mots de créatrice : à venir (en préparation), en cours (la marque paie), versé. */
export type PayoutKey = "avenir" | "encours" | "verse";
export function payoutStatus(inv: Pick<GainInvoice, "status">): { key: PayoutKey; label: string; tone: StatusTone } {
  if (inv.status === "payee") return { key: "verse", label: "Versé", tone: "ok" };
  if (inv.status === "attente" || inv.status === "retard") return { key: "encours", label: "En cours", tone: "progress" };
  return { key: "avenir", label: "À venir", tone: "closed" };
}

export type NetGains = {
  /** Ce qui arrive : tout ce qui n'est pas encore versé (en cours + à venir), net. */
  coming: number;
  /** Déjà versé, net. */
  paid: number;
  /** Une marque paie en retard (l'agence relance) : net concerné. */
  late: number;
  /** Dernier versement (la facture payée la plus récente de la liste). */
  last: { amount: number; party: string } | null;
};

/** Gains nets à partir des factures (plus récentes d'abord, comme l'espace les lit). */
export function netGains(invoices: GainInvoice[], ratePct: number, now: Date = new Date()): NetGains {
  const g: NetGains = { coming: 0, paid: 0, late: 0, last: null };
  for (const inv of invoices) {
    const net = netShare(parseAmount(inv.amount), ratePct);
    const { key } = payoutStatus(inv);
    if (key === "verse") {
      g.paid += net;
      if (!g.last) g.last = { amount: net, party: (inv.party ?? "").trim() };
    } else {
      g.coming += net;
      if (invoiceTone(inv, now).tone === "late") g.late += net;
    }
  }
  return g;
}

// ── Vrais versements (fonction serveur `creator-report`) ────────────────────
/*
 * `creator-report` renvoie, filtrés sur la créatrice : ses factures (avec id), le détail
 * des factures saisies en détail (lignes, TVA, taux de la facture) et les virements que
 * l'agence lui a vraiment faits (blob `creatorPayouts`, page Reversements). Même calcul
 * que Reversements :
 *   - dû = part nette des factures que la marque a payées ;
 *   - versé = somme des virements de l'agence ;
 *   - en cours = dû moins versé (la marque a payé, l'agence vire bientôt) ;
 *   - à venir = part nette des factures pas encore payées par la marque.
 */

export type ReportInvoice = GainInvoice & { id: string };
export type ReportDetail = { items?: { id: string; label: string; qty: number; unit: number }[]; franchise?: boolean; vatRate?: number; commissionRate?: number };
export type RealPayout = { id?: string; date: string; amount: number; note?: string };

/** Part nette d'une facture : détail exact s'il existe, sinon le taux de sa fiche. */
export function invoiceNet(inv: ReportInvoice, details: Record<string, ReportDetail>, ratePct: number): number {
  const d = details[inv.id];
  if (d && Array.isArray(d.items) && d.items.length) {
    return Math.round(totalsOf(d.items, d.franchise !== false, Number(d.vatRate) || 0, d.commissionRate != null ? Number(d.commissionRate) : ratePct).reversal);
  }
  return netShare(parseAmount(inv.amount), ratePct);
}

export type GainLine = { key: string; label: string; amount: number; status: PayoutKey; date: string | null };

export type RealGains = NetGains & {
  /** La marque a payé, l'agence n'a pas encore viré. */
  owed: number;
  /** Lignes de « Tes versements » : en cours, à venir (une par facture), puis versés. */
  lines: GainLine[];
};

export function realGains(
  invoices: ReportInvoice[],
  details: Record<string, ReportDetail>,
  payouts: RealPayout[],
  ratePct: number,
  now: Date = new Date(),
): RealGains {
  let due = 0;
  let upcoming = 0;
  let late = 0;
  const lines: GainLine[] = [];
  for (const inv of invoices) {
    const net = invoiceNet(inv, details, ratePct);
    if (inv.status === "payee") {
      due += net;
      continue;
    }
    upcoming += net;
    if (invoiceTone(inv, now).tone === "late") late += net;
    lines.push({ key: `inv:${inv.id}`, label: (inv.party ?? "").trim(), amount: net, status: "avenir", date: inv.date });
  }
  const done = [...payouts]
    .filter((p) => Number(p.amount) > 0)
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  const paid = Math.round(done.reduce((s, p) => s + Number(p.amount), 0));
  const owed = Math.max(0, Math.round(due) - paid);
  if (owed > 0) lines.unshift({ key: "owed", label: "", amount: owed, status: "encours", date: null });
  for (const [i, p] of done.entries()) {
    lines.push({ key: `pay:${p.id ?? i}`, label: (p.note ?? "").trim(), amount: Math.round(Number(p.amount)), status: "verse", date: p.date });
  }
  const last = done[0] ? { amount: Math.round(Number(done[0].amount)), party: (done[0].note ?? "").trim() } : null;
  return { coming: owed + upcoming, paid, late, last, owed, lines };
}

/** Libellé et couleur d'un statut de versement (mêmes mots que `payoutStatus`). */
export const PAYOUT_LABEL: Record<PayoutKey, { label: string; tone: StatusTone }> = {
  avenir: { label: "À venir", tone: "closed" },
  encours: { label: "En cours", tone: "progress" },
  verse: { label: "Versé", tone: "ok" },
};
