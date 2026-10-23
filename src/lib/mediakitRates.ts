import { infItemRange, nicheMult, parseEr, parseFollowers, type PlatKey, type RateOverrides } from "./pricing";
import { viewsFor, type Aud, type CreatorAudience } from "./creatorAudience";

/*
 * Tarifs → media kit (logique PURE, testée par mediakitRates.test.ts). Les prix calculés
 * par le barème de l'agence (page Tarifs) remplissent la grille « Tarifs indicatifs » du
 * media kit du créateur (`creators.mediakit.rates`, prix HT en chiffres comme saisis dans
 * l'éditeur : « 1200 »). Le site lit `label`, `price`, `detail`, `labelEn`, `detailEn` :
 * les intitulés ci-dessous sont ceux que son vocabulaire traduit en anglais.
 */

export type KitRate = { label: string; price: string; detail?: string; labelEn?: string; detailEn?: string };

type RateDef = { label: string; detail?: string; detailEn?: string };
/** Intitulé de chaque format sur le media kit (mêmes mots que les raccourcis de l'éditeur). */
const RATE_DEFS: Record<string, RateDef> = {
  "instagram.reel": { label: "Réel Instagram" },
  "instagram.post": { label: "Post Instagram" },
  "instagram.carrousel": { label: "Carrousel Instagram" },
  "instagram.story": { label: "Story Instagram", detail: "Lot de 3 stories", detailEn: "Set of 3 stories" },
  "tiktok.video": { label: "Vidéo TikTok" },
  "tiktok.story": { label: "Story TikTok", detail: "Story ou photo", detailEn: "Story or photo" },
  "youtube.integration": { label: "Intégration YouTube", detail: "Passage dans une vidéo", detailEn: "Segment within a video" },
  "youtube.dedicated": { label: "Vidéo YouTube dédiée" },
  "youtube.short": { label: "Short YouTube" },
  "snapchat.story": { label: "Story Snapchat", detail: "Lot de 3 stories", detailEn: "Set of 3 stories" },
  "x.post": { label: "Post X" },
};

/** Grille standard d'une plateforme quand on calcule tout le media kit (formats les plus vendus). */
const GRID: Record<PlatKey, string[]> = {
  instagram: ["reel", "carrousel", "story"],
  tiktok: ["video"],
  youtube: ["integration", "dedicated", "short"],
  snapchat: ["story"],
  x: ["post"],
};

const PLAT_LABEL: Record<PlatKey, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", snapchat: "Snapchat", x: "X" };

export function rateDef(platform: PlatKey, format: string): RateDef {
  return RATE_DEFS[`${platform}.${format}`] ?? { label: `${format} ${PLAT_LABEL[platform]}` };
}

/** Prix cible d'UN contenu (quantité 1, sans options), au format du kit (« 1200 »), ou "" si incalculable. */
export function unitRatePrice(platform: PlatKey, format: string, aud: Aud, niche: string, rates?: RateOverrides): string {
  const r = infItemRange(
    { platform, format, qty: 1, followers: parseFollowers(aud.followers), er: parseEr(aud.er), views: parseFollowers(viewsFor(format, aud)), erBase: aud.erBase },
    nicheMult(niche),
    rates,
  );
  return r.mid > 0 ? String(r.mid) : "";
}

const withDef = (platform: PlatKey, format: string, price: string): KitRate => {
  const d = rateDef(platform, format);
  return { label: d.label, price, ...(d.detail ? { detail: d.detail } : {}), ...(d.detailEn ? { detailEn: d.detailEn } : {}) };
};

/** Lignes de tarifs pour des livrables précis (page Tarifs : ceux du devis en cours). */
export function ratesForItems(items: { platform: PlatKey; format: string; aud: Aud }[], niche: string, rates?: RateOverrides): KitRate[] {
  const out: KitRate[] = [];
  for (const it of items) {
    const price = unitRatePrice(it.platform, it.format, it.aud, niche, rates);
    if (!price) continue;
    const row = withDef(it.platform, it.format, price);
    if (!out.some((r) => sameLabel(r.label, row.label))) out.push(row);
  }
  return out;
}

/**
 * Grille complète du media kit : chaque plateforme où le créateur a des abonnés (chiffres
 * propres à la plateforme, ou ceux de la fiche pour sa plateforme principale). `missing` =
 * plateformes connues sans abonnés (« Il manque les abonnés TikTok »), jamais inventées.
 */
export function ratesFromPricing(a: CreatorAudience, rates?: RateOverrides): { rows: KitRate[]; missing: string[] } {
  const platforms = new Map<PlatKey, Aud>();
  for (const [k, v] of Object.entries(a.own) as [PlatKey, Aud][]) platforms.set(k, v);
  if (a.main && !platforms.has(a.main)) platforms.set(a.main, a.fallback);
  const rows: KitRate[] = [];
  const missing: string[] = [];
  for (const key of Object.keys(GRID) as PlatKey[]) {
    const aud = platforms.get(key);
    if (!aud) continue;
    if (parseFollowers(aud.followers) <= 0) {
      missing.push(PLAT_LABEL[key]);
      continue;
    }
    rows.push(...ratesForItems(GRID[key].map((format) => ({ platform: key, format, aud })), a.niche, rates));
  }
  return { rows, missing };
}

const fold = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[-_\s]+/g, " ").trim();
/** Même prestation (casse, accents et espaces ignorés) : « Réel Instagram » = « reel instagram ». */
export const sameLabel = (a: string, b: string) => fold(a) === fold(b);

export type RatesMerge = {
  rates: KitRate[];
  added: KitRate[];
  /** Lignes déjà sur le kit dont le prix change (`from` = ancien prix). */
  replaced: (KitRate & { from: string })[];
};

/**
 * Fusionne la grille calculée dans celle du kit : même intitulé → prix (et précision
 * calculée) remplacés à sa place ; nouvelles prestations ajoutées à la fin ; les lignes
 * saisies à la main restent telles quelles. Jamais de doublon.
 */
export function mergeRates(existing: readonly KitRate[], computed: readonly KitRate[]): RatesMerge {
  const rates = existing.map((r) => ({ ...r }));
  const added: KitRate[] = [];
  const replaced: (KitRate & { from: string })[] = [];
  for (const c of computed) {
    const i = rates.findIndex((r) => sameLabel(r.label, c.label));
    if (i === -1) {
      rates.push({ ...c });
      added.push(c);
      continue;
    }
    const old = rates[i];
    const next: KitRate = { ...old, price: c.price, ...(c.detail ? { detail: c.detail } : {}), ...(c.detailEn ? { detailEn: c.detailEn } : {}) };
    if (old.price !== next.price || old.detail !== next.detail) replaced.push({ ...next, from: old.price });
    rates[i] = next;
  }
  return { rates, added, replaced };
}
