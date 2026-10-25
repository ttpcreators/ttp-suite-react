/*
 * Page Tarifs, mode Influence : la méthode TARIF de l'agence (logique PURE, testée par
 * pricingTTP.test.ts). Barème, textes de la méthode et lecture des lignes de facture :
 * supabase/functions/_shared/tarif.ts (partagé avec l'outil Claude `methode_tarif`).
 *
 * Par contenu : prix média = vues médianes ÷ 1000 × CPM ; base = média × coefficient
 * qualité + forfait de production, jamais sous le plancher du créateur. Majorations et
 * remises en % de la base ; paid media sur sa ligne. Rien n'est estimé : un contenu sans
 * vues n'a pas de prix et la donnée manquante est signalée.
 */
import { COEF_MAX, COEF_MIN, COEF_STEP, type PastRate, type PastRates, type ProdLevel, type TarifGrid } from "../../supabase/functions/_shared/tarif.ts";
import { COMMISSION_FLOOR_EUR } from "./invoice";

export { COEF_MAX, COEF_MIN, COEF_STEP, DEFAULT_TARIF_GRID, PROD_LEVELS, TARIF_FORMATS, creatorFloor, formatOfLabel, gridDiff, latestPast, pastRates, readTarifGrid } from "../../supabase/functions/_shared/tarif.ts";
export type { InvoiceForPast, InvoiceItemForPast, PastRate, PastRates, ProdLevel, TarifGrid } from "../../supabase/functions/_shared/tarif.ts";

export type Exclusivity = "none" | "restreinte" | "large";
export type Credibility = "" | "athlete" | "coach" | "competition" | "lifestyle";
export const CREDIBILITY: { value: Credibility; label: string }[] = [
  { value: "athlete", label: "Athlète" },
  { value: "coach", label: "Coach" },
  { value: "competition", label: "En compétition" },
  { value: "lifestyle", label: "Lifestyle" },
];

/** Un livrable : format (« instagram.reel »), nombre, vues médianes d'un contenu (0 = inconnues). */
export type TarifLineIn = { key: string; label: string; qty: number; views: number };

export type TarifDeal = {
  lines: TarifLineIn[];
  production: ProdLevel;
  /** Retouches au-delà de celles incluses. */
  extraRetouches: number;
  /** Jours entre le brief et la publication (null = inconnu). */
  delayDays: number | null;
  /** Droits organiques : tranches de 3 mois. */
  rightsBlocks: number;
  /** Paid media / whitelisting / Spark : mois. */
  paidMonths: number;
  exclusivity: Exclusivity;
  exclusivityMonths: number;
  linkOrCode: boolean;
  /** Partenariat d'au moins `partnerMonths` mois… */
  partnership: boolean;
  /** … et volume garanti par écrit (sinon pas de remise). */
  volumeWritten: boolean;
  coef: number;
};

export const EMPTY_DEAL: TarifDeal = {
  lines: [], production: "simple", extraRetouches: 0, delayDays: null, rightsBlocks: 0, paidMonths: 0,
  exclusivity: "none", exclusivityMonths: 0, linkOrCode: false, partnership: false, volumeWritten: false, coef: 1,
};

export type Adjust = { id: "rights" | "exclusivity" | "rush" | "link" | "pack" | "partner"; label: string; pct: number };

export type TarifLineOut = TarifLineIn & {
  cpm: number;
  /** Prix média d'un contenu. */
  media: number;
  coef: number;
  production: number;
  /** Prix de base d'un contenu (plancher compris). */
  unitBase: number;
  /** Le plancher a relevé la base. */
  floored: boolean;
  /** Base × nombre. */
  base: number;
  majorations: number;
  remises: number;
  total: number;
  /** Pas de vues : pas de prix. */
  priced: boolean;
};

export type Step = { label: string; contrepartie: string; amount: number; after: number };

