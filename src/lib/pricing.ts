/**
 * Moteur de tarification — logique PURE et testée (le reste de l'app n'est que l'UI).
 *
 * Deux modèles DISTINCTS, parce qu'ils ne se tarifient pas pareil :
 *
 *  1. INFLUENCE (le créateur publie sur SON compte) → basé sur les VUES attendues :
 *       prix/livrable = (vues attendues / 1000) × CPM vues(plateforme, format) × niche × engagement
 *     Le CPM vues est CALIBRÉ sur le barème « € / 1000 abonnés » de l'agence :
 *       CPM vues = CPM abonnés ÷ taux de vue habituel du format (ex. reel ≈ 30 % des abonnés).
 *     → à vues habituelles, même prix qu'avec les abonnés ; plus de vues réelles (TikTok,
 *       YouTube, Instagram connecté) = plus cher, moins de vues = moins cher. Sans vues
 *       connues, les vues sont ESTIMÉES (abonnés × taux habituel), affiché comme tel.
 *     Cross-plateforme = somme des livrables, CHACUN avec l'audience de SA plateforme
 *     (un créateur n'a pas la même audience sur IG et TikTok), puis options + remise pack.
 *
 *  2. UGC (le créateur livre du contenu que la MARQUE exploite) → FORFAIT par livrable,
 *     INDÉPENDANT de l'audience : base production × niveau d'expérience × options
 *     (droits d'usage/ads, exclusivité, rushes, montage avancé, express).
 *
 * Barèmes 2026 (CPM influence + forfaits UGC + multiplicateurs) alignés sur les
 * références marché (Influencer Marketing Hub, InfluenceFlow, Shopify, Meltwater).
 * Toujours une FOURCHETTE (min–max) pour ne pas sous-vendre ; « cible » = milieu.
 */

import { parseNum } from "./engagement";

// ─────────────────────────────── communs ───────────────────────────────

/**
 * « 45K », « 1,2M », « 45 000 », « 12.000 », « 12,000 », « ~12k » → nombre entier.
 * Même analyseur que le calculateur d'engagement (parseNum) : un seul lecteur de
 * chiffres dans l'app. Renvoie 0 si illisible (jamais NaN).
 */
export function parseFollowers(s: string | number | null | undefined): number {
  if (typeof s === "number") return Number.isFinite(s) ? Math.max(0, s) : 0;
  return Math.max(0, Math.round(parseNum(s)));
}

/** « 3,5 % » → 3.5. Renvoie 0 si illisible. */
export function parseEr(s: string | number | null | undefined): number {
  if (typeof s === "number") return Number.isFinite(s) ? Math.max(0, s) : 0;
  const m = /([\d.,]+)/.exec(String(s ?? ""));
  return m ? Math.max(0, parseFloat(m[1].replace(",", ".")) || 0) : 0;
}

/** Multiplicateur d'engagement SUR LES ABONNÉS (barème marché) : <1 % pénalisé, >8 % survalorisé.
 *  Engagement inconnu (vide, 0) : neutre (×1), comme engMultViews, pas une pénalité. */
export function engMult(er: number): number {
  if (!(er > 0)) return 1;
  if (er < 1) return 0.7;
  if (er < 2) return 0.85;
  if (er < 3.5) return 1.0;
  if (er < 6) return 1.15;
  if (er < 8) return 1.25;
  return 1.35;
}

/**
 * Multiplicateur d'engagement SUR LES VUES (TikTok, YouTube, Instagram connecté) : plus
 * doux, car les vues récompensent déjà la portée. Repères : ~4–7 % = normal sur TikTok.
 */
export function engMultViews(er: number): number {
  if (er <= 0) return 1;
  if (er < 2) return 0.85;
  if (er < 4) return 0.95;
  if (er < 7) return 1.05;
  if (er < 10) return 1.15;
  return 1.25;
}

export function tier(f: number): string {
  if (f < 10_000) return "Nano";
  if (f < 100_000) return "Micro";
  if (f < 500_000) return "Mid-tier";
  if (f < 1_000_000) return "Macro";
  return "Méga";
}

