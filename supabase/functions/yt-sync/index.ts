// ============================================================================
// yt-sync/index.ts : chiffres YouTube des créatrices connectées, chaque jour.
// ----------------------------------------------------------------------------
// Pour chaque créatrice qui a connecté sa chaîne (yt_accounts) :
//   1. chaîne : abonnés, vues et vidéos cumulées, relevé quotidien des abonnés ;
//   2. 25 dernières vidéos : vues, j'aime, commentaires → vues moyennes (vidéos
//      longues et Shorts à part), engagement (sur les vues), rythme ;
//   3. YouTube Analytics (ses stats YouTube Studio) : vues et temps de visionnage
//      des 30 derniers jours, abonnés gagnés, durée moyenne regardée, vues par type
//      de contenu ; audience 90 j (âge × sexe, pays)
//   → creators.yt (+ creators.followers si YouTube est son réseau principal, + ligne
//      YouTube du media kit : abonnés, vues 30 j, vues moyennes, heures, abonnés gagnés) ;
//   4. collabs (étape 4 et plus) : vidéos publiées depuis le début de la collab qui
//      citent la marque (titre ou description) → collabs.yt (avec leurs vues).
// Accès retiré chez Google (ou expiré) : tout ce qui vient de sa chaîne est effacé (ytForget).
// Entrée (POST JSON) : {} = toutes (cron quotidien) ; { scope: "creator", id } =
// une créatrice (bouton « Actualiser », ou juste après la connexion) → { yt }.
// AUTH : verify_jwt = false (config.toml) ; Bearer CRON_SECRET (cron) OU JWT agence.
// ============================================================================

import { CRON_SECRET, corsHeaders, getServiceClient, timingSafeEqualStr } from "../_shared/google.ts";
import { igUser } from "../_shared/instagram.ts";
import { brandMatcher, norm } from "../_shared/brandmatch.ts";
import { brandKey, domainLabel } from "../_shared/youtube.ts";
import { ytAnalytics, ytForget, ytFreshToken, ytLoginReady, ytMyChannel, ytMyVideos, ytStats, type YtAccount, type YtVideo } from "../_shared/youtube-login.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type Json = Record<string, unknown>;
type CreatorRow = { id: string; name: string; platform: string | null; mediakit: Json | null; yt: Json | null };
type CollabRow = { id: string; brand: string; creator: string | null; step: number; created_at: string };

const today = () => new Date().toISOString().slice(0, 10);
const fmtInt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

function pushDay(hist: unknown, n: number): { d: string; f: number }[] {
  const d = today();
  const list = Array.isArray(hist) ? (hist as { d?: string; f?: number }[]).filter((x) => x?.d && x.d !== d) : [];
  return [...(list as { d: string; f: number }[]), { d, f: n }].slice(-400);
}

