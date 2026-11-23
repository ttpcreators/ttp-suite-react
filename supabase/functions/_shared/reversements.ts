// ============================================================================
// _shared/reversements.ts : reversements créateurs et fins de contrat.
// Le calcul des reversements (reversementRows, reversementTotals, allocate) est la SEULE
// version : la page Reversements l'importe (via src/lib/reversements.ts), comme le
// connecteur Claude et le résumé du matin. Le reste est une copie fidèle des règles de
// l'app (src/lib/invoice.ts, src/lib/compta.ts cashModeFor / mandatesFrom,
// src/lib/anticipation.ts contractEnd). Pur : testé par reversements.test.ts.
// ============================================================================

export const COMMISSION_FLOOR_EUR = 100;
export const PAYOUT_TOLERANCE_EUR = 0.5;
export const DEFAULT_COMMISSION = 20;

export const cents = (n: number): number => (Number.isFinite(n) ? Math.round(n * 100) / 100 || 0 : 0);
const finite = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? n : Number(n) || 0);
const key = (s: unknown) => String(s ?? "").trim().toLowerCase();

/** « 1 440,00 € », « 1.500 € », « 600 », 600 → nombre (0 si illisible). Même lecture que
 *  readNumber de l'app (src/lib/money.ts) : « 1.500 » = 1 500, « 12,5 » = 12,5 (audit 22 nov. 2026). */
