// ============================================================================
// _shared/youtube-login.ts : « Connecter mon YouTube » pour les créatrices du roster.
// ----------------------------------------------------------------------------
// Une créatrice connecte SA chaîne (yt-connect → page d'accord Google →
// app.ttpcreators.pro/yt-callback/ → yt-callback). On lit ensuite, chaque jour
// (yt-sync), sa chaîne, ses dernières vidéos et ses statistiques YouTube Studio
// (YouTube Analytics : vues 30 j, temps de visionnage, abonnés gagnés, audience).
//   Portées (lecture seule) : youtube.readonly, yt-analytics.readonly.
//   Jeton d'accès : 1 h ; jeton de renouvellement : sans limite une fois l'app
//   Google publiée (7 jours tant qu'elle est « en test »).
// Secrets : YT_CLIENT_ID, YT_CLIENT_SECRET (client OAuth « Application Web » du
// projet Google Cloud dédié aux créatrices), YT_REDIRECT_URI facultatif.
// Le retour passe par une page de l'app (public/yt-callback/) : Google exige, pour
// valider l'app, des adresses de retour sur un domaine qui nous appartient.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { tidySecret } from "./instagram.ts";

export const YT_CLIENT_ID = tidySecret(Deno.env.get("YT_CLIENT_ID"));
export const YT_CLIENT_SECRET = tidySecret(Deno.env.get("YT_CLIENT_SECRET"));
export const YT_REDIRECT_URI = tidySecret(Deno.env.get("YT_REDIRECT_URI")) || "https://app.ttpcreators.pro/yt-callback/";
export const YT_SCOPES = "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly";
export const ytLoginReady = () => !!YT_CLIENT_ID && !!YT_CLIENT_SECRET;

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DATA = "https://www.googleapis.com/youtube/v3";
const ANALYTICS = "https://youtubeanalytics.googleapis.com/v2/reports";
type Json = Record<string, unknown>;

export function ytAuthorizeUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: YT_CLIENT_ID, redirect_uri: YT_REDIRECT_URI, response_type: "code", scope: YT_SCOPES,
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export type YtTokens = { token: string; expiresIn: number; refresh: string; scopes: string };

async function tokenCall(params: Record<string, string>): Promise<YtTokens | { error: string }> {
  try {
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: YT_CLIENT_ID, client_secret: YT_CLIENT_SECRET, ...params }),
      signal: AbortSignal.timeout(15_000),
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok || !b.access_token) return { error: String(b.error || `http_${r.status}`) };
    return { token: String(b.access_token), expiresIn: Number(b.expires_in ?? 3600), refresh: String(b.refresh_token ?? ""), scopes: String(b.scope ?? "") };
  } catch {
    return { error: "reseau" };
  }
}

/** Code reçu sur yt-callback → jetons. */
export const ytExchangeCode = (code: string) => tokenCall({ code, grant_type: "authorization_code", redirect_uri: YT_REDIRECT_URI });

export type YtAccount = { creator_id: string; channel_id: string; title: string | null; token: string | null; expires_at: string | null; refresh_token: string; scopes: string | null };

/** Jeton valable (renouvelé s'il expire dans moins de 5 min) ; met `acc` à jour. { error } = à reconnecter ou à réessayer. */
export async function ytFreshToken(sb: SupabaseClient, acc: YtAccount): Promise<string | { error: string }> {
  const left = acc.expires_at ? Date.parse(acc.expires_at) - Date.now() : 0;
  if (acc.token && left > 300_000) return acc.token;
  const r = await tokenCall({ grant_type: "refresh_token", refresh_token: acc.refresh_token });
  if ("error" in r) return { error: r.error === "reseau" ? "reseau" : "jeton" }; // invalid_grant : accès retiré ou expiré
  const now = Date.now();
  acc.token = r.token;
  acc.expires_at = new Date(now + r.expiresIn * 1000).toISOString();
  if (r.scopes) acc.scopes = r.scopes;
  await sb.from("yt_accounts").update({ token: acc.token, expires_at: acc.expires_at, scopes: acc.scopes, refreshed_at: new Date(now).toISOString() }).eq("creator_id", acc.creator_id);
  return acc.token;
}

