// ============================================================================
// _shared/instagram-login.ts : statistiques PRIVÉES d'une créatrice, avec SON
// accord (« Instagram API with Instagram Login »). Elle connecte son compte
// Instagram pro une fois depuis l'app ; on garde un jeton de 60 jours, prolongé
// tout seul par ig-sync. Donne ce que business discovery ne donne pas : couverture,
// vues, audience (âge, genre, villes, pays) et stats de chaque post.
//
// Secrets : IG_APP_ID + IG_APP_SECRET (Meta → app → Instagram → « Configuration
// de l'API avec connexion Instagram »), IG_REDIRECT_URI (= URL de ig-callback).
// Jetons rangés dans la table ig_accounts (aucune lecture possible depuis l'app).
// Avant la validation de Meta (App Review), seuls les comptes ajoutés comme
// « testeurs Instagram » de l'app peuvent se connecter.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getJson, GRAPH_VERSION, tidySecret } from "./instagram.ts";

const IG_APP_ID = tidySecret(Deno.env.get("IG_APP_ID"));
const IG_APP_SECRET = tidySecret(Deno.env.get("IG_APP_SECRET"));
export const IG_REDIRECT_URI = tidySecret(Deno.env.get("IG_REDIRECT_URI"));
const IG_GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`;
export const SCOPES = "instagram_business_basic,instagram_business_manage_insights";
export const loginReady = () => !!IG_APP_ID && !!IG_APP_SECRET && !!IG_REDIRECT_URI;

export type IgAccount = { creator_id: string; ig_user_id: string; username: string | null; token: string; expires_at: string | null; refreshed_at: string | null };

export function authorizeUrl(state: string): string {
  const u = new URL("https://www.instagram.com/oauth/authorize");
  u.searchParams.set("client_id", IG_APP_ID);
  u.searchParams.set("redirect_uri", IG_REDIRECT_URI);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("enable_fb_login", "0");
  u.searchParams.set("state", state);
  return u.toString();
}

/** code → jeton longue durée (60 j) + id et nom du compte. */
export async function exchangeCode(code: string): Promise<{ token: string; expiresIn: number; userId: string; username: string } | { error: string }> {
  const form = new URLSearchParams({ client_id: IG_APP_ID, client_secret: IG_APP_SECRET, grant_type: "authorization_code", redirect_uri: IG_REDIRECT_URI, code });
  let short: Record<string, unknown> = {};
  try {
    const r = await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", body: form, signal: AbortSignal.timeout(15_000) });
    short = await r.json().catch(() => ({}));
  } catch {
    return { error: "reseau" };
  }
  // Meta renvoie soit { access_token, user_id }, soit { data: [{ … }] }.
  const s = (Array.isArray(short.data) ? short.data[0] : short) as Record<string, unknown> | undefined;
  const shortToken = String(s?.access_token ?? "");
  if (!shortToken) return { error: String((short.error_message ?? (short.error as { message?: string })?.message) || "code_refuse") };
  const long = await getJson(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(IG_APP_SECRET)}&access_token=${encodeURIComponent(shortToken)}`);
  const token = String(long.access_token ?? "");
  if (!token) return { error: "jeton_long_refuse" };
  const me = await getJson(`${IG_GRAPH}/me?fields=user_id,username,account_type&access_token=${encodeURIComponent(token)}`);
  const userId = String(me.user_id ?? s?.user_id ?? "");
  if (!userId) return { error: "profil_illisible" };
  return { token, expiresIn: Number(long.expires_in ?? 5184000) || 5184000, userId, username: String(me.username ?? "") };
}

