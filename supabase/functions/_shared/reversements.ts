// ============================================================================
// _shared/reversements.ts : reversements créateurs et fins de contrat, côté serveur.
// Copie fidèle des règles de l'app (src/lib/reversements.ts, src/lib/invoice.ts,
// src/lib/compta.ts noPayoutIds / cashModeFor / mandatesFrom, src/lib/anticipation.ts
// contractEnd) : le connecteur Claude doit donner les MÊMES chiffres que les pages
// Reversements et Fins de contrat. Pur : testé par reversements.test.ts.
// ============================================================================

export const COMMISSION_FLOOR_EUR = 100;
export const PAYOUT_TOLERANCE_EUR = 0.5;
export const DEFAULT_COMMISSION = 20;

export const cents = (n: number): number => (Number.isFinite(n) ? Math.round(n * 100) / 100 || 0 : 0);
const finite = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? n : Number(n) || 0);
const key = (s: unknown) => String(s ?? "").trim().toLowerCase();

/** « 1 440,00 € », « 600 », 600 → nombre (0 si illisible). */
export function amountOf(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let t = String(v ?? "").replace(/[\s  ]/g, "").replace(/[^0-9,.-]/g, "");
  // « 1.440,00 » : le point sépare les milliers.
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : 0;
}

/** « 25% », « 25 », « 25,5 % » → 25 ; null si vide. */
export function pctOf(s: unknown): number | null {
  const m = /(\d+(?:[.,]\d+)?)/.exec(String(s ?? ""));
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}

export type Detail = {
  items?: { qty?: unknown; unit?: unknown }[];
  franchise?: boolean;
  vatRate?: unknown;
  commissionRate?: unknown;
  onBehalf?: boolean | null;
  kind?: string | null;
};

/** Totaux d'une facture (lignes détaillées si elles existent, sinon montant enregistré, sans TVA). */
export function invoiceTotals(amount: number, detail: Detail | null | undefined, rosterRate: number) {
  const items = detail && Array.isArray(detail.items) && detail.items.length ? detail.items : null;
  const rate = items && detail!.commissionRate != null && Number.isFinite(Number(detail!.commissionRate)) ? Number(detail!.commissionRate) : rosterRate;
  const ht = cents((items ?? [{ qty: 1, unit: amount }]).reduce((s, it) => s + finite(it?.qty) * finite(it?.unit), 0));
  const tva = items && !detail!.franchise ? cents(ht * (finite(detail!.vatRate) / 100)) : 0;
  const commission = ht < COMMISSION_FLOOR_EUR ? 0 : cents(ht * (finite(rate) / 100));
  return { ht, tva, ttc: cents(ht + tva), commission, reversal: cents(ht - commission), rate };
}

/** Mandat d'encaissement par créateur (dernier contrat de représentation qui le précise). */
export function mandatesFrom(history: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!Array.isArray(history)) return out;
  const sorted = [...history].sort((a, b) => String(a?.createdAt ?? "").localeCompare(String(b?.createdAt ?? "")));
  for (const h of sorted) {
    const name = key(h?.creator);
    const v = h?.config?.mandatEncaissement;
    if (!name || v === undefined) continue;
    out[name] = v === true || v === "true";
  }
  return out;
}

/** Qui encaisse l'argent de la marque : l'agence ou le créateur. */
export function cashModeFor(collabId: unknown, creator: unknown, collabModes: Record<string, string>, mandates: Record<string, boolean>): "agence" | "createur" {
  const set = collabId ? collabModes[String(collabId)] : undefined;
  if (set === "agence" || set === "createur") return set;
  if (set === "mandat") return "agence";
  return mandates[key(creator)] === false ? "createur" : "agence";
}

export type RevInvoice = { id: string; amount: unknown; status: unknown; creator: unknown; collab_id?: unknown };
export type Payout = { date?: string; amount?: unknown; note?: string };
export type RevRow = { creator: string; encaisse: number; ht: number; rate: number; commission: number; du: number; reverse: number; reste: number; lastPayout: string | null };

