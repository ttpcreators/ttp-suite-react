import { INF_PLATFORMS, NICHES, type PlatKey } from "./pricing";

/*
 * Audience d'un créateur PAR PLATEFORME, lue sur sa fiche (logique PURE, testée par
 * creatorAudience.test.ts). Partagée par la page Tarifs (préremplissage) et l'éditeur de
 * media kit (grille de tarifs calculée). Vraies données d'abord : TikTok / YouTube connectés,
 * Instagram du jour, plateformes du media kit ; sinon les chiffres généraux de la fiche.
 */

/** Audience d'une plateforme (saisie une fois, ou reprise de la fiche du créateur). */
export type Aud = { followers: string; er: string; views: string; storyViews: string; shortViews?: string; src: string; erBase: "views" | "followers" };
export const NO_AUD: Aud = { followers: "", er: "", views: "", storyViews: "", src: "", erBase: "followers" };

/** Formats dont les vues moyennes de la plateforme mesurent un contenu. */
export const VIDEO_FORMATS = ["reel", "video", "integration", "dedicated"];

/** Vues attendues d'un livrable : celles de la plateforme pour le format qu'elles mesurent, sinon vide (estimées). */
export function viewsFor(format: string, a: Aud): string {
  if (format === "story") return a.storyViews;
  if (format === "short") return a.shortViews ?? a.views;
  return VIDEO_FORMATS.includes(format) ? a.views : "";
}

type Kit = { key?: string; followers?: string; er?: string; avgViews?: string; avgStoryViews?: string };
/** Colonnes de `creators` utiles (select « * » côté app). */
export type AudienceRow = {
  followers?: string | null; er?: string | null; niche?: string | null; platform?: string | null;
  mediakit?: { platforms?: Kit[] } | null;
  ig?: { followers?: number; er?: number | null; link?: unknown; insights?: { reelViews?: number | null } | null } | null;
  tt?: { followers?: number | null; avgViews?: number | null; er?: number | null; link?: unknown } | null;
  yt?: { subscribers?: number | null; avgViews?: number | null; avgShortViews?: number | null; er?: number | null; link?: unknown } | null;
};

export type CreatorAudience = {
  /** Plateformes dont on a des chiffres PROPRES (media kit, Instagram du jour, TikTok / YouTube connectés). */
  own: Partial<Record<PlatKey, Aud>>;
  /** Chiffres généraux de la fiche (abonnés, engagement), sans plateforme précise. */
  fallback: Aud;
  /** Plateforme principale de la fiche (« Instagram », « TikTok »…), si reconnue. */
  main: PlatKey | null;
  /** Niche du barème (« lifestyle » si rien ne correspond). */
  niche: string;
};

const PLAT_KEYS = INF_PLATFORMS.map((p) => p.key);
const asPlat = (s: string | null | undefined): PlatKey | null => {
  const v = (s ?? "").toLowerCase().trim();
  return (PLAT_KEYS.find((k) => v === k || v.includes(k)) as PlatKey | undefined) ?? (v.includes("twitter") ? "x" : null);
};

export function creatorAudience(row: AudienceRow): CreatorAudience {
  const own: Partial<Record<PlatKey, Aud>> = {};
  for (const p of row.mediakit?.platforms ?? []) {
    const key = asPlat(p.key);
    if (!key) continue;
    // ER des media kits = calculateur d'engagement (sur les vues des 30 derniers jours).
    own[key] = { followers: String(p.followers ?? ""), er: String(p.er ?? ""), views: String(p.avgViews ?? ""), storyViews: String(p.avgStoryViews ?? ""), src: p.avgViews ? "kit" : "fiche", erBase: "views" };
  }
  // Instagram du jour (Meta) : abonnés et engagement public (sur les abonnés).
  if (row.ig?.followers) {
    const k = own.instagram ?? NO_AUD;
    const rv = row.ig.link ? row.ig.insights?.reelViews : null;
    own.instagram = {
      ...k, followers: String(row.ig.followers), er: row.ig.er != null ? String(row.ig.er) : k.er, erBase: row.ig.er != null ? "followers" : k.erBase,
      views: rv ? String(rv) : k.views, src: rv ? "igreels" : k.views ? "kit" : "instagram",
    };
  }
  // TikTok connecté : vraies vues moyennes et engagement sur les vues.
  if (row.tt?.link && row.tt.followers) {
    own.tiktok = { ...(own.tiktok ?? NO_AUD), followers: String(row.tt.followers), views: row.tt.avgViews ? String(row.tt.avgViews) : "", er: row.tt.er != null ? String(row.tt.er) : "", erBase: "views", src: row.tt.avgViews ? "tiktok" : "fiche" };
  }
  // YouTube connecté : vraies vues moyennes (vidéos longues pour les intégrations, Shorts à part).
  if (row.yt?.link && (row.yt.subscribers || row.yt.avgViews || row.yt.avgShortViews)) {
    const k = own.youtube ?? NO_AUD;
    const real = !!(row.yt.avgViews || row.yt.avgShortViews);
    own.youtube = {
      ...k, followers: row.yt.subscribers ? String(row.yt.subscribers) : k.followers,
      views: row.yt.avgViews ? String(row.yt.avgViews) : k.views, shortViews: row.yt.avgShortViews ? String(row.yt.avgShortViews) : "",
      er: row.yt.er != null ? String(row.yt.er) : k.er, erBase: "views", src: real ? "youtube" : k.src || "fiche",
    };
  }
  const fallback: Aud = { ...NO_AUD, followers: String(row.followers ?? ""), er: String(row.er ?? ""), src: "fiche", erBase: "views" };
  // Niche du créateur, sinon Lifestyle (×1).
  const n = (row.niche ?? "").toLowerCase().trim();
  const match = n ? NICHES.find((x) => x.label.toLowerCase().includes(n) || n.includes(x.value)) : undefined;
  return { own, fallback, main: asPlat(row.platform), niche: match?.value ?? "lifestyle" };
}

/** Page Tarifs : une audience pour chaque plateforme (celles sans chiffres propres reprennent la fiche). */
export function audienceForAll(a: CreatorAudience): Record<string, Aud> {
  const full: Record<string, Aud> = {};
  for (const p of INF_PLATFORMS) full[p.key] = a.own[p.key] ?? a.fallback;
  return full;
}
