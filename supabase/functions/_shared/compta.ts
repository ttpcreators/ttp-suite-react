// ============================================================================
// _shared/compta.ts : la page Compta côté serveur (connecteur Claude, audit du 2 nov., n° 20).
// Copie fidèle des règles de src/lib/compta.ts et src/lib/comptaRates.ts : chiffre
// d'affaires encaissé, cotisations URSSAF et TVA à mettre de côté, dû aux créateurs.
// Mêmes totaux de facture que l'app (_shared/reversements.ts invoiceTotals).
// ============================================================================
import { amountOf, cashModeFor, cents, invoiceTotals, mandatesFrom, PAYOUT_TOLERANCE_EUR, type Detail, type Payout } from "./reversements.ts";

const ACTIVITIES = {
  bnc: { label: "Activité libérale non réglementée (BNC)", urssaf: 25.6, vl: 2.2, cfp: 0.2 },
  bic_services: { label: "Prestations de services commerciales (BIC)", urssaf: 21.2, vl: 1.7, cfp: 0.1 },
} as const;
type Activity = keyof typeof ACTIVITIES;

export type ComptaSettings = {
  activity: Activity; urssafRate: number; cfpRate: number; vl: boolean; vlRate: number;
  vatRegime: "franchise" | "assujetti"; vatRate: number; declaration: "mois" | "trimestre"; facturation: "agence" | "mandat";
};

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 100 ? v : d);
export function readSettings(raw: unknown): ComptaSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const activity: Activity = r.activity === "bic_services" ? "bic_services" : "bnc";
  const base = ACTIVITIES[activity];
  return {
    activity, urssafRate: num(r.urssafRate, base.urssaf), cfpRate: num(r.cfpRate, base.cfp), vl: r.vl === true, vlRate: num(r.vlRate, base.vl),
    vatRegime: r.vatRegime === "assujetti" ? "assujetti" : "franchise", vatRate: num(r.vatRate, 20),
    declaration: r.declaration === "mois" ? "mois" : "trimestre", facturation: r.facturation === "mandat" ? "mandat" : "agence",
  };
}
export const socialRate = (s: ComptaSettings) => s.urssafRate + s.cfpRate + (s.vl ? s.vlRate : 0);

const isoDay = (v: unknown): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ""));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const k = (s: unknown) => String(s ?? "").trim().toLowerCase();

export type ComptaInv = { id: string; amount: unknown; status: unknown; creator: unknown; collab_id?: unknown; date?: unknown; paid_at?: unknown };
type Line = { creator: string; paid: boolean; day: string | null; agencyCA: number; vatDue: number; social: number; cashIn: number; owedCreator: number };

function lineOf(inv: ComptaInv, d: (Detail & { issueDate?: string; dueDate?: string }) | undefined, rate: number, mode: "agence" | "createur", s: ComptaSettings, billing: "agence" | "mandat"): Line {
  const billed = d?.onBehalf === true ? "mandat" : d?.onBehalf === false ? "agence" : billing;
  const commissionKind = d?.kind === "commission";
  const t = invoiceTotals(amountOf(inv.amount), d, commissionKind ? 0 : rate);
  const paid = inv.status === "payee";
  const day = (paid ? isoDay(inv.paid_at) : null) ?? isoDay(d?.issueDate) ?? isoDay(inv.date) ?? isoDay(d?.dueDate);
  let cashIn = 0, agencyCA = 0, vatDue = 0, owedCreator = 0;
  if (commissionKind) {
    if (paid) { cashIn = t.ttc; agencyCA = t.ht; vatDue = t.tva; }
  } else if (mode === "agence" && paid) {
    cashIn = t.ttc;
    if (billed === "agence") { agencyCA = t.ht; vatDue = t.tva; owedCreator = t.reversal; }
    else { agencyCA = t.commission; vatDue = s.vatRegime === "assujetti" ? cents((t.commission * s.vatRate) / 100) : 0; owedCreator = cents(t.reversal + t.tva); }
  }
  return { creator: k(inv.creator), paid, day, agencyCA: cents(agencyCA), vatDue: cents(vatDue), social: cents((agencyCA * socialRate(s)) / 100), cashIn: cents(cashIn), owedCreator: cents(owedCreator) };
}

const periodOf = (day: string, decl: ComptaSettings["declaration"]) => (decl === "mois" ? day.slice(0, 7) : `${day.slice(0, 4)}-T${Math.ceil(Number(day.slice(5, 7)) / 3)}`);
function periodDeadline(p: string): string {
  const y = Number(p.slice(0, 4));
  const last = p.includes("-T") ? Number(p.slice(6)) * 3 : Number(p.slice(5, 7));
  return new Date(Date.UTC(y, last + 1, 0)).toISOString().slice(0, 10);
}

/** Résumé de la page Compta (mêmes chiffres que l'app). */
export function comptaSummary(input: {
  invoices: ComptaInv[]; details: Record<string, Detail>; settings: unknown; payouts: Record<string, Payout[]>;
  collabModes: Record<string, string>; contractHistory: unknown; rateOf: (creator: unknown) => number; today: string;
}) {
  const s = readSettings(input.settings);
  const mandates = mandatesFrom(input.contractHistory);
  const lines = input.invoices
    .filter((iv) => iv.status !== "brouillon" && iv.status !== "annulee")
    .map((iv) => {
      const set = iv.collab_id ? input.collabModes[String(iv.collab_id)] : undefined;
      const billing = set === "mandat" ? "mandat" : set === "agence" ? "agence" : s.facturation;
      return lineOf(iv, input.details[iv.id] as Detail & { issueDate?: string }, input.rateOf(iv.creator), cashModeFor(iv.collab_id, iv.creator, input.collabModes, mandates), s, billing);
    });
  const encaisse = cents(lines.reduce((a, l) => a + l.cashIn, 0));
  let verse = 0;
  const paidBy = new Map<string, number>();
  for (const [name, list] of Object.entries(input.payouts ?? {})) {
    if (!Array.isArray(list)) continue;
    const sum = list.reduce((a, p) => a + (Number(p?.amount) || 0), 0);
    verse += sum;
    paidBy.set(k(name), (paidBy.get(k(name)) ?? 0) + sum);
  }
  const owed = new Map<string, number>();
  for (const l of lines) if (l.owedCreator > 0 && l.creator) owed.set(l.creator, (owed.get(l.creator) ?? 0) + l.owedCreator);
  let createurs = 0;
  for (const [name, due] of owed) {
    const rest = due - (paidBy.get(name) ?? 0);
    if (rest > PAYOUT_TOLERANCE_EUR) createurs += rest;
  }
  const open = new Set<string>();
  let urssaf = 0, tva = 0, openCA = 0;
  for (const l of lines) {
    if (!l.day || (!l.social && !l.vatDue)) continue;
    const p = periodOf(l.day, s.declaration);
    if (periodDeadline(p) < input.today) continue;
    open.add(p); urssaf += l.social; tva += l.vatDue; openCA += l.agencyCA;
  }
  const caYear = cents(lines.reduce((a, l) => a + (l.day?.startsWith(input.today.slice(0, 4)) ? l.agencyCA : 0), 0));
  const solde = cents(encaisse - cents(verse));
  const aside = { createurs: cents(createurs), urssaf: cents(urssaf), tva: cents(tva) };
  return {
    settings: s, rate: socialRate(s), encaisse, verse: cents(verse), solde, aside, openCA: cents(openCA), openPeriods: [...open].sort(), caYear,
    dispo: cents(solde - aside.createurs - aside.urssaf - aside.tva), activity: ACTIVITIES[s.activity].label,
  };
}