/** Arrondi « commercial » (paliers 10/50/100) pour un prix présentable. */
export function roundNice(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const step = n < 1000 ? 10 : n < 10_000 ? 50 : 100;
  return Math.round(n / step) * step;
}

export type Range = { min: number; max: number; mid: number };
const asRange = (min: number, max: number): Range => ({ min: roundNice(min), max: roundNice(max), mid: roundNice((min + max) / 2) });

// ────────────────────────────── influence ──────────────────────────────

export type PlatKey = "instagram" | "tiktok" | "youtube" | "snapchat" | "x";
/** cpm = € pour 1000 ABONNÉS (barème historique) ; rate = taux de vue habituel (vues ÷ abonnés). */
export type InfFormat = { key: string; label: string; cpm: [number, number]; rate: number };
export type InfPlatform = { key: PlatKey; label: string; formats: InfFormat[] };

/**
 * Barème par plateforme × format : € pour 1000 abonnés (fourchettes marché 2026) et taux
 * de vue habituel (vues d'un contenu ÷ abonnés, ordres de grandeur du secteur, à ajuster
 * dans le barème). Le CPM vues s'en déduit (cpmViews).
 */
export const INF_PLATFORMS: InfPlatform[] = [
  {
    key: "instagram",
    label: "Instagram",
    formats: [
      { key: "reel", label: "Reel", cpm: [16, 32], rate: 0.3 },
      { key: "post", label: "Post feed", cpm: [9, 18], rate: 0.12 },
      { key: "carrousel", label: "Carrousel", cpm: [10, 20], rate: 0.15 },
      { key: "story", label: "Story (×3)", cpm: [7, 14], rate: 0.07 },
    ],
  },
  {
    key: "tiktok",
    label: "TikTok",
    formats: [
      { key: "video", label: "Vidéo", cpm: [11, 23], rate: 0.3 },
      { key: "story", label: "Story / photo", cpm: [6, 12], rate: 0.08 },
    ],
  },
  {
    key: "youtube",
    label: "YouTube",
    formats: [
      { key: "integration", label: "Intégration", cpm: [18, 37], rate: 0.15 },
      { key: "dedicated", label: "Vidéo dédiée", cpm: [55, 110], rate: 0.15 },
      { key: "short", label: "Short", cpm: [10, 22], rate: 0.25 },
    ],
  },
  {
    key: "snapchat",
    label: "Snapchat",
    formats: [{ key: "story", label: "Story (×3)", cpm: [6, 12], rate: 0.15 }],
  },
  { key: "x", label: "X", formats: [{ key: "post", label: "Post", cpm: [4, 9], rate: 0.05 }] },
];

export const NICHES = [
  { value: "lifestyle", label: "Lifestyle", m: 1.0 },
  { value: "beaute", label: "Mode / Beauté", m: 1.1 },
  { value: "food", label: "Food", m: 1.0 },
  { value: "sport", label: "Sport / Fitness", m: 1.1 },
  { value: "voyage", label: "Voyage", m: 1.05 },
  { value: "tech", label: "Tech", m: 1.3 },
  { value: "finance", label: "Finance / B2B / Luxe", m: 1.5 },
  { value: "gaming", label: "Gaming", m: 0.9 },
  { value: "divertissement", label: "Divertissement / Meme", m: 0.7 },
];
export const nicheMult = (v: string): number => NICHES.find((n) => n.value === v)?.m ?? 1;

/** Barème modifié par l'agence (Créateurs → Tarifs → Barème) : clé « plateforme.format ». */
export type RateOverrides = Record<string, { cpm?: [number, number]; rate?: number }>;