export function reversementRows(input: {
  invoices: RevInvoice[];
  details: Record<string, Detail | undefined>;
  payouts: Record<string, Payout[]>;
  rosterRates: Record<string, number>;
  savedRates: Record<string, number>;
  collabModes: Record<string, string>;
  contractHistory: unknown;
}): RevRow[] {
  const roster = new Map<string, { name: string; rate: number }>();
  for (const [name, rate] of Object.entries(input.rosterRates)) roster.set(key(name), { name, rate });
  const saved = new Map<string, number>();
  for (const [name, rate] of Object.entries(input.savedRates ?? {})) if (Number.isFinite(Number(rate))) saved.set(key(name), Number(rate));
  const rateOf = (k: string) => roster.get(k)?.rate ?? saved.get(k) ?? DEFAULT_COMMISSION;
  const mandates = mandatesFrom(input.contractHistory);

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
    const d = input.details[iv.id];
    // Marque qui paie le créateur, ou facture de commission : rien à reverser (page Compta).
    if (d?.kind === "commission" || cashModeFor(iv.collab_id, iv.creator, input.collabModes, mandates) === "createur") continue;
    const a = bump(String(iv.creator));
    const t = invoiceTotals(amountOf(iv.amount), d, rateOf(key(iv.creator)));
    a.encaisse += t.ttc;
    a.ht += t.ht;
    a.commission += t.commission;
    a.du += t.reversal + (d?.onBehalf ? t.tva : 0);
  }
  for (const [k, list] of Object.entries(input.payouts ?? {})) {
    if (!key(k) || !Array.isArray(list)) continue;
    bump(k).keys.push(k);
  }
  const out: RevRow[] = [];
  for (const [k, a] of acc) {
    const payouts = a.keys.flatMap((pk) => input.payouts[pk] ?? []);
    const reverse = cents(payouts.reduce((s, p) => s + finite(p?.amount), 0));
    const ht = cents(a.ht);
    const commission = cents(a.commission);
    const du = cents(a.du);
    const last = payouts.map((p) => String(p?.date ?? "")).filter(Boolean).sort().pop() ?? null;
    out.push({ creator: a.name, encaisse: cents(a.encaisse), ht, rate: ht > 0 ? Math.round((commission / ht) * 100) : rateOf(k), commission, du, reverse, reste: cents(du - reverse), lastPayout: last });
  }
  return out.sort((x, y) => y.reste - x.reste);
}

export const owesMoney = (r: Pick<RevRow, "reste">) => r.reste > PAYOUT_TOLERANCE_EUR;

// ── Fins de contrat (page Échéances / Fins de contrat) ─────────────────────────
export type Deadline = { id?: string; creator?: string; type?: string; start?: string; months?: number; note?: string };

/** Fin de contrat : début + durée, jour borné à la fin du mois cible (31 janv. + 1 mois = 28 févr.). */
export function contractEnd(start: string, months: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(start ?? "");
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1 + (Number(months) || 0);
  const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const d = new Date(Date.UTC(y, mo, Math.min(Number(m[3]), lastDay)));
  return d.toISOString().slice(0, 10);
}

/** Contrats avec leur fin ; un contrat remplacé par un suivi plus récent (même créateur, même type) est marqué renouvelé. */
export function contractList(list: unknown): (Deadline & { end: string; renewed: boolean })[] {
  const rows = (Array.isArray(list) ? (list as Deadline[]) : []).flatMap((d) => {
    const end = d && d.creator ? contractEnd(String(d.start ?? ""), Number(d.months) || 0) : null;
    return end ? [{ ...d, end }] : [];
  });
  const k = (d: Deadline) => `${key(d.type)}|${key(d.creator)}`;
  const latest = new Map<string, string>();
  for (const d of rows) if ((latest.get(k(d)) ?? "") < d.end) latest.set(k(d), d.end);
  return rows.map((d) => ({ ...d, renewed: latest.get(k(d)) !== d.end })).sort((a, b) => a.end.localeCompare(b.end));
}