/** Prolonge le jeton s'il expire dans moins de 20 jours (et a plus de 24 h). */
export async function freshToken(sb: SupabaseClient, acc: IgAccount): Promise<string> {
  const exp = acc.expires_at ? Date.parse(acc.expires_at) : 0;
  const last = Date.parse(acc.refreshed_at ?? "") || 0;
  if (exp && exp - Date.now() > 20 * 86400000) return acc.token;
  if (Date.now() - last < 86400000) return acc.token;
  const r = await getJson(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(acc.token)}`);
  const token = String(r.access_token ?? "");
  if (!token) return acc.token;
  const expires_at = new Date(Date.now() + (Number(r.expires_in ?? 5184000) || 5184000) * 1000).toISOString();
  const refreshed_at = new Date().toISOString();
  await sb.from("ig_accounts").update({ token, expires_at, refreshed_at }).eq("creator_id", acc.creator_id);
  Object.assign(acc, { token, expires_at, refreshed_at }); // pas de 2e prolongation dans le même passage
  return token;
}

type Val = { name?: string; total_value?: { value?: number; breakdowns?: { results?: { dimension_values?: string[]; value?: number }[] }[] }; values?: { value?: number }[] };
const valueOf = (v: Val | undefined) => v?.total_value?.value ?? v?.values?.reduce((s, x) => s + (x.value ?? 0), 0) ?? null;

/** Totaux des 28 derniers jours (couverture, vues, interactions, comptes engagés). */
type Totals = { reach: number | null; views: number | null; interactions: number | null; engaged: number | null };
export async function accountTotals(token: string, igId: string): Promise<Totals | { error: string }> {
  const until = Math.floor(Date.now() / 1000);
  const since = until - 28 * 86400;
  const r = await getJson(
    `${IG_GRAPH}/${igId}/insights?metric=reach,views,total_interactions,accounts_engaged&period=day&metric_type=total_value&since=${since}&until=${until}&access_token=${encodeURIComponent(token)}`,
  );
  if (r.error) return { error: String((r.error as { message?: string }).message ?? "insights") };
  const by = new Map(((r.data as Val[] | undefined) ?? []).map((v) => [v.name, v]));
  return { reach: valueOf(by.get("reach")), views: valueOf(by.get("views")), interactions: valueOf(by.get("total_interactions")), engaged: valueOf(by.get("accounts_engaged")) };
}

export type Split = { label: string; pct: number }[];
/** Audience des abonnés (âge, genre, villes, pays), en % ; null si < 100 abonnés. */
export async function audience(token: string, igId: string): Promise<{ age: Split; gender: Split; city: Split; country: Split } | null> {
  const one = async (breakdown: string): Promise<Split> => {
    const r = await getJson(
      `${IG_GRAPH}/${igId}/insights?metric=follower_demographics&period=lifetime&timeframe=this_month&metric_type=total_value&breakdown=${breakdown}&access_token=${encodeURIComponent(token)}`,
    );
    const results = ((r.data as Val[] | undefined) ?? [])[0]?.total_value?.breakdowns?.[0]?.results ?? [];
    const total = results.reduce((s, x) => s + (x.value ?? 0), 0);
    if (!total) return [];
    return results
      .map((x) => ({ label: String(x.dimension_values?.[0] ?? ""), pct: Math.round(((x.value ?? 0) / total) * 1000) / 10 }))
      .filter((x) => x.label)
      .sort((a, b) => b.pct - a.pct);
  };
  const [age, gender, city, country] = await Promise.all([one("age"), one("gender"), one("city"), one("country")]);
  if (!age.length && !gender.length && !city.length && !country.length) return null;
  return { age, gender, city, country };
}

/** Stats privées d'un post (couverture, enregistrements, partages, vues). */
export async function postInsights(token: string, mediaId: string): Promise<{ reach?: number; saves?: number; shares?: number; views?: number } | null> {
  const ask = (metrics: string) => getJson(`${IG_GRAPH}/${mediaId}/insights?metric=${metrics}&access_token=${encodeURIComponent(token)}`);
  // Toutes les mesures n'existent pas pour tous les formats : on retente plus court.
  let r = await ask("reach,saved,shares,views");
  if (r.error) r = await ask("reach,saved,shares");
  if (r.error) return null;
  const by = new Map(((r.data as Val[] | undefined) ?? []).map((v) => [v.name, valueOf(v)]));
  const n = (k: string) => (typeof by.get(k) === "number" ? (by.get(k) as number) : undefined);
  return { reach: n("reach"), saves: n("saved"), shares: n("shares"), views: n("views") };
}

/**
 * Vues et couverture moyennes de ses derniers reels (8 max, 9 demandes) : la vraie
 * base du prix d'un reel (calculateur de prix, ligne Instagram du media kit).
 */
export async function recentReels(token: string, igId: string): Promise<{ reelViews: number | null; reelReach: number | null; reels: number } | null> {
  const list = await getJson(`${IG_GRAPH}/${igId}/media?fields=id,media_product_type,timestamp&limit=20&access_token=${encodeURIComponent(token)}`);
  if (list.error) return null;
  const reels = ((list.data as { id?: string; media_product_type?: string }[] | undefined) ?? [])
    .filter((m) => m.id && m.media_product_type === "REELS").slice(0, 8);
  const stats = (await Promise.all(reels.map((m) => postInsights(token, String(m.id))))).filter((x): x is NonNullable<typeof x> => !!x);
  const avg = (k: "views" | "reach") => {
    const v = stats.map((x) => x[k]).filter((n): n is number => typeof n === "number" && n > 0);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  return { reelViews: avg("views"), reelReach: avg("reach"), reels: stats.length };
}
