// ============================================================================
// _shared/tiktok.ts : TikTok Login Kit (API v2) pour les créatrices du roster.
// ----------------------------------------------------------------------------
// Une créatrice connecte SON TikTok (tt-connect → page d'accord TikTok →
// tt-callback). On lit ensuite, chaque jour (tt-sync), son profil et ses
// dernières vidéos publiques avec leurs chiffres.
//   Portées : user.info.basic (nom, photo), user.info.profile (@, bio, certifié),
//             user.info.stats (abonnés, j'aime, vidéos), video.list (vidéos).
//   Jeton d'accès : 24 h ; jeton de renouvellement : 365 j (renouvelé à chaque usage).
// Secrets : TT_CLIENT_KEY, TT_CLIENT_SECRET (app « TTP Creators » de l'organisation
// TTP Creators sur developers.tiktok.com ; clés du Sandbox pendant les essais),
// TT_REDIRECT_URI facultatif.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { tidySecret } from "./instagram.ts";

export const TT_CLIENT_KEY = tidySecret(Deno.env.get("TT_CLIENT_KEY"));
export const TT_CLIENT_SECRET = tidySecret(Deno.env.get("TT_CLIENT_SECRET"));
export const TT_REDIRECT_URI = tidySecret(Deno.env.get("TT_REDIRECT_URI")) || "https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/tt-callback";
export const TT_SCOPES = "user.info.basic,user.info.profile,user.info.stats,video.list";
export const ttReady = () => !!TT_CLIENT_KEY && !!TT_CLIENT_SECRET;

const API = "https://open.tiktokapis.com/v2";
const USER_FIELDS = "open_id,avatar_url,display_name,username,bio_description,profile_deep_link,is_verified,follower_count,following_count,likes_count,video_count";
const VIDEO_FIELDS = "id,title,video_description,create_time,cover_image_url,share_url,duration,view_count,like_count,comment_count,share_count";

export function ttAuthorizeUrl(state: string): string {
  const q = new URLSearchParams({ client_key: TT_CLIENT_KEY, scope: TT_SCOPES, response_type: "code", redirect_uri: TT_REDIRECT_URI, state });
  return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
}

export type TtTokens = { token: string; expiresIn: number; refresh: string; refreshExpiresIn: number; openId: string; scopes: string };

async function tokenCall(params: Record<string, string>): Promise<TtTokens | { error: string }> {
  try {
    const r = await fetch(`${API}/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: new URLSearchParams({ client_key: TT_CLIENT_KEY, client_secret: TT_CLIENT_SECRET, ...params }),
      signal: AbortSignal.timeout(15_000),
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok || b.error || !b.access_token) return { error: String(b.error_description || b.error || `http_${r.status}`) };
    return {
      token: String(b.access_token), expiresIn: Number(b.expires_in ?? 86400), refresh: String(b.refresh_token ?? ""),
      refreshExpiresIn: Number(b.refresh_expires_in ?? 0), openId: String(b.open_id ?? ""), scopes: String(b.scope ?? ""),
    };
  } catch {
    return { error: "reseau" };
  }
}

/** Code reçu sur tt-callback → jetons. */
export const ttExchangeCode = (code: string) => tokenCall({ code, grant_type: "authorization_code", redirect_uri: TT_REDIRECT_URI });

export type TtAccount = { creator_id: string; open_id: string; username: string | null; token: string; expires_at: string | null; refresh_token: string | null; refresh_expires_at: string | null; scopes: string | null };

/** Jeton valable (renouvelé s'il expire dans moins d'une heure) ; met `acc` à jour. null = à reconnecter. */
export async function ttFreshToken(sb: SupabaseClient, acc: TtAccount): Promise<string | null> {
  const left = acc.expires_at ? Date.parse(acc.expires_at) - Date.now() : 0;
  if (left > 3600_000) return acc.token;
  if (!acc.refresh_token) return null;
  const r = await tokenCall({ grant_type: "refresh_token", refresh_token: acc.refresh_token });
  if ("error" in r) return null;
  const now = Date.now();
  acc.token = r.token;
  acc.expires_at = new Date(now + r.expiresIn * 1000).toISOString();
  acc.refresh_token = r.refresh || acc.refresh_token;
  if (r.refreshExpiresIn) acc.refresh_expires_at = new Date(now + r.refreshExpiresIn * 1000).toISOString();
  if (r.scopes) acc.scopes = r.scopes;
  await sb.from("tt_accounts").update({
    token: acc.token, expires_at: acc.expires_at, refresh_token: acc.refresh_token, refresh_expires_at: acc.refresh_expires_at,
    scopes: acc.scopes, refreshed_at: new Date(now).toISOString(),
  }).eq("creator_id", acc.creator_id);
  return acc.token;
}

/** Retire l'accès chez TikTok (déconnexion). */
export async function ttRevoke(token: string): Promise<void> {
  try {
    await fetch(`${API}/oauth/revoke/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_key: TT_CLIENT_KEY, client_secret: TT_CLIENT_SECRET, token }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    /* sans gravité : le jeton est de toute façon effacé chez nous */
  }
}