/** Retire l'accès chez Google (déconnexion). Le jeton de renouvellement suffit à tout couper. */
export async function ytRevoke(token: string): Promise<void> {
  try {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    /* sans gravité : le jeton est de toute façon effacé chez nous */
  }
}

/** Appel authentifié ; { error } lisible (jeton, portee, quota, api_off, reseau, http_…). */
async function call(url: string, token: string): Promise<Json | { error: string }> {
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    const b = (await r.json().catch(() => ({}))) as Json;
    if (r.ok) return b;
    const e = (b.error ?? {}) as Json;
    const reason = String(((e.errors as Json[] | undefined)?.[0]?.reason) ?? (e.status ?? ""));
    if (r.status === 401) return { error: "jeton" };
    if (/quota|rateLimit/i.test(reason)) return { error: "quota" };
    if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason) || /has not been used|is disabled/i.test(String(e.message ?? ""))) return { error: "api_off" };
    if (r.status === 403 && /insufficient|scope|PERMISSION_DENIED|forbidden/i.test(`${reason} ${e.message ?? ""}`)) return { error: "portee" };
    return { error: `http_${r.status}` };
  } catch {
    return { error: "reseau" };
  }
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

export type YtChannel = {
  id: string; title: string; handle: string; avatar: string; url: string; country: string | null;
  subscribers: number | null; hiddenSubs: boolean; views: number | null; videos: number | null; uploads: string;
};
/** La chaîne de la personne connectée (la chaîne choisie sur la page Google). */
export async function ytMyChannel(token: string): Promise<YtChannel | { error: string }> {
  const b = await call(`${DATA}/channels?part=snippet,statistics,contentDetails&mine=true`, token);
  if ("error" in b && typeof b.error === "string") return { error: b.error };
  const c = ((b as Json).items as Json[] | undefined)?.[0];
  if (!c) return { error: "pas_de_chaine" };
  const sn = (c.snippet ?? {}) as Json;
  const st = (c.statistics ?? {}) as Json;
  const th = (sn.thumbnails ?? {}) as Record<string, { url?: string }>;
  const handle = String(sn.customUrl ?? "").replace(/^@/, "");
  return {
    id: String(c.id ?? ""), title: String(sn.title ?? ""), handle,
    avatar: th.medium?.url ?? th.default?.url ?? "",
    url: handle ? `https://www.youtube.com/@${handle}` : `https://www.youtube.com/channel/${c.id}`,
    country: sn.country ? String(sn.country) : null,
    subscribers: st.hiddenSubscriberCount ? null : num(st.subscriberCount), hiddenSubs: st.hiddenSubscriberCount === true,
    views: num(st.viewCount), videos: num(st.videoCount),
    uploads: String(((c.contentDetails as Json | undefined)?.relatedPlaylists as Json | undefined)?.uploads ?? ""),
  };
}

/** « PT1H2M10S » → secondes. */
export function isoSeconds(d: string): number | null {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d ?? "");
  if (!m) return null;
  return (Number(m[1] ?? 0) * 86400) + (Number(m[2] ?? 0) * 3600) + (Number(m[3] ?? 0) * 60) + Number(m[4] ?? 0);
}