export type TarifResult = {
  lines: TarifLineOut[];
  /** Au moins un contenu chiffré. */
  priced: boolean;
  /** Tous les contenus chiffrés. */
  complete: boolean;
  base: number;
  majorations: Adjust[];
  remises: Adjust[];
  majPct: number;
  remPct: number;
  retouches: { qty: number; unit: number; amount: number };
  paid: { months: number; pct: number; amount: number };
  /** Plancher des créateurs × nombre de contenus chiffrés. */
  floorTotal: number;
  /** Cible relevée au plancher du créateur (remises trop fortes). */
  targetFloored: boolean;
  target: number;
  anchor: number;
  floor: number;
  /** € pour 1000 vues attendues (cible hors paid et retouches), 0 si pas de vues. */
  effectiveCpm: number;
  expectedViews: number;
  /** Paliers de baisse, de l'ancrage au plancher, chacun avec sa contrepartie. */
  steps: Step[];
  /** Remarques sur le calcul (remise refusée, plancher appliqué). */
  notes: string[];
};

const r0 = Math.round;
const clampCoef = (c: number) => Math.min(COEF_MAX, Math.max(COEF_MIN, Number.isFinite(c) ? c : 1));
const nonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** Coefficient suggéré : 1 + 0,15 par justification cochée, dans les bornes. */
export function suggestedCoef(checked: number): number {
  return Math.round(clampCoef(1 + COEF_STEP * Math.max(0, checked)) * 100) / 100;
}

/** Justifications pré-évaluées à partir des données du créateur (modifiables à la main). */
export function preChecks(a: { francePct: number | null; femalePct: number | null; credibility: Credibility }): { audience: boolean; expertise: boolean } {
  return {
    audience: (a.francePct ?? 0) >= 60 && (a.femalePct ?? 0) >= 60,
    expertise: a.credibility === "athlete" || a.credibility === "coach" || a.credibility === "competition",
  };
}