type ApiErr = { code?: string; message?: string };
const failed = (b: Record<string, unknown>) => {
  const e = b.error as ApiErr | undefined;
  return e && e.code && e.code !== "ok" ? e.code : null;
};

export type TtUser = {
  openId: string; username: string; name: string; avatar: string; bio: string; url: string; verified: boolean;
  followers: number | null; following: number | null; likes: number | null; videos: number | null;
};
export async function ttUser(token: string): Promise<TtUser | { error: string }> {
  try {
    const r = await fetch(`${API}/user/info/?fields=${USER_FIELDS}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    const b = await r.json().catch(() => ({}));
    const err = failed(b);
    if (err || !r.ok) return { error: err ?? `http_${r.status}` };
    const u = ((b.data as { user?: Record<string, unknown> } | undefined)?.user ?? {}) as Record<string, unknown>;
    const n = (k: string) => (typeof u[k] === "number" ? (u[k] as number) : null);
    return {
      openId: String(u.open_id ?? ""), username: String(u.username ?? ""), name: String(u.display_name ?? ""),
      avatar: String(u.avatar_url ?? ""), bio: String(u.bio_description ?? "").slice(0, 300), url: String(u.profile_deep_link ?? ""),
      verified: u.is_verified === true, followers: n("follower_count"), following: n("following_count"), likes: n("likes_count"), videos: n("video_count"),
    };
  } catch {
    return { error: "reseau" };
  }
}

export type TtVideo = { id: string; url: string; cover: string; title: string; at: string; duration: number | null; views: number | null; likes: number | null; comments: number | null; shares: number | null };
/** Dernières vidéos publiques (20 max). */
export async function ttVideos(token: string, max = 20): Promise<TtVideo[] | { error: string }> {
  try {
    const r = await fetch(`${API}/video/list/?fields=${VIDEO_FIELDS}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ max_count: Math.min(20, max) }),
      signal: AbortSignal.timeout(20_000),
    });
    const b = await r.json().catch(() => ({}));
    const err = failed(b);
    if (err || !r.ok) return { error: err ?? `http_${r.status}` };
    const list = ((b.data as { videos?: Record<string, unknown>[] } | undefined)?.videos ?? []);
    const n = (v: Record<string, unknown>, k: string) => (typeof v[k] === "number" ? (v[k] as number) : null);
    return list.map((v) => ({
      id: String(v.id ?? ""), url: String(v.share_url ?? ""), cover: String(v.cover_image_url ?? ""),
      title: String(v.video_description || v.title || "").slice(0, 500),
      at: v.create_time ? new Date(Number(v.create_time) * 1000).toISOString() : "",
      duration: n(v, "duration"), views: n(v, "view_count"), likes: n(v, "like_count"), comments: n(v, "comment_count"), shares: n(v, "share_count"),
    }));
  } catch {
    return { error: "reseau" };
  }
}

/** Chiffres utiles sur des vidéos : vues et j'aime moyens, engagement (sur les vues), rythme. */
export function ttStats(videos: TtVideo[]) {
  const withViews = videos.filter((v) => v.views != null && v.views > 0);
  const sum = (k: "views" | "likes" | "comments" | "shares") => withViews.reduce((s, v) => s + (v[k] ?? 0), 0);
  const views = sum("views");
  const avgViews = withViews.length ? Math.round(views / withViews.length) : null;
  const avgLikes = withViews.length ? Math.round(sum("likes") / withViews.length) : null;
  const er = views > 0 ? Math.round(((sum("likes") + sum("comments") + sum("shares")) / views) * 10000) / 100 : null;
  const ts = videos.map((v) => Date.parse(v.at)).filter((t) => !Number.isNaN(t)).sort((a, b) => a - b);
  const weeks = ts.length >= 2 ? (ts[ts.length - 1] - ts[0]) / (7 * 86400000) : 0;
  const perWeek = weeks > 0 ? Math.round(((ts.length - 1) / weeks) * 10) / 10 : null;
  return { avgViews, avgLikes, er, perWeek };
}
