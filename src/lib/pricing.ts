/**
 * Moteur de tarification — logique PURE et testée (le reste de l'app n'est que l'UI).
 *
 * Deux modèles DISTINCTS, parce qu'ils ne se tarifient pas pareil :
 *
 *  1. INFLUENCE (le créateur publie sur SON compte) → basé sur l'audience :
 *       prix/livrable = (abonnés / 1000) × CPM(plateforme, format) × niche × engagement
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

// ─────────────────────────────── communs ───────────────────────────────

/** « 45K », « 1,2M », « 45 000 » → nombre. Renvoie 0 si illisible (jamais NaN). */
export function parseFollowers(s: string | number | null | undefined): number {
  if (typeof s === "number") return Number.isFinite(s) ? Math.max(0, s) : 0;
  const str = String(s ?? "").trim().replace(/\s/g, "").replace(",", ".").toLowerCase();
  const m = /^([\d.]+)\s*([km])?/.exec(str);
  if (!m) return 0;
  let n = parseFloat(m[1]) || 0;
  if (m[2] === "k") n *= 1000;
  else if (m[2] === "m") n *= 1_000_000;
  return Math.max(0, Math.round(n));
}

/** « 3,5 % » → 3.5. Renvoie 0 si illisible. */
export function parseEr(s: string | number | null | undefined): number {
  if (typeof s === "number") return Number.isFinite(s) ? Math.max(0, s) : 0;
  const m = /([\d.,]+)/.exec(String(s ?? ""));
  return m ? Math.max(0, parseFloat(m[1].replace(",", ".")) || 0) : 0;
}

/** Multiplicateur d'engagement (barème marché) : <1 % pénalisé, >8 % survalorisé. */
export function engMult(er: number): number {
  if (er < 1) return 0.7;
  if (er < 2) return 0.85;
  if (er < 3.5) return 1.0;
  if (er < 6) return 1.15;
  if (er < 8) return 1.25;
  return 1.35;
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
export type InfFormat = { key: string; label: string; cpm: [number, number] };
export type InfPlatform = { key: PlatKey; label: string; formats: InfFormat[] };

/** CPM en €/1000 abonnés par plateforme × format (fourchettes marché 2026). */
export const INF_PLATFORMS: InfPlatform[] = [
  {
    key: "instagram",
    label: "Instagram",
    formats: [
      { key: "reel", label: "Reel", cpm: [16, 32] },
      { key: "post", label: "Post feed", cpm: [9, 18] },
      { key: "carrousel", label: "Carrousel", cpm: [10, 20] },
      { key: "story", label: "Story (×3)", cpm: [7, 14] },
    ],
  },
  {
    key: "tiktok",
    label: "TikTok",
    formats: [
      { key: "video", label: "Vidéo", cpm: [11, 23] },
      { key: "story", label: "Story / photo", cpm: [6, 12] },
    ],
  },
  {
    key: "youtube",
    label: "YouTube",
    formats: [
      { key: "integration", label: "Intégration", cpm: [18, 37] },
      { key: "dedicated", label: "Vidéo dédiée", cpm: [55, 110] },
      { key: "short", label: "Short", cpm: [10, 22] },
    ],
  },
  {
    key: "snapchat",
    label: "Snapchat",
    formats: [{ key: "story", label: "Story (×3)", cpm: [6, 12] }],
  },
  { key: "x", label: "X", formats: [{ key: "post", label: "Post", cpm: [4, 9] }] },
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

export function infFormat(platform: PlatKey, formatKey: string): InfFormat | undefined {
  return INF_PLATFORMS.find((p) => p.key === platform)?.formats.find((f) => f.key === formatKey);
}

/** Un livrable influence : sa plateforme, son format, sa quantité, SON audience. */
export type InfItem = { platform: PlatKey; format: string; qty: number; followers: number; er: number };

/** Fourchette BRUTE d'un livrable (avant options/remise de package). */
export function infItemRange(item: InfItem, nicheM: number): Range {
  const fmt = infFormat(item.platform, item.format);
  const f = Math.max(0, item.followers || 0);
  const q = Math.max(1, Math.round(item.qty || 1));
  if (!fmt || f <= 0) return { min: 0, max: 0, mid: 0 };
  const em = engMult(Math.max(0, item.er || 0));
  const unit = (cpm: number) => (f / 1000) * cpm * nicheM * em;
  return asRange(unit(fmt.cpm[0]) * q, unit(fmt.cpm[1]) * q);
}

export type InfOptions = { exclusivite: boolean; droitsUsage: boolean; remisePct: number };

/** Package cross-plateforme : somme des livrables × options × (1 − remise). */
export function computeInfluence(items: InfItem[], nicheM: number, opts: InfOptions): Range & { addon: number; itemsPriced: (Range & { item: InfItem })[] } {
  const itemsPriced = items.map((item) => ({ ...infItemRange(item, nicheM), item }));
  const sumMin = itemsPriced.reduce((s, r) => s + r.min, 0);
  const sumMax = itemsPriced.reduce((s, r) => s + r.max, 0);
  const addon = 1 + (opts.exclusivite ? 0.25 : 0) + (opts.droitsUsage ? 0.3 : 0);
  const disc = 1 - Math.min(0.5, Math.max(0, (opts.remisePct || 0) / 100));
  return { ...asRange(sumMin * addon * disc, sumMax * addon * disc), addon, itemsPriced };
}

// ───────────────────────────────── UGC ─────────────────────────────────

export type UgcType = { key: string; label: string; base: [number, number] };

/** Forfaits UGC 2026 (€ par livrable, production incluant un montage simple). */
export const UGC_TYPES: UgcType[] = [
  { key: "video_court", label: "Vidéo courte (≤ 30s)", base: [120, 280] },
  { key: "video_long", label: "Vidéo longue (30–60s)", base: [180, 400] },
  { key: "photo", label: "Photo", base: [50, 130] },
  { key: "carrousel", label: "Carrousel photos (3–5)", base: [120, 250] },
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

/** Package UGC : Σ(base × qté) × niveau × (1 + droits + options). */
export function computeUgc(items: UgcItem[], levelM: number, opts: UgcOptions): Range & { addon: number; itemsPriced: (Range & { item: UgcItem })[] } {
  const itemsPriced = items.map((item) => {
    const base = ugcBase(item.type);
    const q = Math.max(1, Math.round(item.qty || 1));
    return base ? { ...asRange(base[0] * q, base[1] * q), item } : { min: 0, max: 0, mid: 0, item };
  });
  const sumMin = itemsPriced.reduce((s, r) => s + r.min, 0);
  const sumMax = itemsPriced.reduce((s, r) => s + r.max, 0);
  const addon =
    1 + ugcUsageMult(opts.usage) + (opts.exclusivite ? 0.25 : 0) + (opts.rushes ? 0.15 : 0) + (opts.montage ? 0.2 : 0) + (opts.express ? 0.2 : 0);
  return { ...asRange(sumMin * levelM * addon, sumMax * levelM * addon), addon, itemsPriced };
}