export function priceTarif(deal: TarifDeal, g: TarifGrid, creatorFloor: number): TarifResult {
  const coef = clampCoef(deal.coef);
  const prod = g.production[deal.production] ?? 0;
  const floorUnit = nonNeg(creatorFloor);
  const notes: string[] = [];

  const majorations: Adjust[] = [];
  const rb = Math.floor(nonNeg(deal.rightsBlocks));
  if (rb) majorations.push({ id: "rights", label: `Droits organiques ${rb * 3} mois`, pct: g.rightsPct * rb });
  const em = Math.floor(nonNeg(deal.exclusivityMonths));
  if (deal.exclusivity !== "none" && em) {
    const pct = deal.exclusivity === "large" ? g.exclWidePct : g.exclRestrictedPct;
    majorations.push({ id: "exclusivity", label: `Exclusivité ${deal.exclusivity === "large" ? "large" : "restreinte"} ${em} mois`, pct: pct * em });
  }
  if (deal.delayDays !== null && deal.delayDays < g.rushDays) majorations.push({ id: "rush", label: `Urgence, ${deal.delayDays} j`, pct: g.rushPct });
  if (deal.linkOrCode) majorations.push({ id: "link", label: "Lien en bio ou code promo", pct: g.linkPct });

  const qtyAll = deal.lines.reduce((s, l) => s + Math.max(1, Math.round(l.qty || 1)), 0);
  const remises: Adjust[] = [];
  if (qtyAll >= g.packMin) remises.push({ id: "pack", label: `Package ${qtyAll} contenus`, pct: g.packPct });
  if (deal.partnership && deal.volumeWritten) remises.push({ id: "partner", label: `Partenariat ${g.partnerMonths} mois ou plus`, pct: g.partnerPct });
  else if (deal.partnership) notes.push("Remise partenariat non appliquée : le volume n'est pas garanti par écrit.");

  const majPct = majorations.reduce((s, m) => s + m.pct, 0);
  const remPct = remises.reduce((s, m) => s + m.pct, 0);

  const lines: TarifLineOut[] = deal.lines.map((l) => {
    const qty = Math.max(1, Math.round(l.qty || 1));
    const views = nonNeg(l.views);
    const cpm = g.cpm[l.key] ?? 0;
    const priced = views > 0 && cpm > 0;
    const media = priced ? (views / 1000) * cpm : 0;
    const raw = media * coef + prod;
    const unitBase = priced ? r0(Math.max(floorUnit, raw)) : 0;
    const base = unitBase * qty;
    const majorations = r0((base * majPct) / 100);
    const remises = r0((base * remPct) / 100);
    return { ...l, qty, views, cpm, media: r0(media), coef, production: prod, unitBase, floored: priced && floorUnit > raw, base, majorations, remises, total: base + majorations - remises, priced };
  });
  const done = lines.filter((l) => l.priced);
  const base = done.reduce((s, l) => s + l.base, 0);
  const floorTotal = done.reduce((s, l) => s + floorUnit * l.qty, 0);
  let linesTotal = done.reduce((s, l) => s + l.total, 0);
  let targetFloored = false;
  if (done.length && linesTotal < floorTotal) {
    linesTotal = floorTotal;
    targetFloored = true;
    notes.push("Remises trop fortes : prix relevé au plancher du créateur.");
  }
  const xr = Math.floor(nonNeg(deal.extraRetouches));
  const retouches = { qty: xr, unit: g.extraRetouch, amount: done.length ? xr * g.extraRetouch : 0 };
  const pm = Math.floor(nonNeg(deal.paidMonths));
  const paid = { months: pm, pct: g.paidPct * pm, amount: r0((base * g.paidPct * pm) / 100) };
  const target = done.length ? linesTotal + retouches.amount + paid.amount : 0;
  const anchor = r0((target * (1 + g.anchorPct / 100)) / 10) * 10;
  const floor = done.length ? Math.max(floorTotal, r0(base * (1 - remPct / 100))) + retouches.amount : 0;
  const expectedViews = done.reduce((s, l) => s + l.views * l.qty, 0);
  const effectiveCpm = expectedViews > 0 ? Math.round(((linesTotal / expectedViews) * 1000) * 10) / 10 : 0;

  // Paliers : ancrage → cible (contrepartie de la marque), puis une majoration retirée par
  // palier, la plus forte d'abord, jusqu'au plancher. Jamais de baisse sans contrepartie.
  const steps: Step[] = [];
  if (target > 0) {
    if (anchor > target) steps.push({ label: "Ancrage → cible", contrepartie: "Brief accepté tel quel et paiement à 30 jours", amount: anchor - target, after: target });
    const gives: { label: string; contrepartie: string; amount: number }[] = [
      ...(paid.amount > 0 ? [{ label: "Sans paid media", contrepartie: "La marque ne sponsorise pas le contenu", amount: paid.amount }] : []),
      ...majorations.map((m) => ({ label: `Sans ${m.label.charAt(0).toLowerCase()}${m.label.slice(1)}`, contrepartie: GIVE[m.id], amount: r0((base * m.pct) / 100) })),
    ].sort((a, b) => b.amount - a.amount);
    let cur = target;
    for (const s of gives) {
      const next = Math.max(floor, cur - s.amount);
      if (next >= cur) continue;
      steps.push({ ...s, amount: cur - next, after: next });
      cur = next;
    }
  }

  return {
    lines, priced: done.length > 0, complete: lines.length > 0 && done.length === lines.length, base, majorations, remises, majPct, remPct,
    retouches, paid, floorTotal, targetFloored, target, anchor, floor, effectiveCpm, expectedViews, steps, notes,
  };
}

const GIVE: Record<Adjust["id"], string> = {
  rights: "La marque renonce aux droits organiques",
  exclusivity: "La marque renonce à l'exclusivité",
  rush: "La marque laisse au moins 7 jours avant la publication",
  link: "Pas de lien en bio ni de code promo",
  pack: "",
  partner: "",
};

/** Répartition du HT : commission de la fiche (aucune sous 100 € HT, comme les factures). */
export function splitHT(ht: number, commissionPct: number): { agency: number; creator: number } {
  const agency = ht < COMMISSION_FLOOR_EUR ? 0 : r0((ht * commissionPct) / 100);
  return { agency, creator: ht - agency };
}

export type Alert = { kind: "precedent" | "trop-bas"; text: string; past?: PastRate };

/**
 * Garde-fous : précédent tarifaire cassé (cible sous le dernier total facturé à la marque,
 * ou prix d'un contenu sous le dernier facturé pour ce format) et deal trop bas (CPM effectif
 * sous le minimum). `day` met une date en forme (fmtDay).
 */
