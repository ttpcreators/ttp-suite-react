/**
 * Rapport mensuel d'un créateur : ses gains, ses collabs, l'évolution de ses chiffres
 * et ce que l'agence lui a apporté sur le mois. Les données arrivent de la fonction
 * serveur `creator-report` (déjà filtrées sur le créateur) ; tout le calcul est ici,
 * en fonctions pures testées. Mêmes règles d'argent que Facturation et Reversements
 * (totalsOf : commission sur le HT, rien sous le seuil).
 */
import { totalsOf, type LineItem } from "./invoice";
import { parseAmount, parseAmountStrict, formatEuro } from "./money";
import { toISODate } from "./dates";
import { DEFAULT_COMMISSION, parseCommissionPct } from "./commission";
import { fmtCompact } from "./timeSeries";

type Hist = { d: string; f: number }[];
export type ReportData = {
  /** false : membre de l'agence non fondateur, l'argent n'est pas transmis. */
  money?: boolean;
  creator: {
    name: string;
    commission?: string | null;
    ig?: { history?: Hist; insights?: { at?: string; reach?: number; views?: number; interactions?: number } } | null;
    tt?: { history?: Hist } | null;
    yt?: { history?: Hist } | null;
  };
  invoices: { id: string; ref?: string | null; party?: string | null; amount?: string | null; date?: string | null; status?: string | null; created_at?: string | null }[];
  details: Record<string, { items?: LineItem[]; franchise?: boolean; vatRate?: number; commissionRate?: number; issueDate?: string }>;
  payouts: { id?: string; date: string; amount: number; note?: string }[];
  collabs: { id: string; brand: string; deliverables?: string | null; cachet?: string | null; step: number; status?: string | null; created_at: string }[];
  steps: { collab_id: string; step: number; reached_at: string }[];
  gifting: { brand?: string | null; product?: string | null; value?: string | null; received_on?: string | null; created_at?: string | null }[];
  engagement: { date: string; platform?: string; platformLabel?: string; er: string }[];
};

export type ReportInvoice = { ref: string; party: string; share: number; status: "payee" | "attente" };
export type PlatformStat = { label: string; start: number; end: number; delta: number; pct: number | null };
export type MonthlyReport = {
  month: string; // "2026-10"
  label: string; // "octobre 2026"
  inProgress: boolean;
  earnings: { billed: number; commission: number; share: number; cashed: number; pending: number; paidOut: number; yearShare: number; rate: number };
  invoices: ReportInvoice[];
  newCollabs: { brand: string; cachet: string }[];
  published: { brand: string; deliverables: string }[];
  ongoing: number;
  stats: PlatformStat[];
  reach: { reach: number; views: number } | null;
  engagement: { er: string; prev: string | null; label: string } | null;
  gifts: { count: number; value: number; brands: string[] };
  agency: string[];
  empty: boolean;
};

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** "2026-10" → "octobre 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[(m || 1) - 1]} ${y}`;
}
/** Mois courant "YYYY-MM" (heure locale). */
export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
/** Décale un mois "YYYY-MM" de `n` mois. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return currentMonth(d);
}
const monthOf = (s: unknown) => toISODate(s).slice(0, 7);

/** Mois d'une facture : date d'émission, sinon date saisie, sinon création. */
export function invoiceMonth(inv: ReportData["invoices"][number], det?: ReportData["details"][string]): string {
  return monthOf(det?.issueDate) || monthOf(inv.date) || monthOf(inv.created_at);
}

/** Abonnés au début (dernier relevé avant le mois, sinon 1er du mois) et à la fin du mois. */
export function followersOver(hist: Hist | undefined, month: string): { start: number; end: number } | null {
  const pts = (hist ?? []).filter((p) => p?.d && typeof p.f === "number" && p.f > 0).sort((a, b) => a.d.localeCompare(b.d));
  const before = pts.filter((p) => p.d.slice(0, 7) < month);
  const inside = pts.filter((p) => p.d.slice(0, 7) === month);
  if (!inside.length) return null;
  const start = (before.length ? before[before.length - 1] : inside[0]).f;
  return { start, end: inside[inside.length - 1].f };
}