export function amountOf(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v ?? "").replace(/[\s  ]/g, "").replace(/[^0-9,.-]/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Les deux : le dernier séparateur est la décimale, l'autre les milliers.
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // Virgule seule : décimale si unique, sinon milliers (« 1,234,567 »).
    s = (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot >= 0) {
    // Point seul : milliers si plusieurs points ou « x.000 », sinon décimale.
    const dots = (s.match(/\./g) || []).length;
    const intPart = s.slice(0, s.indexOf(".")).replace("-", "");
    if (dots > 1 || (/^\d+\.\d{3}$/.test(s.replace("-", "")) && intPart !== "0")) s = s.replace(/\./g, "");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** « 25% », « 25 », « 25,5 % » → 25 ; null si vide. */
export function pctOf(s: unknown): number | null {
  const m = /(\d+(?:[.,]\d+)?)/.exec(String(s ?? ""));
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}

export type Detail = {
  items?: { qty?: unknown; unit?: unknown }[] | null;
  franchise?: boolean | null;
  vatRate?: unknown;
  commissionRate?: unknown;
  onBehalf?: boolean | null;
  kind?: string | null;
  /** Devise (« EUR » si absente) et valeur d'une unité en euros. */
  currency?: string | null;
  fxRate?: unknown;
};

/** Taux vers l'euro (copie de src/lib/invoice.ts eurRateOf) : null si devise étrangère sans taux. */
export function eurRateOf(detail: Detail | null | undefined): number | null {
  const cur = String(detail?.currency ?? "EUR").toUpperCase();
  if (cur === "EUR") return 1;
  const r = Number(detail?.fxRate);
  return Number.isFinite(r) && r > 0 ? r : null;
}

/** Totaux d'une facture (lignes détaillées si elles existent, sinon montant enregistré, sans TVA). */
export function invoiceTotals(amount: number, detail: Detail | null | undefined, rosterRate: number) {
  const items = detail && Array.isArray(detail.items) && detail.items.length ? detail.items : null;
  const rate = items && detail!.commissionRate != null && Number.isFinite(Number(detail!.commissionRate)) ? Number(detail!.commissionRate) : rosterRate;
  const ht = cents((items ?? [{ qty: 1, unit: amount }]).reduce((s, it) => s + finite(it?.qty) * finite(it?.unit), 0));
  const tva = items && !detail!.franchise ? cents(ht * (finite(detail!.vatRate) / 100)) : 0;
  // Devise étrangère : totaux rendus en euros (même règle que l'app), et le seuil « pas de
  // commission sous 100 € » se juge sur le HT en euros.
  const fx = items ? eurRateOf(detail) ?? 1 : 1;
  const commission = (fx === 1 ? ht : cents(ht * fx)) < COMMISSION_FLOOR_EUR ? 0 : cents(ht * (finite(rate) / 100));
  const eur = (n: number) => (fx === 1 ? n : cents(n * fx));
  return { ht: eur(ht), tva: eur(tva), ttc: eur(cents(ht + tva)), commission: eur(commission), reversal: eur(cents(ht - commission)), rate };
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
/** Comme l'app : le réglage de la collab, sinon « agence » (le contrat ne réécrit pas le passé). */
export function cashModeFor(collabId: unknown, _creator: unknown, collabModes: Record<string, string>, _mandates: Record<string, boolean>): "agence" | "createur" {
  const set = collabId ? collabModes[String(collabId)] : undefined;
  return set === "createur" ? "createur" : "agence";
}

// ── Reversements : LA règle, partagée par la page Reversements (src/lib/reversements.ts la
// réexporte), le connecteur Claude (outil `reversements`, Alfred) et le résumé du matin.
// Une seule fonction, pour que l'app et Alfred donnent toujours le même reste à verser.
//   - dû = part créateur (HT moins commission, plus la TVA d'une facture au nom du créateur)
//     des factures PAYÉES par la marque ;
//   - versé = virements enregistrés (blob `creatorPayouts`) ;
//   - reste = dû moins versé.
// L'argent dû à un créateur est dû même s'il a quitté le roster : tout nom qui a une facture
// payée ou un versement a sa ligne, fiche roster ou pas (règle de Marc, 24 nov. 2026).
// Un créateur se reconnaît sans tenir compte des majuscules ni des espaces autour du nom.

export type RevInvoice = { id: string; amount: unknown; status: unknown; creator: unknown; collab_id?: unknown; party?: unknown; ref?: unknown; date?: unknown; paid_at?: unknown };
export type Payout = { id?: string; date?: string; amount?: unknown; note?: string };
/** Une facture payée dans le détail d'un créateur : sa part, et ce que les virements couvrent
 *  (les plus anciennes factures d'abord). */
export type RevLine = {
  id: string; brand: string; ref: string; paidOn: string; collabId: string | null;
  /** Part du créateur sur cette facture. */
  du: number;
  /** Déjà couvert par les virements. */
  covered: number;
  state: "reverse" | "partiel" | "a_reverser";
};
/** Part du créateur sur une facture payée (format attendu par _shared/collabAutoDb.ts). */
export type RevLigne = { id: string; collabId: string | null; party: string; paidOn: string; du: number };
export type RevRow<P extends Payout = Payout> = {
  /** Nom affiché (celui de la fiche roster s'il existe). */
  creator: string;
  /** Sorti du roster (fiche inactive ou absente) : ancien créateur, à qui l'argent reste dû.
   *  Toujours false si `activeNames` n'est pas fourni. */
  horsRoster: boolean;
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
  /** Versements, du plus récent au plus ancien. */
  payouts: P[];
  lastPayout: string | null;
  /** Factures payées qui font ce montant, des plus récentes aux plus anciennes. */
  lines: RevLine[];
  lignes: RevLigne[];
};

export function reversementRows<P extends Payout = Payout>(input: {
  invoices: RevInvoice[];
  details: Record<string, Detail | undefined>;
  payouts: Record<string, P[]>;
  /** Taux de la fiche roster, par nom (tout le roster, actifs ou non). */
  rosterRates: Record<string, number>;
  /** Taux mémorisés à l'enregistrement d'une facture (blob `creatorCommission`), par nom. */
  savedRates: Record<string, number>;
  /** Taux faute de fiche et de taux mémorisé (20 % par défaut). */
  defaultRate?: number;
  /** Blob `collabCashMode` : une collab en mode « createur » (la marque paie le créateur) n'a
   *  rien à reverser, comme une facture de commission (page Compta). */
  collabModes?: Record<string, string>;
  contractHistory?: unknown;
  /** Autres factures à écarter (ids). */
  skip?: ReadonlySet<string>;
  /** Créateurs actuellement au roster (fiche au statut autre que « inactif ») : sert seulement
   *  à repérer les anciens créateurs, jamais à les écarter. */
  activeNames?: string[];
}): RevRow<P>[] {
  const roster = new Map<string, { name: string; rate: number }>();
  for (const [name, rate] of Object.entries(input.rosterRates ?? {})) roster.set(key(name), { name, rate });
  const saved = new Map<string, number>();
  for (const [name, rate] of Object.entries(input.savedRates ?? {})) if (Number.isFinite(Number(rate))) saved.set(key(name), Number(rate));
  const fallback = input.defaultRate ?? DEFAULT_COMMISSION;
  const rateOf = (k: string) => roster.get(k)?.rate ?? saved.get(k) ?? fallback;
  const modes = input.collabModes ?? {};
  const mandates = mandatesFrom(input.contractHistory);
  const str = (v: unknown) => String(v ?? "").trim();
  const active = input.activeNames ? new Set(input.activeNames.map(key)) : null;

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
    const d = input.details[iv.id];
    // Marque qui paie le créateur, ou facture de commission : rien à reverser (page Compta).
    if (d?.kind === "commission" || cashModeFor(iv.collab_id, iv.creator, modes, mandates) === "createur") continue;
    const a = bump(String(iv.creator));
    const t = invoiceTotals(amountOf(iv.amount), d, rateOf(key(iv.creator)));
    a.encaisse += t.ttc;
    a.ht += t.ht;
    a.commission += t.commission;
    // Facture au nom du créateur (mandat) : la TVA facturée est la sienne, elle lui est reversée.
    const share = t.reversal + (d?.onBehalf ? t.tva : 0);
    a.du += share;
    a.lines.push({
      id: iv.id, brand: str(iv.party), ref: str(iv.ref),
      paidOn: String(iv.paid_at ?? iv.date ?? "").slice(0, 10), collabId: iv.collab_id ? String(iv.collab_id) : null, du: cents(share),
    });
  }
  // Les créateurs qui ont déjà des versements apparaissent aussi (même sans facture payée).
  for (const [k, list] of Object.entries(input.payouts ?? {})) {
    if (!key(k) || !Array.isArray(list)) continue;
    bump(k).keys.push(k);
  }

  const out: RevRow<P>[] = [];
  for (const [k, a] of acc) {
    const payouts = a.keys.flatMap((pk) => input.payouts[pk] ?? []).sort((x, y) => String(y?.date ?? "").localeCompare(String(x?.date ?? "")));
    const reverse = cents(payouts.reduce((s, p) => s + finite(p?.amount), 0));
    const ht = cents(a.ht);
    const commission = cents(a.commission);
    const du = cents(a.du);
    const writeKey = a.keys.find((pk) => (input.payouts[pk] ?? []).length > 0) ?? a.keys[0] ?? a.name;
    const lines = allocate(a.lines, reverse);
    out.push({
      creator: a.name,
      horsRoster: active ? !active.has(k) : false,
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
      lastPayout: payouts.map((p) => String(p?.date ?? "")).find(Boolean) ?? null,
      lines,
      lignes: lines.map((l) => ({ id: l.id, collabId: l.collabId, party: l.brand, paidOn: l.paidOn, du: l.du })),
    });
  }
  return out.sort((x, y) => y.reste - x.reste);
}

/** Reste à verser (au-delà de l'écart d'arrondi toléré). */
export const owesMoney = (r: Pick<RevRow, "reste">) => r.reste > PAYOUT_TOLERANCE_EUR;
/** Versé plus que dû (facture supprimée ou repassée « en attente » après un virement). */
export const overpaid = (r: Pick<RevRow, "reste">) => r.reste < -PAYOUT_TOLERANCE_EUR;

/**
 * Totaux affichés en tête de la page Reversements et de l'outil `reversements` : le reste
 * compte TOUS les créateurs à qui on doit de l'argent, anciens compris.
 */
export function reversementTotals(rows: Pick<RevRow, "reste" | "du" | "reverse" | "horsRoster">[]) {
  const owing = rows.filter(owesMoney);
  return {
    reste: cents(owing.reduce((s, r) => s + r.reste, 0)),
    createurs: owing.length,
    /** Dont créateurs sortis du roster. */
    horsRoster: owing.filter((r) => r.horsRoster).length,
    du: cents(rows.reduce((s, r) => s + r.du, 0)),
    reverse: cents(rows.reduce((s, r) => s + r.reverse, 0)),
  };
}

const eurTxt = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const nomTxt = (s: string) => s.toLocaleLowerCase("fr-FR").replace(/(^|[^\p{L}])(\p{L})/gu, (_m, p: string, c: string) => p + c.toLocaleUpperCase("fr-FR"));

/**
 * Texte de l'outil `reversements` (Alfred). L'en-tête donne TOUJOURS le total de l'agence,
 * même filtré sur un créateur : avant (nov. 2026), un filtre sur un créateur renvoyait « reste à
 * verser … à 1 créateur », lu comme le total alors que la page comptait aussi une ancienne créatrice.
 */
export function reversementsTexte(rows: RevRow[], opts: { createur?: string; tous?: boolean }, day: (iso: string) => string): string {
  const totals = reversementTotals(rows);
  const anciens = totals.horsRoster ? `, dont ${totals.horsRoster} sorti${totals.horsRoster > 1 ? "s" : ""} du roster` : "";
  const head = `# Reversements · reste à verser ${eurTxt(totals.reste)} à ${totals.createurs} créateur(s)${anciens} (total de l'agence, comme la page Reversements)`;
  const who = key(opts.createur);
  const filtered = who ? rows.filter((r) => key(r.creator).includes(who)) : rows;
  const shown = opts.tous || who ? filtered : filtered.filter(owesMoney);
  const ligne = (r: RevRow) =>
    `- ${nomTxt(r.creator)}${r.horsRoster ? " (sorti du roster, l'argent reste dû)" : ""} · reste ${eurTxt(r.reste)} · dû ${eurTxt(r.du)} (factures payées ${eurTxt(r.encaisse)} TTC, commission ${r.rate} %) · versé ${eurTxt(r.reverse)}${r.lastPayout ? ` · dernier virement ${day(r.lastPayout)}` : ""}`;
  const out = [head];
  if (who) out.push(`\n## Filtre « ${String(opts.createur).trim()} »`);
  out.push(...shown.map(ligne));
  if (!shown.length) out.push(who ? "Aucun créateur ne correspond." : "Tout est à jour.");
  return out.join("\n");
}

/** Noms des créateurs encore au roster (statut autre que « inactif »), pour `activeNames`. */
export function activeRosterNames(creators: { name?: unknown; status?: unknown }[] | null | undefined): string[] {
  return (creators ?? []).filter((c) => key(c?.status ?? "actif") !== "inactif" && key(c?.name)).map((c) => String(c.name));
}

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

// ── Fins de contrat (page Échéances / Fins de contrat) ─────────────────────────
export type Deadline = { id?: string; creator?: string; type?: string; start?: string; months?: number; note?: string };

/**
 * Dernier jour du contrat : début + durée, moins un jour (15 mars + 12 mois = 14 mars), comme le
 * contrat imprimé. Mois d'arrivée sans ce jour (31 août + 6 mois) : son dernier jour (28 févr.).
 * Règle validée par Marc le 2026-11-11.
 * Copie de src/lib/anticipation.ts.
 */
export function contractEnd(start: string, months: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(start ?? "");
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1 + (Number(months) || 0);
  const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const day = Number(m[3]);
  const d = !(Number(months) > 0) ? new Date(Date.UTC(y, mo, day)) : day > lastDay ? new Date(Date.UTC(y, mo, lastDay)) : new Date(Date.UTC(y, mo, day - 1));
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