export function infFormat(platform: PlatKey, formatKey: string, rates?: RateOverrides): InfFormat | undefined {
  const base = INF_PLATFORMS.find((p) => p.key === platform)?.formats.find((f) => f.key === formatKey);
  if (!base) return undefined;
  const o = rates?.[`${platform}.${formatKey}`];
  const ok = (v?: [number, number]) => !!v && v[0] > 0 && v[1] >= v[0];
  return { ...base, cpm: ok(o?.cpm) ? (o!.cpm as [number, number]) : base.cpm, rate: o?.rate && o.rate > 0 && o.rate <= 3 ? o.rate : base.rate };
}

/** CPM en € pour 1000 VUES, déduit du barème abonnés : cpm ÷ taux de vue habituel. */
export function cpmViews(fmt: InfFormat): [number, number] {
  return [fmt.cpm[0] / fmt.rate, fmt.cpm[1] / fmt.rate];
}

/**
 * Un livrable influence : sa plateforme, son format, sa quantité, SON audience.
 * views = vues attendues PAR contenu (réelles si connues : TikTok, YouTube, Instagram
 * connecté, ou saisies) ; absent → estimées depuis les abonnés.
 * erBase = sur quoi est calculé l'engagement donné (vues ou abonnés).
 */
export type InfItem = { platform: PlatKey; format: string; qty: number; followers: number; er: number; views?: number; erBase?: "views" | "followers" };

export type PricedItem = Range & {
  /** Vues RETENUES par contenu, et si elles sont estimées (pas de vraies vues). */
  views: number;
  estimated: boolean;
  /** Vraies vues ramenées au plafond (1,5 × les vues habituelles d'après les abonnés). */
  capped: boolean;
  /** CPM vues appliqué (€ / 1000 vues), multiplicateurs, et la phrase d'explication. */
  cpm: [number, number];
  nicheM: number;
  engM: number;
  explain: string;
};

/** Plafond des vraies vues : 1,5 × les vues habituelles du format d'après les abonnés.
 *  Une vidéo virale isolée ne doit pas faire tripler le prix de la suivante. */
export const VIEWS_CAP = 1.5;

const fmtK = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(".0", "").replace(".", ",")}M` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(".0", "").replace(".", ",")}K` : String(Math.round(n)));

/** Fourchette BRUTE d'un livrable (avant options/remise de package). */
export function infItemRange(item: InfItem, nicheM: number, rates?: RateOverrides): PricedItem {
  const fmt = infFormat(item.platform, item.format, rates);
  const f = Math.max(0, item.followers || 0);
  const q = Math.max(1, Math.round(item.qty || 1));
  const real = Math.max(0, item.views || 0);
  const usual = fmt ? Math.round(f * fmt.rate) : 0;
  // Vraies vues plafonnées à 1,5 × l'habituel (seulement si les abonnés sont connus).
  const cap = usual > 0 ? Math.round(usual * VIEWS_CAP) : 0;
  const capped = real > 0 && cap > 0 && real > cap;
  const views = real > 0 ? (capped ? cap : real) : usual;
  const empty: PricedItem = { min: 0, max: 0, mid: 0, views, estimated: real <= 0, capped, cpm: [0, 0], nicheM, engM: 1, explain: "" };
  if (!fmt || views <= 0) return empty;
  const er = Math.max(0, item.er || 0);
  const em = item.erBase === "views" ? engMultViews(er) : engMult(er);
  const cpm = cpmViews(fmt);
  const unit = (c: number) => (views / 1000) * c * nicheM * em;
  const rng = asRange(unit(cpm[0]) * q, unit(cpm[1]) * q);
  const what = capped ? `vues retenues (vues plafonnées : ${fmtK(real)} mesurées, plafond 1,5 × l'habituel)` : real > 0 ? "vues attendues" : "vues estimées";
  const explain = `${fmtK(views)} ${what}${q > 1 ? ` × ${q}` : ""} × ${Math.round(cpm[0])} à ${Math.round(cpm[1])} € / 1000 vues` +
    `${nicheM !== 1 ? ` × niche ${String(nicheM).replace(".", ",")}` : ""}${em !== 1 ? ` × engagement ${String(em).replace(".", ",")}` : ""}`;
  return { ...rng, views, estimated: real <= 0, capped, cpm, nicheM, engM: em, explain };
}

