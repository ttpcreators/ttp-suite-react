import { parseAmount } from "./money";
import { cents, invoiceTotals, PAYOUT_TOLERANCE_EUR, totalsOf, type InvoiceDetailLike } from "./invoice";
import { ACTIVITIES, MICRO_CEILING, VAT_FRANCHISE, type Activity } from "./comptaRates";

/**
 * Compta de l'agence en micro-entreprise (logique PURE, testée par compta.test.ts).
 * Mêmes totaux que Facturation, Reversements et les gains du créateur (src/lib/invoice.ts).
 *
 * Deux façons d'encaisser une collab (`CashMode`) :
 *  • « agence »  : la marque paie l'agence, qui garde sa commission et reverse le reste ;
 *  • « createur » : la marque paie le créateur, qui reverse la commission à l'agence
 *    (facture de commission de l'agence au créateur, `kind: "commission"`).
 *
 * Chiffre d'affaires de l'agence (base des cotisations URSSAF, recettes ENCAISSÉES) :
 *  • facture de commission payée : son HT ;
 *  • facture marque encaissée par l'agence : tout le HT si l'agence facture en son nom
 *    (`facturation: "agence"`, c'est ce que font les factures de l'app aujourd'hui), la
 *    seule commission si elle facture au nom et pour le compte du créateur (« mandat ») ;
 *  • facture marque encaissée par le créateur : rien (la commission arrive par la facture
 *    de commission).
 * Date d'encaissement : il n'y a pas de date de paiement en base ; on prend la date
 * d'émission de la facture (sinon son échéance). Approximation signalée à l'écran.
 */

export type CashMode = "agence" | "createur";
/**
 * Au nom de qui la facture à la marque est établie : « agence » (en son nom : tout le HT est
 * son chiffre d'affaires) ou « mandat » (au nom et pour le compte du créateur : seule la
 * commission l'est). Choix par collab (blob `collabCashMode` = « mandat »), par facture
 * (`onBehalf` de son détail), sinon le réglage par défaut de la page Compta.
 */
export type Billing = "agence" | "mandat";
export type ComptaSettings = {
  activity: Activity;
  /** % de cotisations sociales (réglable, défaut : taux officiel de l'activité). */
  urssafRate: number;
  cfpRate: number;
  /** Versement libératoire de l'impôt sur le revenu (option). */
  vl: boolean;
  vlRate: number;
  vatRegime: "franchise" | "assujetti";
  vatRate: number;
  declaration: "mois" | "trimestre";
  facturation: "agence" | "mandat";
  /** Réglages enregistrés au moins une fois (sinon : valeurs par défaut, à confirmer). */
  saved?: boolean;
};

export const DEFAULT_SETTINGS: ComptaSettings = {
  // BNC par défaut : le taux le plus haut, donc la provision la plus prudente (activité à confirmer).
  activity: "bnc",
  urssafRate: ACTIVITIES.bnc.urssaf,
  cfpRate: ACTIVITIES.bnc.cfp,
  vl: false,
  vlRate: ACTIVITIES.bnc.vl,
  vatRegime: "franchise",
  vatRate: 20,
  declaration: "trimestre",
  facturation: "agence",
};

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 100 ? v : d);

/** Réglages lus dans le blob (valeurs bizarres → défaut). */
export function readSettings(raw: unknown): ComptaSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<ComptaSettings>;
  const activity: Activity = r.activity === "bic_services" ? "bic_services" : "bnc";
  const base = ACTIVITIES[activity];
  return {
    activity,
    urssafRate: num(r.urssafRate, base.urssaf),
    cfpRate: num(r.cfpRate, base.cfp),
    vl: r.vl === true,
    vlRate: num(r.vlRate, base.vl),
    vatRegime: r.vatRegime === "assujetti" ? "assujetti" : "franchise",
    vatRate: num(r.vatRate, 20),
    declaration: r.declaration === "mois" ? "mois" : "trimestre",
    facturation: r.facturation === "mandat" ? "mandat" : "agence",
    saved: r.saved === true,
  };
}

/** % total prélevé sur le chiffre d'affaires : cotisations + formation (+ versement libératoire). */
export const socialRate = (s: ComptaSettings) => s.urssafRate + s.cfpRate + (s.vl ? s.vlRate : 0);