export function buildMonthlyReport(data: ReportData, month: string, now = new Date()): MonthlyReport {
  const year = month.slice(0, 4);
  const rosterRate = parseCommissionPct(data.creator.commission) ?? DEFAULT_COMMISSION;

  // ── Gains : factures émises dans le mois (hors brouillons), part du créateur après commission.
  const earnings = { billed: 0, commission: 0, share: 0, cashed: 0, pending: 0, paidOut: 0, yearShare: 0, rate: rosterRate };
  const invoices: ReportInvoice[] = [];
  for (const inv of data.invoices) {
    const status = inv.status ?? "";
    if (status === "brouillon" || !status) continue;
    const det = data.details[inv.id];
    const m = invoiceMonth(inv, det);
    if (!m) continue;
    const t = det && Array.isArray(det.items)
      ? totalsOf(det.items, det.franchise ?? true, det.vatRate ?? 0, det.commissionRate ?? rosterRate)
      : totalsOf([{ id: "x", label: "", qty: 1, unit: parseAmount(inv.amount) }], true, 0, rosterRate);
    if (m.slice(0, 4) === year && m <= month) earnings.yearShare += t.reversal;
    if (m !== month) continue;
    earnings.billed += t.ht;
    earnings.commission += t.commission;
    earnings.share += t.reversal;
    if (status === "payee") earnings.cashed += t.reversal;
    else earnings.pending += t.reversal;
    invoices.push({ ref: inv.ref ?? "", party: inv.party ?? "", share: Math.round(t.reversal), status: status === "payee" ? "payee" : "attente" });
  }
  earnings.paidOut = data.payouts.filter((p) => monthOf(p.date) === month).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  if (earnings.billed > 0) earnings.rate = Math.round((earnings.commission / earnings.billed) * 100);
  for (const k of ["billed", "commission", "share", "cashed", "pending", "paidOut", "yearShare"] as const) earnings[k] = Math.round(earnings[k]);

  // ── Collabs : signées dans le mois, publiées dans le mois, en cours.
  const live = data.collabs.filter((c) => c.status !== "archivee");
  const newCollabs = live.filter((c) => monthOf(c.created_at) === month).map((c) => ({ brand: c.brand, cachet: c.cachet?.trim() ?? "" }));
  const pubMonth = new Map<string, string>();
  for (const s of data.steps) {
    if (s.step < 6) continue;
    const m = monthOf(s.reached_at);
    const prev = pubMonth.get(s.collab_id);
    if (!prev || m < prev) pubMonth.set(s.collab_id, m);
  }
  const published = live.filter((c) => pubMonth.get(c.id) === month).map((c) => ({ brand: c.brand, deliverables: c.deliverables?.trim() ?? "" }));
  const ongoing = live.filter((c) => c.step < 11 && monthOf(c.created_at) <= month).length;

  // ── Chiffres : abonnés par réseau, couverture Instagram, engagement mesuré par l'agence.
  const stats: PlatformStat[] = [];
  for (const [label, h] of [["Instagram", data.creator.ig?.history], ["TikTok", data.creator.tt?.history], ["YouTube", data.creator.yt?.history]] as const) {
    const f = followersOver(h, month);
    if (!f) continue;
    const delta = f.end - f.start;
    stats.push({ label, start: f.start, end: f.end, delta, pct: f.start > 0 ? (delta / f.start) * 100 : null });
  }
  const ins = data.creator.ig?.insights;
  const reach = ins && monthOf(ins.at) === month && (ins.reach || ins.views) ? { reach: ins.reach ?? 0, views: ins.views ?? 0 } : null;
  const eng = [...data.engagement].filter((e) => monthOf(e.date) <= month).sort((a, b) => toISODate(a.date).localeCompare(toISODate(b.date)));
  const inMonth = eng.filter((e) => monthOf(e.date) === month);
  const last = inMonth[inMonth.length - 1];
  const prevE = last ? eng.filter((e) => monthOf(e.date) < month && (e.platform ?? "") === (last.platform ?? "")).pop() : undefined;
  const engagement = last ? { er: last.er, prev: prevE?.er ?? null, label: last.platformLabel || "Instagram" } : null;

  // ── Gifting reçu.
  const giftRows = data.gifting.filter((g) => monthOf(g.received_on || g.created_at) === month);
  const gifts = {
    count: giftRows.length,
    value: Math.round(giftRows.reduce((s, g) => s + parseAmount(g.value), 0)),
    brands: [...new Set(giftRows.map((g) => g.brand?.trim()).filter((b): b is string => !!b))],
  };

  // ── Ce que l'agence t'a apporté (phrases simples, seulement ce qui existe).
  const agency: string[] = [];
  if (newCollabs.length) {
    // Cachet ambigu (« 800 € x 2 ») ou illisible : ignoré dans le total, jamais un nombre
    // faux. S'il en manque, le total devient un minimum (« au moins »).
    const amounts = newCollabs.map((c) => parseAmountStrict(c.cachet));
    const total = amounts.reduce<number>((s, a) => s + (a ?? 0), 0);
    const partial = amounts.some((a) => a === null);
    agency.push(`${newCollabs.length} nouvelle${newCollabs.length > 1 ? "s" : ""} collab${newCollabs.length > 1 ? "s" : ""} décrochée${newCollabs.length > 1 ? "s" : ""} et négociée${newCollabs.length > 1 ? "s" : ""} pour toi (${newCollabs.map((c) => c.brand).join(", ")})${total ? `, pour ${partial ? "au moins " : ""}${formatEuro(Math.round(total))} de cachets` : ""}`);
  }
  if (earnings.share) agency.push(`${formatEuro(earnings.share)} facturés et suivis pour toi : devis, factures et relances, tu n'as rien eu à gérer`);
  if (published.length) agency.push(`${published.length} campagne${published.length > 1 ? "s" : ""} publiée${published.length > 1 ? "s" : ""} et suivie${published.length > 1 ? "s" : ""} jusqu'au bilan envoyé à la marque`);
  if (gifts.count) agency.push(`${gifts.count} envoi${gifts.count > 1 ? "s" : ""} de produits reçu${gifts.count > 1 ? "s" : ""}${gifts.brands.length ? ` (${gifts.brands.join(", ")})` : ""}${gifts.value ? `, d'une valeur de ${formatEuro(gifts.value)}` : ""}`);
  const grew = stats.filter((s) => s.delta > 0);
  if (grew.length) agency.push(`Ton audience a grandi : ${grew.map((s) => `+${fmtCompact(s.delta)} abonnés sur ${s.label}`).join(", ")}`);

  const empty = !invoices.length && !earnings.paidOut && !newCollabs.length && !published.length && !stats.length && !engagement && !gifts.count;
  return {
    month,
    label: monthLabel(month),
    inProgress: month === currentMonth(now),
    earnings,
    invoices,
    newCollabs,
    published,
    ongoing,
    stats,
    reach,
    engagement,
    gifts,
    agency,
    empty,
  };
}
