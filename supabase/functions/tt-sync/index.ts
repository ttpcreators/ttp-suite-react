// ============================================================================
// tt-sync/index.ts : chiffres TikTok des créatrices connectées, chaque jour.
// ----------------------------------------------------------------------------
// Pour chaque créatrice qui a connecté son TikTok (tt_accounts) :
//   1. profil : abonnés, abonnements, j'aime cumulés, nombre de vidéos, relevé
//      quotidien des abonnés → creators.tt (+ creators.followers si TikTok est son
//      réseau principal, + ligne TikTok du media kit : abonnés, j'aime cumulés, vues
//      et j'aime moyens par vidéo) ;
//   2. 20 dernières vidéos : vues, j'aime, commentaires, partages → vues moyennes,
//      engagement (sur les vues), rythme, 12 dernières vidéos gardées ;
//   3. collabs (étape 4 et plus) : vidéos publiées depuis le début de la collab qui
//      citent la marque (@, # ou nom) → collabs.tt (avec leurs vues).
// Entrée (POST JSON) : {} = toutes (cron quotidien) ; { scope: "creator", id } =
// une créatrice (bouton « Actualiser », ou juste après la connexion) → { tt }.
// AUTH : verify_jwt = false (config.toml) ; Bearer CRON_SECRET (cron) OU JWT agence.
// ============================================================================

import { CRON_SECRET, corsHeaders, getServiceClient, timingSafeEqualStr } from "../_shared/google.ts";
import { igUser } from "../_shared/instagram.ts";
import { ttFreshToken, ttReady, ttStats, ttUser, ttVideos, type TtAccount, type TtVideo } from "../_shared/tiktok.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type Json = Record<string, unknown>;
type CreatorRow = { id: string; name: string; platform: string | null; mediakit: Json | null; tt: Json | null };
type CollabRow = { id: string; brand: string; creator: string | null; step: number; created_at: string; tt: Json | null };

const today = () => new Date().toISOString().slice(0, 10);
const fmtInt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function pushDay(hist: unknown, n: number): { d: string; f: number }[] {
  const d = today();
  const list = Array.isArray(hist) ? (hist as { d?: string; f?: number }[]).filter((x) => x?.d && x.d !== d) : [];
  return [...(list as { d: string; f: number }[]), { d, f: n }].slice(-400);
}

/** Raison lisible d'une erreur TikTok. */
function whyOf(code: string): string {
  if (/token|auth/i.test(code)) return "jeton";
  if (/scope/i.test(code)) return "portee";
  if (/rate|limit/i.test(code)) return "limite";
  if (code === "reseau") return "reseau";
  return `tiktok_${code}`;
}

/** Ligne TikTok du media kit (si elle existe) : abonnés, j'aime cumulés, moyennes par vidéo. */
function updateKit(mk: Json, tt: Json): Json | null {
  if (!Array.isArray(mk.platforms)) return null;
  const platforms = [...(mk.platforms as Json[])];
  const i = platforms.findIndex((p) => p?.key === "tiktok");
  if (i === -1) return null;
  const block: Json = { ...platforms[i] };
  if (typeof tt.followers === "number" && tt.followers > 0) block.followers = String(tt.followers);
  if (typeof tt.likes === "number" && tt.likes > 0) block.likesTotal = String(tt.likes);
  if (typeof tt.avgViews === "number" && tt.avgViews > 0) block.avgViews = String(tt.avgViews);
  if (typeof tt.avgLikes === "number" && tt.avgLikes > 0) block.avgLikes = String(tt.avgLikes);
  platforms[i] = block;
  const next = { ...mk, platforms };
  return JSON.stringify(next) === JSON.stringify(mk) ? null : next;
}