export type YtVideo = { id: string; url: string; cover: string; title: string; at: string; seconds: number | null; short: boolean; paid: boolean; views: number | null; likes: number | null; comments: number | null; text: string };
/** Dernières vidéos de la chaîne (25 max), avec leurs chiffres. Shorts = 3 min et moins. */
export async function ytMyVideos(token: string, uploads: string, max = 25): Promise<YtVideo[] | { error: string }> {
  if (!uploads) return [];
  const pl = await call(`${DATA}/playlistItems?part=contentDetails&maxResults=${Math.min(50, max)}&playlistId=${encodeURIComponent(uploads)}`, token);
  if ("error" in pl && typeof pl.error === "string") return pl.error === "http_404" ? [] : { error: pl.error };
  const ids = (((pl as Json).items as Json[] | undefined) ?? []).map((i) => String((i.contentDetails as Json | undefined)?.videoId ?? "")).filter(Boolean);
  if (!ids.length) return [];
  const vb = await call(`${DATA}/videos?part=snippet,statistics,contentDetails,paidProductPlacementDetails&id=${ids.join(",")}`, token);
  if ("error" in vb && typeof vb.error === "string") return { error: vb.error };
  const list = (((vb as Json).items as Json[] | undefined) ?? []).map((v) => {
    const sn = (v.snippet ?? {}) as Json;
    const st = (v.statistics ?? {}) as Json;
    const th = (sn.thumbnails ?? {}) as Record<string, { url?: string }>;
    const seconds = isoSeconds(String((v.contentDetails as Json | undefined)?.duration ?? ""));
    const short = seconds != null && seconds > 0 && seconds <= 180;
    const id = String(v.id ?? "");
    return {
      id, url: short ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`,
      cover: th.medium?.url ?? th.default?.url ?? "", title: String(sn.title ?? "").slice(0, 200),
      at: String(sn.publishedAt ?? ""), seconds, short,
      paid: ((v.paidProductPlacementDetails as Json | undefined)?.hasPaidProductPlacement) === true, // « Inclut une communication commerciale »
      views: num(st.viewCount), likes: num(st.likeCount), comments: num(st.commentCount),
      text: `${sn.title ?? ""}\n${sn.description ?? ""}`.slice(0, 3000),
    };
  });
  return list.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Chiffres utiles des dernières vidéos : vues moyennes (vidéos longues et Shorts à part),
 * engagement (j'aime + commentaires ÷ vues), rythme. Les vidéos de moins de 7 jours ne
 * comptent pas dans les moyennes (leurs vues montent encore), sauf s'il n'y a qu'elles.
 */
export function ytStats(videos: YtVideo[], now = Date.now()) {
  const settled = (list: YtVideo[]) => {
    const old = list.filter((v) => now - Date.parse(v.at) >= 7 * 86400000);
    return (old.length ? old : list).filter((v) => v.views != null).slice(0, 12);
  };
  const avg = (list: YtVideo[]) => (list.length ? Math.round(list.reduce((s, v) => s + (v.views ?? 0), 0) / list.length) : null);
  const longs = settled(videos.filter((v) => !v.short));
  const shorts = settled(videos.filter((v) => v.short));
  const pool = [...longs, ...shorts];
  const views = pool.reduce((s, v) => s + (v.views ?? 0), 0);
  const inter = pool.reduce((s, v) => s + (v.likes ?? 0) + (v.comments ?? 0), 0);
  const er = views > 0 ? Math.round((inter / views) * 10000) / 100 : null;
  const ts = videos.map((v) => Date.parse(v.at)).filter((t) => !Number.isNaN(t)).sort((a, b) => a - b);
  const weeks = ts.length >= 2 ? (ts[ts.length - 1] - ts[0]) / (7 * 86400000) : 0;
  const perWeek = weeks > 0 ? Math.round(((ts.length - 1) / weeks) * 10) / 10 : null;
  return { avgViews: avg(longs), avgShortViews: avg(shorts), er, perWeek, longCount: longs.length, shortCount: shorts.length };
}

// ── YouTube Analytics (statistiques de YouTube Studio) ───────────────────────

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

async function report(token: string, params: Record<string, string>): Promise<{ cols: string[]; rows: unknown[][] } | { error: string }> {
  const b = await call(`${ANALYTICS}?${new URLSearchParams({ ids: "channel==MINE", ...params })}`, token);
  if ("error" in b && typeof b.error === "string") return { error: b.error };
  const cols = (((b as Json).columnHeaders as Json[] | undefined) ?? []).map((h) => String(h.name ?? ""));
  return { cols, rows: (((b as Json).rows as unknown[][] | undefined) ?? []) };
}

export type YtAnalytics = {
  from: string; to: string;
  views: number | null; minutes: number | null; avgDuration: number | null; avgPct: number | null;
  subsGained: number | null; subsLost: number | null; likes: number | null; comments: number | null; shares: number | null;
  byType?: Record<string, number>; // vues par type de contenu (vidéos, Shorts, lives)
};
export type YtAudience = { age: { k: string; pct: number }[]; gender: { female: number; male: number; other: number } | null; countries: { k: string; pct: number }[] };

/**
 * 30 derniers jours (YouTube a ~2 jours de retard : fenêtre J-32 → J-3) : vues, temps
 * de visionnage, durée moyenne, abonnés gagnés / perdus, j'aime, commentaires, partages,
 * vues par type de contenu ; audience (âge × sexe, pays) sur 90 jours.
 */
export async function ytAnalytics(token: string, now = Date.now()): Promise<{ a30: YtAnalytics; audience: YtAudience } | { error: string }> {
  const from = day(now - 32 * 86400000);
  const to = day(now - 3 * 86400000);
  const from90 = day(now - 92 * 86400000);
  const [main, types, demo, geo, tot90] = await Promise.all([
    report(token, { startDate: from, endDate: to, metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments,shares" }),
    report(token, { startDate: from, endDate: to, metrics: "views", dimensions: "creatorContentType" }),
    report(token, { startDate: from90, endDate: to, metrics: "viewerPercentage", dimensions: "ageGroup,gender" }),
    report(token, { startDate: from90, endDate: to, metrics: "views", dimensions: "country", sort: "-views", maxResults: "10" }),
    report(token, { startDate: from90, endDate: to, metrics: "views" }),
  ]);
  if ("error" in main) return { error: main.error };
  const row = main.rows[0] ?? [];
  const pick = (k: string) => num(row[main.cols.indexOf(k)]);
  const a30: YtAnalytics = {
    from, to, views: pick("views"), minutes: pick("estimatedMinutesWatched"), avgDuration: pick("averageViewDuration"),
    avgPct: pick("averageViewPercentage"), subsGained: pick("subscribersGained"), subsLost: pick("subscribersLost"),
    likes: pick("likes"), comments: pick("comments"), shares: pick("shares"),
  };
  if (!("error" in types) && types.rows.length) {
    a30.byType = Object.fromEntries(types.rows.map((r) => [String(r[0]), num(r[1]) ?? 0]));
  }
  const audience: YtAudience = { age: [], gender: null, countries: [] };
  if (!("error" in demo) && demo.rows.length) {
    const ages = new Map<string, number>();
    const g = { female: 0, male: 0, other: 0 };
    for (const [age, gender, pct] of demo.rows as [string, string, number][]) {
      const k = String(age).replace(/^age/, "");
      ages.set(k, (ages.get(k) ?? 0) + Number(pct || 0));
      if (gender === "female") g.female += Number(pct || 0);
      else if (gender === "male") g.male += Number(pct || 0);
      else g.other += Number(pct || 0);
    }
    const r1 = (n: number) => Math.round(n * 10) / 10;
    audience.age = [...ages.entries()].map(([k, pct]) => ({ k, pct: r1(pct) })).sort((a, b) => a.k.localeCompare(b.k));
    audience.gender = { female: r1(g.female), male: r1(g.male), other: r1(g.other) };
  }
  if (!("error" in geo) && geo.rows.length) {
    // Part des vues de chaque pays sur TOUTES les vues des 90 jours (pas seulement le top 10).
    const all = "error" in tot90 ? null : num(tot90.rows[0]?.[0]);
    const total = all || geo.rows.reduce((s, r) => s + (num(r[1]) ?? 0), 0);
    if (total > 0) audience.countries = geo.rows.map((r) => ({ k: String(r[0]), pct: Math.round(((num(r[1]) ?? 0) / total) * 1000) / 10 }));
  }
  return { a30, audience };
}