export function tarifAlerts(r: TarifResult, past: PastRates | null, g: TarifGrid, eur: (n: number) => string, day: (iso: string) => string): Alert[] {
  const out: Alert[] = [];
  if (!r.priced) return out;
  if (past?.brand && r.target < past.brand.amount) {
    const b = past.brand;
    const d = b.date ? day(b.date) : "";
    out.push({ kind: "precedent", past: b, text: `Précédent tarifaire cassé : ${eur(b.amount)}${b.ht ? " HT" : " TTC"} facturé à ${b.party}${d ? ` (échéance ${d})` : ""}, cible ${eur(r.target)} HT.` });
  }
  for (const l of r.lines) {
    const p = past?.formats[l.key];
    if (!l.priced || !p) continue;
    const unit = Math.round(l.total / l.qty);
    const d = p.date ? day(p.date) : "";
    if (unit < p.amount) out.push({ kind: "precedent", past: p, text: `Précédent tarifaire cassé : ${l.label} facturé ${eur(p.amount)} HT${d ? ` (échéance ${d})` : ""}, ici ${eur(unit)} HT par contenu.` });
  }
  if (r.expectedViews > 0 && r.effectiveCpm < g.minCpm) out.push({ kind: "trop-bas", text: `Deal trop bas : ${eur(r.effectiveCpm)} pour 1000 vues, sous le minimum de ${eur(g.minCpm)}.` });
  return out;
}

const fold = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export type TarifInputs = {
  /** Livrables : nom, vues saisies, vues reprises d'une moyenne (kit, relevé automatique). */
  lines: { label: string; views: number; average: boolean }[];
  /** Plateformes utilisées : nom, abonnés, engagement sur les vues (0 = inconnu). */
  platforms: { label: string; followers: number; erViews: number }[];
  francePct: number | null;
  femalePct: number | null;
  mainAge: string;
  credibility: Credibility;
  delayDays: number | null;
};

/**
 * Données manquantes (à signaler en tête, jamais estimées) et chiffres à vérifier (une
 * moyenne reprise du media kit n'est pas une médiane).
 */
export function tarifGaps(i: TarifInputs): { missing: string[]; verify: string[] } {
  const missing: string[] = [];
  const verify: string[] = [];
  const seen = new Set<string>();
  for (const l of i.lines) {
    if (seen.has(l.label)) continue;
    seen.add(l.label);
    if (!(l.views > 0)) missing.push(`Vues médianes : ${l.label}`);
    else if (l.average) verify.push(`${l.label} : moyenne, pas médiane`);
  }
  for (const p of i.platforms) {
    if (!(p.followers > 0)) missing.push(`Abonnés ${p.label}`);
    if (!(p.erViews > 0)) missing.push(`Engagement sur les vues ${p.label}`);
  }
  if (i.francePct === null) missing.push("Audience : % France");
  if (i.femalePct === null) missing.push("Audience : % femmes");
  if (!i.mainAge.trim()) missing.push("Audience : âge principal");
  if (!i.credibility) missing.push("Crédibilité");
  if (i.delayDays === null) missing.push("Délai brief → publication");
  return { missing, verify };
}

/** Âge principal du media kit : la tranche au plus fort pourcentage (« 25-34 »), "" si aucune. */
export function mainAgeOf(rows: readonly { label?: string; pct?: number | string }[] | null | undefined): string {
  let best = { label: "", pct: -1 };
  for (const r of rows ?? []) {
    const pct = typeof r.pct === "number" ? r.pct : parseFloat(String(r.pct ?? "").replace(",", "."));
    if (r.label && Number.isFinite(pct) && pct > best.pct) best = { label: r.label, pct };
  }
  return best.label;
}