/** La vidéo cite-t-elle la marque ? (@ ou # du compte de la marque, ou son nom). */
function brandMatcher(brand: string, handles: string[]): (text: string) => boolean {
  const words = new Set<string>();
  for (const h of handles) {
    words.add(h.toLowerCase());
    words.add(h.toLowerCase().replace(/[._]/g, ""));
  }
  const flat = norm(brand).replace(/[^a-z0-9]/g, "");
  if (flat.length >= 3) words.add(flat);
  const spaced = norm(brand).trim();
  return (text: string) => {
    const t = ` ${norm(text)} `;
    for (const w of words) {
      const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(^|[^a-z0-9._])[@#]?${esc}([^a-z0-9_]|$)`).test(t)) return true;
    }
    return spaced.length >= 4 && spaced.includes(" ") && t.includes(spaced);
  };
}

async function caller(req: Request, sb: SupabaseClient): Promise<"cron" | "agency" | null> {
  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  if (!bearer) return null;
  if (CRON_SECRET && timingSafeEqualStr(bearer, CRON_SECRET)) return "cron";
  const { data, error } = await sb.auth.getUser(bearer);
  if (error || !data?.user) return null;
  const { data: prof } = await sb.from("profiles").select("role").eq("user_id", data.user.id).maybeSingle<{ role: string }>();
  return prof?.role === "agency" ? "agency" : null;
}

async function syncCreator(sb: SupabaseClient, acc: TtAccount, brandHandles: Map<string, string[]>): Promise<Json | null> {
  const { data: c } = await sb.from("creators").select("id, name, platform, mediakit, tt").eq("id", acc.creator_id).maybeSingle<CreatorRow>();
  if (!c) return null;
  const prev = (c.tt ?? {}) as Json;
  const now = new Date().toISOString();
  const patch: Json = {};
  let next: Json;
  let videos: TtVideo[] = [];
  const token = await ttFreshToken(sb, acc);
  if (!token) next = { ...prev, at: now, why: "jeton" };
  else {
    const [u, v] = await Promise.all([ttUser(token), ttVideos(token, 20)]);
    if ("error" in u) next = { ...prev, at: now, why: whyOf(u.error) };
    else {
      videos = "error" in v ? [] : v;
      const recent = videos.slice(0, 12);
      next = {
        ...prev, at: now, ok: now, why: "error" in v ? whyOf(v.error) : null,
        username: u.username || acc.username, name: u.name, avatar: u.avatar, bio: u.bio, url: u.url, verified: u.verified,
        followers: u.followers, following: u.following, likes: u.likes, videos: u.videos,
        history: u.followers != null ? pushDay(prev.history, u.followers) : prev.history ?? [],
        recent, ...ttStats(recent), lastPost: videos[0]?.at ?? null,
      };
      if ((c.platform ?? "").toLowerCase().includes("tiktok") && u.followers) patch.followers = fmtInt(u.followers);
      if (u.username && u.username !== acc.username) await sb.from("tt_accounts").update({ username: u.username }).eq("creator_id", acc.creator_id);
    }
  }
  if (c.mediakit && typeof c.mediakit === "object") {
    const kit = updateKit(c.mediakit, next);
    if (kit) patch.mediakit = kit;
  }
  patch.tt = next;
  const { error } = await sb.from("creators").update(patch).eq("id", c.id);
  if (error) console.error("tt-sync creators", c.name, error.message);

  // Collabs de la créatrice (étape 4 et plus) : ses vidéos qui citent la marque.
  if (videos.length) {
    const { data: cols } = await sb.from("collabs").select("id, brand, creator, step, created_at, tt").ilike("creator", c.name).gte("step", 4);
    for (const col of (cols as CollabRow[] | null) ?? []) {
      const match = brandMatcher(col.brand, brandHandles.get(norm(col.brand).trim()) ?? []);
      const since = Date.parse(col.created_at) - 2 * 86400000;
      const posts = videos.filter((x) => Date.parse(x.at) >= since && match(x.title))
        .map((x) => ({ id: x.id, url: x.url, at: x.at, cover: x.cover, views: x.views, likes: x.likes, comments: x.comments, shares: x.shares }));
      await sb.from("collabs").update({ tt: { at: now, posts } }).eq("id", col.id);
    }
  }
  return next;
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const res = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return res({ error: "methode" }, 405);

  const sb = getServiceClient();
  if (!(await caller(req, sb))) return res({ error: "non_autorise" }, 401);
  let body: { scope?: string; id?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    body = {};
  }
  if (!ttReady()) return res({ error: "tiktok_non_configure" });
  const probe = await sb.from("tt_accounts").select("creator_id").limit(1);
  if (probe.error) return res({ error: "migration_manquante" });

  // @ Instagram des marques (souvent le même sur TikTok) pour reconnaître leurs mentions.
  const { data: ct } = await sb.from("contacts").select("brand, instagram").not("instagram", "is", null);
  const brandHandles = new Map<string, string[]>();
  for (const x of (ct as { brand: string; instagram: string | null }[] | null) ?? []) {
    const h = igUser(x.instagram);
    if (!h || !x.brand) continue;
    const k = norm(x.brand).trim();
    brandHandles.set(k, [...(brandHandles.get(k) ?? []), h]);
  }

  let q = sb.from("tt_accounts").select("creator_id, open_id, username, token, expires_at, refresh_token, refresh_expires_at, scopes");
  if (body.scope === "creator" && body.id) q = q.eq("creator_id", body.id);
  const { data: accs } = await q;
  const list = (accs as TtAccount[] | null) ?? [];
  if (body.scope === "creator") {
    if (!list.length) return res({ error: "non_connecte" });
    return res({ tt: await syncCreator(sb, list[0], brandHandles) });
  }
  const t0 = Date.now();
  let done = 0;
  for (const acc of list) {
    if (Date.now() - t0 > 110_000) break;
    try {
      await syncCreator(sb, acc, brandHandles);
      done++;
    } catch (e) {
      console.error("tt-sync", acc.creator_id, e);
    }
  }
  console.log("tt-sync", JSON.stringify({ creators: done, of: list.length, ms: Date.now() - t0 }));
  return res({ ok: true, creators: done });
});