/** Exclusivité et droits d'usage : durées (anciennes cases à cocher acceptées). */
export const EXCLUSIVITY = [
  { value: "none", label: "Aucune", m: 0 },
  { value: "1m", label: "1 mois", m: 0.15 },
  { value: "3m", label: "3 mois", m: 0.25 },
  { value: "6m", label: "6 mois", m: 0.4 },
];
export const USAGE_RIGHTS = [
  { value: "none", label: "Aucun", m: 0 },
  { value: "organique", label: "Repost par la marque (organique)", m: 0.15 },
  { value: "ads1", label: "Pub · 1 mois", m: 0.2 },
  { value: "ads3", label: "Pub · 3 mois", m: 0.35 },
  { value: "ads6", label: "Pub · 6 mois", m: 0.5 },
  { value: "ads12", label: "Pub · 12 mois", m: 0.8 },
];
export type InfOptions = { exclusivite: boolean | string; droitsUsage: boolean | string; whitelisting?: boolean; remisePct: number };
const pick = (list: { value: string; m: number }[], v: boolean | string, legacy: number) =>
  typeof v === "boolean" ? (v ? legacy : 0) : list.find((x) => x.value === v)?.m ?? 0;

/**
 * Total d'un devis, TRANSPARENT : somme des lignes affichées (déjà arrondies), puis
 * options en € (+X %), puis remise en € (−Y %), chaque montant arrondi à l'euro.
 * Le total est EXACTEMENT sous-total + options − remise : ce qu'affiche l'écran et ce
 * que lit la marque dans la proposition copiée tombent juste, à l'euro près.
 */
export type QuoteTotals = Range & {
  /** Somme des lignes. */
  sub: Range;
  /** Montant des options (en €) et leur pourcentage (arrondi). */
  options: Range;
  optionsPct: number;
  /** Montant de la remise (en €, positif) et son pourcentage. */
  discount: Range;
  discountPct: number;
};

export function quoteTotals(lines: Range[], addon: number, remisePct = 0): QuoteTotals {
  const d = Math.min(0.5, Math.max(0, (remisePct || 0) / 100));
  const extra = Math.max(0, addon - 1);
  const one = (k: keyof Range) => {
    const sub = lines.reduce((s, r) => s + r[k], 0);
    const opt = Math.round(sub * extra);
    const disc = Math.round((sub + opt) * d);
    return { sub, opt, disc, total: sub + opt - disc };
  };
  const [a, b, c] = [one("min"), one("max"), one("mid")];
  return {
    min: a.total, max: b.total, mid: c.total,
    sub: { min: a.sub, max: b.sub, mid: c.sub },
    options: { min: a.opt, max: b.opt, mid: c.opt },
    optionsPct: Math.round(extra * 100),
    discount: { min: a.disc, max: b.disc, mid: c.disc },
    discountPct: Math.round(d * 100),
  };
}

/** Package cross-plateforme : somme des livrables, + options, − remise (voir quoteTotals). */
export function computeInfluence(items: InfItem[], nicheM: number, opts: InfOptions, rates?: RateOverrides): QuoteTotals & { addon: number; itemsPriced: (PricedItem & { item: InfItem })[] } {
  const itemsPriced = items.map((item) => ({ ...infItemRange(item, nicheM, rates), item }));
  // Pub depuis le compte de la créatrice (« whitelisting », Spark Ads, pubs partenaires) : +20 %.
  const addon = 1 + pick(EXCLUSIVITY, opts.exclusivite, 0.25) + pick(USAGE_RIGHTS, opts.droitsUsage, 0.3) + (opts.whitelisting ? 0.2 : 0);
  return { ...quoteTotals(itemsPriced, addon, opts.remisePct), addon, itemsPriced };
}

/**
 * Bilan de campagne : ce que la marque a réellement payé par 1000 vues, par personne
 * touchée et par interaction. null quand la donnée manque (jamais de faux chiffre).
 * `stats` (une ligne par contenu) : coût pour 1000 vues seulement si CHAQUE contenu a
 * ses vues, coût pour 1000 personnes touchées seulement si CHACUN a sa couverture ;
 * sinon le budget de toute la campagne serait divisé par les chiffres d'une partie.
 */