/** % de la France dans les pays du media kit, null si inconnu. */
export function francePctOf(rows: readonly { name?: string; pct?: number | string }[] | null | undefined): number | null {
  const fr = (rows ?? []).find((r) => /^(fr|france)\b/.test(fold(r.name)));
  if (!fr) return null;
  const n = typeof fr.pct === "number" ? fr.pct : parseFloat(String(fr.pct ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Vues d'un contenu pour la méthode : celles du format, jamais celles d'un autre format. */
export function tarifViews(format: string, a: { views: string; storyViews: string; shortViews?: string; postViews?: string }): string {
  if (format === "story") return a.storyViews;
  if (format === "short") return a.shortViews ?? "";
  if (format === "post" || format === "carrousel") return a.postViews ?? "";
  return a.views;
}

/**
 * Lignes de la facture en brouillon (« Créer le devis ») : la base de chaque livrable, puis
 * majorations, remises, retouches, paid media. Somme = cible.
 */
export function tarifQuoteLines(r: TarifResult): { label: string; unit: number }[] {
  const out = r.lines.filter((l) => l.priced).map((l) => ({ label: `${l.label} × ${l.qty}`, unit: l.base }));
  const maj = r.lines.reduce((s, l) => s + l.majorations, 0);
  const rem = r.lines.reduce((s, l) => s + l.remises, 0);
  if (maj > 0) out.push({ label: `Majorations +${r.majPct} % (${r.majorations.map((m) => m.label.toLowerCase()).join(", ")})`, unit: maj });
  if (rem > 0) out.push({ label: `Remises −${r.remPct} % (${r.remises.map((m) => m.label.toLowerCase()).join(", ")})`, unit: -rem });
  const lines = r.base + maj - rem;
  const linesTarget = r.target - r.retouches.amount - r.paid.amount;
  if (linesTarget > lines) out.push({ label: "Plancher du créateur", unit: linesTarget - lines });
  if (r.retouches.amount > 0) out.push({ label: `Retouches en plus × ${r.retouches.qty}`, unit: r.retouches.amount });
  if (r.paid.amount > 0) out.push({ label: `Paid media ${r.paid.months} mois`, unit: r.paid.amount });
  return out;
}

/**
 * Texte copié (pour Marc, à valider avant toute transmission) : chaque montant porte
 * « À VÉRIFIER ». `eur` = formatEuro.
 */
export function tarifCopyText(r: TarifResult, who: string, eur: (n: number) => string, extra: { missing: string[]; alerts: string[]; split: { agency: number; creator: number; pct: number } }): string {
  const v = (n: number) => `${eur(n)} HT (À VÉRIFIER)`;
  const out: string[] = [`Méthode TARIF : ${who || "Créateur"}, à valider par Marc avant tout envoi`];
  if (extra.missing.length) out.push("", "Données manquantes :", ...extra.missing.map((m) => `• ${m}`));
  if (extra.alerts.length) out.push("", "Alertes :", ...extra.alerts.map((m) => `• ${m}`));
  out.push("");
  for (const l of r.lines) {
    if (!l.priced) {
      out.push(`• ${l.label} × ${l.qty} : pas de prix, vues manquantes`);
      continue;
    }
    out.push(`• ${l.label} × ${l.qty} : ${l.views.toLocaleString("fr-FR")} vues, CPM ${eur(l.cpm)}, coef ${String(l.coef).replace(".", ",")}, base ${eur(l.base)}, majorations ${eur(l.majorations - l.remises)}, total ${v(l.total)}`);
  }
  if (r.retouches.amount > 0) out.push(`• Retouches en plus × ${r.retouches.qty} : ${v(r.retouches.amount)}`);
  if (r.paid.amount > 0) out.push(`• Paid media ${r.paid.months} mois (+${r.paid.pct} %) : ${v(r.paid.amount)}`);
  out.push("", `Ancrage : ${v(r.anchor)}`, `Cible : ${v(r.target)}`, `Plancher : ${v(r.floor)}`);
  if (r.effectiveCpm > 0) out.push(`CPM effectif : ${eur(r.effectiveCpm)} pour 1000 vues attendues (À VÉRIFIER)`);
  if (r.steps.length) out.push("", "Paliers de baisse :", ...r.steps.map((s) => `• ${s.label} : −${eur(s.amount)}, contre « ${s.contrepartie} » → ${v(s.after)}`));
  out.push("", `Répartition de la cible : créateur ${v(extra.split.creator)}, agence ${v(extra.split.agency)} (commission ${extra.split.pct} %)`);
  return out.join("\n");
}