/** Ligne YouTube du media kit (si elle existe) : abonnés, vues 30 j, vues moyennes, heures, abonnés gagnés. */
function updateKit(mk: Json, yt: Json): Json | null {
  if (!Array.isArray(mk.platforms)) return null;
  const platforms = [...(mk.platforms as Json[])];
  const i = platforms.findIndex((p) => p?.key === "youtube");
  if (i === -1) return null;
  const block: Json = { ...platforms[i] };
  const a = (yt.a30 ?? {}) as Json;
  const set = (k: string, v: unknown) => {
    if (typeof v === "number" && v > 0) block[k] = String(Math.round(v));
  };
  set("followers", yt.subscribers);
  set("avgViews", yt.avgViews ?? yt.avgShortViews);
  set("views30j", a.views);
  if (typeof a.minutes === "number") set("watchHours", a.minutes / 60);
  if (typeof a.subsGained === "number") set("newViewers30j", a.subsGained - (typeof a.subsLost === "number" ? a.subsLost : 0));
  platforms[i] = block;
  const next = { ...mk, platforms };
  return JSON.stringify(next) === JSON.stringify(mk) ? null : next;
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

/** Matcher de tt-sync + liens de la description (« fr.gymshark.com/… » → Gymshark). */
function videoMatcher(brand: string, handles: string[]): (text: string) => boolean {
  const base = brandMatcher(brand, handles);
  const key = brandKey(brand);
  return (text: string) => {
    if (base(text)) return true;
    if (key.length < 3) return false;
    for (const m of text.matchAll(/https?:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) if (brandKey(domainLabel(m[1])) === key) return true;
    return false;
  };
}

const lite = (v: YtVideo) => ({ id: v.id, url: v.url, cover: v.cover, title: v.title, at: v.at, short: v.short, paid: v.paid, views: v.views, likes: v.likes, comments: v.comments });

async function syncCreator(sb: SupabaseClient, acc: YtAccount, brandHandles: Map<string, string[]>): Promise<Json | null> {
  const { data: c } = await sb.from("creators").select("id, name, platform, mediakit, yt").eq("id", acc.creator_id).maybeSingle<CreatorRow>();
  if (!c) return null;
  const prev = (c.yt ?? {}) as Json;
  const now = new Date().toISOString();
  const patch: Json = {};
  let next: Json;
  let videos: YtVideo[] = [];
  const token = await ytFreshToken(sb, acc);
  if (typeof token !== "string" && token.error === "jeton") {
    // Accès retiré par la créatrice chez Google (ou expiré) : ses données YouTube sont effacées.
    await ytForget(sb, c.id, "jeton");
    return { link: null, why: "jeton", at: now };
  }
  if (typeof token !== "string") next = { ...prev, at: now, why: token.error };
  else {
    const ch = await ytMyChannel(token);
    if ("error" in ch) next = { ...prev, at: now, why: ch.error };
    else {
      const [v, an] = await Promise.all([ytMyVideos(token, ch.uploads, 25), ytAnalytics(token)]);
      videos = "error" in v ? [] : v;
      const why = "error" in v ? v.error : "error" in an ? an.error : null;
      next = {
        ...prev, at: now, ok: now, why,
        channelId: ch.id, title: ch.title, handle: ch.handle, avatar: ch.avatar, url: ch.url, country: ch.country,
        subscribers: ch.subscribers, hiddenSubs: ch.hiddenSubs, views: ch.views, videos: ch.videos,
        history: ch.subscribers != null ? pushDay(prev.history, ch.subscribers) : prev.history ?? [],
        recent: videos.slice(0, 12).map(lite), ...ytStats(videos), lastPost: videos[0]?.at ?? null,
        ...("error" in an ? {} : { a30: an.a30, audience: an.audience }),
      };
      if ((c.platform ?? "").toLowerCase().includes("youtube") && ch.subscribers) patch.followers = fmtInt(ch.subscribers);
      if (ch.title !== acc.title) await sb.from("yt_accounts").update({ title: ch.title }).eq("creator_id", acc.creator_id);
    }
  }
  if (c.mediakit && typeof c.mediakit === "object") {
    const kit = updateKit(c.mediakit, next);
    if (kit) patch.mediakit = kit;
  }
  patch.yt = next;
  const { error } = await sb.from("creators").update(patch).eq("id", c.id);
  if (error) console.error("yt-sync creators", c.name, error.message);

  // Collabs de la créatrice (étape 4 et plus) : ses vidéos qui citent la marque.
  if (videos.length) {
    const { data: cols } = await sb.from("collabs").select("id, brand, creator, step, created_at").ilike("creator", c.name).gte("step", 4);
    for (const col of (cols as CollabRow[] | null) ?? []) {
      const match = videoMatcher(col.brand, brandHandles.get(norm(col.brand).trim()) ?? []);
      const since = Date.parse(col.created_at) - 2 * 86400000;
      const posts = videos.filter((x) => Date.parse(x.at) >= since && match(x.text)).map(lite);
      const { error: e2 } = await sb.from("collabs").update({ yt: { at: now, posts } }).eq("id", col.id);
      if (e2) break; // colonne collabs.yt absente (SQL pas encore lancé) : on n'insiste pas
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
  if (!ytLoginReady()) return res({ error: "youtube_non_configure" });
  const probe = await sb.from("yt_accounts").select("creator_id").limit(1);
  if (probe.error) return res({ error: "migration_manquante" });

  // @ Instagram des marques (souvent le même sur YouTube) pour reconnaître leurs mentions.
  const { data: ct } = await sb.from("contacts").select("brand, instagram").not("instagram", "is", null);
  const brandHandles = new Map<string, string[]>();
  for (const x of (ct as { brand: string; instagram: string | null }[] | null) ?? []) {
    const h = igUser(x.instagram);
    if (!h || !x.brand) continue;
    const k = norm(x.brand).trim();
    brandHandles.set(k, [...(brandHandles.get(k) ?? []), h]);
  }

  let q = sb.from("yt_accounts").select("creator_id, channel_id, title, token, expires_at, refresh_token, scopes");
  if (body.scope === "creator" && body.id) q = q.eq("creator_id", body.id);
  const { data: accs } = await q;
  const list = (accs as YtAccount[] | null) ?? [];
  if (body.scope === "creator") {
    if (!list.length) return res({ error: "non_connecte" });
    return res({ yt: await syncCreator(sb, list[0], brandHandles) });
  }
  const t0 = Date.now();
  let done = 0;
  for (const acc of list) {
    if (Date.now() - t0 > 110_000) break;
    try {
      await syncCreator(sb, acc, brandHandles);
      done++;
    } catch (e) {
      console.error("yt-sync", acc.creator_id, e);
    }
  }
  console.log("yt-sync", JSON.stringify({ creators: done, of: list.length, ms: Date.now() - t0 }));
  return res({ ok: true, creators: done });
});