export type ComptaInvoice = { id: string; amount: string | null; status: string | null; creator: string | null; collab_id?: string | null; date?: string | null; party?: string | null };
export type ComptaDetail = InvoiceDetailLike & { issueDate?: string | null; dueDate?: string | null; kind?: string | null; onBehalf?: boolean | null };

export type InvoiceLine = {
  id: string;
  collabId: string | null;
  creator: string | null;
  kind: "marque" | "commission";
  mode: CashMode;
  paid: boolean;
  /** Jour retenu pour l'encaissement (AAAA-MM-JJ), null si inconnu. */
  day: string | null;
  ht: number;
  tva: number;
  ttc: number;
  /** Commission de l'agence (HT). */
  commission: number;
  /** Ce qui arrive sur le compte de l'agence (TTC, factures payées). */
  cashIn: number;
  /** Chiffre d'affaires de l'agence, encaissé. */
  agencyCA: number;
  /** TVA encaissée à reverser à l'État. */
  vatDue: number;
  /** Cotisations sur ce chiffre d'affaires. */
  social: number;
  /** Ce que l'agence doit au créateur pour cette facture. */
  owedCreator: number;
};

const ISO = /^(\d{4})-(\d{2})-(\d{2})/;
const isoDay = (v: unknown): string | null => {
  const m = ISO.exec(String(v ?? ""));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

/** Une facture vue par la compta. `mode` : celui de sa collab (ou le défaut de son créateur) ; `billing` : celui de sa collab. */
export function invoiceLine(inv: ComptaInvoice, detail: ComptaDetail | null | undefined, rate: number, mode: CashMode, s: ComptaSettings, billing?: Billing): InvoiceLine {
  const billed: Billing = detail?.onBehalf === true ? "mandat" : detail?.onBehalf === false ? "agence" : (billing ?? s.facturation);
  const kind = detail?.kind === "commission" ? "commission" : "marque";
  const t = invoiceTotals(parseAmount(inv.amount), detail, kind === "commission" ? 0 : rate);
  const paid = inv.status === "payee";
  const day = isoDay(detail?.issueDate) ?? isoDay(inv.date) ?? isoDay(detail?.dueDate);
  let cashIn = 0;
  let agencyCA = 0;
  let vatDue = 0;
  let owedCreator = 0;
  let commission = t.commission;
  if (kind === "commission") {
    commission = t.ht;
    if (paid) {
      cashIn = t.ttc;
      agencyCA = t.ht;
      vatDue = t.tva;
    }
  } else if (mode === "agence" && paid) {
    cashIn = t.ttc;
    if (billed === "agence") {
      agencyCA = t.ht;
      vatDue = t.tva;
      owedCreator = t.reversal;
    } else {
      // Au nom et pour le compte du créateur : la TVA de la facture est la sienne, l'agence
      // ne doit que celle de sa commission (si elle y est soumise).
      agencyCA = t.commission;
      vatDue = s.vatRegime === "assujetti" ? cents((t.commission * s.vatRate) / 100) : 0;
      owedCreator = cents(t.reversal + t.tva);
    }
  }
  return {
    id: inv.id,
    collabId: inv.collab_id ?? null,
    creator: inv.creator,
    kind,
    mode,
    paid,
    day,
    ht: t.ht,
    tva: t.tva,
    ttc: t.ttc,
    commission,
    cashIn: cents(cashIn),
    agencyCA: cents(agencyCA),
    vatDue: cents(vatDue),
    social: cents((agencyCA * socialRate(s)) / 100),
    owedCreator: cents(owedCreator),
  };
}

// ── Périodes de déclaration URSSAF ──────────────────────────────────────────────
/** Période d'un jour : « 2026-10 » (mois) ou « 2026-T4 » (trimestre). */
export function periodOf(day: string, declaration: ComptaSettings["declaration"]): string {
  const y = day.slice(0, 4);
  const m = Number(day.slice(5, 7));
  return declaration === "mois" ? day.slice(0, 7) : `${y}-T${Math.ceil(m / 3)}`;
}

/** Dernier jour pour déclarer et payer une période : fin du mois qui suit (mois ou trimestre). */
export function periodDeadline(period: string): string {
  const y = Number(period.slice(0, 4));
  const last = period.includes("-T") ? Number(period.slice(6)) * 3 : Number(period.slice(5, 7));
  const end = new Date(Date.UTC(y, last + 1, 0)); // dernier jour du mois suivant
  return end.toISOString().slice(0, 10);
}

// ── Compte pro ──────────────────────────────────────────────────────────────────
export type Payout = { amount: number; date?: string };
export type ComptePro = {
  /** Encaissé sur le compte (factures payées à l'agence + commissions reçues). */
  encaisse: number;
  /** Versé aux créateurs. */
  verse: number;
  /** Ce qu'il devrait y avoir sur le compte, si rien d'autre n'est entré ou sorti. */
  solde: number;
  aside: {
    /** Dû aux créateurs, pas encore versé. */
    createurs: number;
    /** Cotisations des périodes pas encore échues. */
    urssaf: number;
    /** TVA encaissée des périodes pas encore échues. */
    tva: number;
  };
  /** Solde moins tout ce qui est à mettre de côté. */
  dispo: number;
  /** Chiffre d'affaires de l'agence encaissé sur l'année civile en cours. */
  caYear: number;
  /** Périodes non échues prises en compte (« 2026-T4 »…). */
  openPeriods: string[];
};

const k = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export function comptePro(lines: InvoiceLine[], payouts: Record<string, Payout[]>, s: ComptaSettings, today: string): ComptePro {
  const encaisse = cents(lines.reduce((a, l) => a + l.cashIn, 0));
  let verse = 0;
  const paidBy = new Map<string, number>();
  for (const [name, list] of Object.entries(payouts ?? {})) {
    if (!Array.isArray(list)) continue;
    const sum = list.reduce((a, p) => a + (Number(p?.amount) || 0), 0);
    verse += sum;
    paidBy.set(k(name), (paidBy.get(k(name)) ?? 0) + sum);
  }
  verse = cents(verse);
  // Dû aux créateurs : par créateur, jamais négatif (un créateur trop payé ne compense pas un autre).
  const owed = new Map<string, number>();
  for (const l of lines) if (l.owedCreator > 0 && k(l.creator)) owed.set(k(l.creator), (owed.get(k(l.creator)) ?? 0) + l.owedCreator);
  let createurs = 0;
  for (const [name, due] of owed) {
    const rest = due - (paidBy.get(name) ?? 0);
    if (rest > PAYOUT_TOLERANCE_EUR) createurs += rest;
  }
  const open = new Set<string>();
  let urssaf = 0;
  let tva = 0;
  for (const l of lines) {
    if (!l.day || (!l.social && !l.vatDue)) continue;
    const p = periodOf(l.day, s.declaration);
    if (periodDeadline(p) < today) continue; // période échue : déjà déclarée et payée
    open.add(p);
    urssaf += l.social;
    tva += l.vatDue;
  }
  const year = today.slice(0, 4);
  const caYear = cents(lines.reduce((a, l) => a + (l.day?.startsWith(year) ? l.agencyCA : 0), 0));
  const solde = cents(encaisse - verse);
  const aside = { createurs: cents(createurs), urssaf: cents(urssaf), tva: cents(tva) };
  return { encaisse, verse, solde, aside, dispo: cents(solde - aside.createurs - aside.urssaf - aside.tva), caYear, openPeriods: [...open].sort() };
}

// ── Seuils ──────────────────────────────────────────────────────────────────────
export type Alert = { level: "info" | "wait" | "late"; text: string };

export function thresholdAlerts(caYear: number, s: ComptaSettings): Alert[] {
  const out: Alert[] = [];
  if (s.vatRegime === "franchise") {
    if (caYear > VAT_FRANCHISE.majore) out.push({ level: "late", text: "Seuil majoré de la franchise de TVA dépassé : la TVA est due dès le jour du dépassement." });
    else if (caYear > VAT_FRANCHISE.base) out.push({ level: "wait", text: "Seuil de la franchise de TVA dépassé : TVA à facturer à partir du 1er janvier prochain." });
    else if (caYear >= VAT_FRANCHISE.base * 0.8) out.push({ level: "info", text: "Plus de 80 % du seuil de la franchise de TVA." });
  }
  if (caYear > MICRO_CEILING) out.push({ level: "wait", text: "Plafond de la micro-entreprise dépassé cette année : à surveiller (sortie du régime après deux années de suite)." });
  else if (caYear >= MICRO_CEILING * 0.8) out.push({ level: "info", text: "Plus de 80 % du plafond de la micro-entreprise." });
  return out;
}

// ── Ce que je prends, par collab ───────────────────────────────────────────────
export type CollabLite = { id: string; brand: string; creator: string | null; cachet: string | null };
export type CollabTake = {
  collabId: string;
  mode: CashMode;
  /** Commission HT : factures de la collab, sinon estimée sur le cachet. */
  commission: number;
  estimated: boolean;
  social: number;
  net: number;
  /** Commission déjà encaissée (facture payée à l'agence ou commission reçue). */
  received: boolean;
  /** Mode « créateur » sans facture de commission : à faire. */
  commissionToBill: boolean;
};

export function collabTake(c: CollabLite, lines: InvoiceLine[], rate: number, mode: CashMode, s: ComptaSettings): CollabTake {
  const own = lines.filter((l) => l.collabId === c.id);
  const brandLines = own.filter((l) => l.kind === "marque");
  const comLines = own.filter((l) => l.kind === "commission");
  let commission: number;
  let estimated = false;
  if (mode === "createur" && comLines.length) commission = cents(comLines.reduce((a, l) => a + l.commission, 0));
  else if (brandLines.length) commission = cents(brandLines.reduce((a, l) => a + l.commission, 0));
  else {
    estimated = true;
    commission = totalsOf([{ id: "c", label: "", qty: 1, unit: parseAmount(c.cachet) }], true, 0, rate).commission;
  }
  // Cotisations sur ce que l'agence gagne vraiment sur cette collab (sa commission).
  const social = cents((commission * socialRate(s)) / 100);
  const received = mode === "createur" ? comLines.some((l) => l.paid) : brandLines.length > 0 && brandLines.every((l) => l.paid);
  return { collabId: c.id, mode, commission, estimated, social, net: cents(commission - social), received, commissionToBill: mode === "createur" && commission > 0 && comLines.length === 0 };
}

/**
 * Mode d'encaissement : réglage de la collab, sinon celui du contrat de représentation
 * du créateur (« mandat d'encaissement » oui → agence, non → créateur), sinon agence.
 */
export function cashModeFor(collabId: string | null | undefined, creator: string | null | undefined, collabModes: Record<string, string>, creatorMandates: Record<string, boolean>): CashMode {
  const set = collabId ? collabModes[collabId] : undefined;
  if (set === "agence" || set === "createur") return set;
  if (set === "mandat") return "agence"; // l'agence encaisse, facture au nom du créateur
  const m = creatorMandates[k(creator)];
  return m === false ? "createur" : "agence";
}

/** Au nom de qui facturer la marque pour cette collab : son choix, sinon le réglage par défaut. */
export function billingFor(collabId: string | null | undefined, collabModes: Record<string, string>, s: ComptaSettings): Billing {
  const set = collabId ? collabModes[collabId] : undefined;
  if (set === "mandat") return "mandat";
  if (set === "agence") return "agence";
  return s.facturation;
}

/** Contrats de représentation (blob `contractHistory`) → mandat d'encaissement par créateur (le plus récent). */
export function mandatesFrom(history: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!Array.isArray(history)) return out;
  const sorted = [...history].sort((a, b) => String(a?.createdAt ?? "").localeCompare(String(b?.createdAt ?? "")));
  for (const h of sorted) {
    const name = k(h?.creator);
    const v = h?.config?.mandatEncaissement;
    if (!name || v === undefined) continue;
    out[name] = v === true || v === "true";
  }
  return out;
}

/**
 * Factures qui ne donnent lieu à aucun reversement : factures de commission, et factures
 * d'une collab où la marque paie le créateur. Partagé par Reversements et la page Compta.
 */
export function noPayoutIds(
  invoices: ComptaInvoice[],
  details: Record<string, ComptaDetail | undefined>,
  collabModes: Record<string, string>,
  mandates: Record<string, boolean>,
): Set<string> {
  const out = new Set<string>();
  for (const iv of invoices) {
    if (details[iv.id]?.kind === "commission" || cashModeFor(iv.collab_id, iv.creator, collabModes, mandates) === "createur") out.add(iv.id);
  }
  return out;
}

/** Ligne de la facture de commission (mode « créateur »). */
export function commissionInvoiceLabel(brand: string, rate: number): string {
  return `Commission d'agence, collab ${brand.trim() || "marque"} (${String(rate).replace(".", ",")} %)`;
}