export function campaignCosts(
  budget: number | null,
  t: { views: number; reach: number; interactions: number },
  stats?: { views: number; reach: number }[],
) {
  const b = Math.max(0, budget || 0);
  const every = (f: (s: { views: number; reach: number }) => number) => !stats || (stats.length > 0 && stats.every((s) => f(s) > 0));
  return {
    cpm: b > 0 && t.views > 0 && every((s) => s.views) ? (b / t.views) * 1000 : null,
    cpmReach: b > 0 && t.reach > 0 && every((s) => s.reach) ? (b / t.reach) * 1000 : null,
    cpe: b > 0 && t.interactions > 0 ? b / t.interactions : null,
  };
}

// ───────────────────────────────── UGC ─────────────────────────────────

export type UgcType = { key: string; label: string; base: [number, number] };

/** Forfaits UGC 2026 (€ par livrable, production incluant un montage simple). */
export const UGC_TYPES: UgcType[] = [
  { key: "video_court", label: "Vidéo courte (≤ 30s)", base: [120, 280] },
  { key: "video_long", label: "Vidéo longue (30 à 60 s)", base: [180, 400] },
  { key: "photo", label: "Photo", base: [50, 130] },
  { key: "carrousel", label: "Carrousel photos (3 à 5)", base: [120, 250] },
  { key: "unboxing", label: "Unboxing / démo produit", base: [150, 320] },
  { key: "hook", label: "Hook / variante suppl.", base: [40, 90] },
];
export const ugcBase = (key: string): [number, number] | undefined => UGC_TYPES.find((t) => t.key === key)?.base;

export const UGC_LEVELS = [
  { value: "debutant", label: "Débutant", m: 0.75 },
  { value: "confirme", label: "Confirmé", m: 1.0 },
  { value: "expert", label: "Expert", m: 1.35 },
];
export const ugcLevelMult = (v: string): number => UGC_LEVELS.find((l) => l.value === v)?.m ?? 1;

/** Droits d'exploitation par la marque (en % du contenu). Le cœur du prix UGC. */
export const UGC_USAGE = [
  { value: "none", label: "Aucun (organique marque)", m: 0 },
  { value: "ads3", label: "Ads · 3 mois", m: 0.3 },
  { value: "ads6", label: "Ads · 6 mois", m: 0.5 },
  { value: "ads12", label: "Ads · 12 mois", m: 0.8 },
  { value: "perpetuite", label: "Perpétuité / tous supports", m: 1.2 },
];
export const ugcUsageMult = (v: string): number => UGC_USAGE.find((u) => u.value === v)?.m ?? 0;

export type UgcItem = { type: string; qty: number };
export type UgcOptions = { usage: string; exclusivite: boolean; rushes: boolean; montage: boolean; express: boolean };

/** Package UGC : Σ(base × qté × niveau) par ligne, + droits et options (voir quoteTotals).
 *  Le niveau est DANS chaque ligne : la somme des lignes affichées = le sous-total. */
export function computeUgc(items: UgcItem[], levelM: number, opts: UgcOptions): QuoteTotals & { addon: number; itemsPriced: (Range & { item: UgcItem })[] } {
  const itemsPriced = items.map((item) => {
    const base = ugcBase(item.type);
    const q = Math.max(1, Math.round(item.qty || 1));
    return base ? { ...asRange(base[0] * q * levelM, base[1] * q * levelM), item } : { min: 0, max: 0, mid: 0, item };
  });
  const addon =
    1 + ugcUsageMult(opts.usage) + (opts.exclusivite ? 0.25 : 0) + (opts.rushes ? 0.15 : 0) + (opts.montage ? 0.2 : 0) + (opts.express ? 0.2 : 0);
  return { ...quoteTotals(itemsPriced, addon), addon, itemsPriced };
}
