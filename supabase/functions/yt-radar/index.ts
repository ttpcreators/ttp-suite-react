// ============================================================================
// yt-radar/index.ts : Radar à collabs YouTube (vidéos sponsorisées).
// ----------------------------------------------------------------------------
// Outil officiel de Google (YouTube Data API v3, clé YT_API_KEY). Chaque jour :
//   1. dernières vidéos (12) des chaînes du roster (plateforme YouTube) et du
//      Scouting (liens youtube.com) ;
//   2. découverte « hors agence » : recherches de vidéos récentes en France
//      (« code promo », « partenariat », « sponsorisé »…), seulement si le quota du
//      jour le permet (on garde de la marge pour le Sourcing de l'agence).
// Sponsorisée = case « communication commerciale » cochée sur YouTube
// (paidProductPlacementDetails) OU description qui le dit (#ad, code promo…).
// Marques : _shared/youtube.ts brandsInVideo → yt_radar (une ligne par marque).
// Entrées : {} (cron) ; { discover: false } (bouton « Lancer le radar », sans
// recherches si besoin d'économiser le quota).
// AUTH : verify_jwt = false (config.toml) ; Bearer CRON_SECRET (cron) OU JWT agence.
// ============================================================================

import { CRON_SECRET, corsHeaders, getServiceClient, timingSafeEqualStr } from "../_shared/google.ts";
import { saveState } from "../_shared/instagram.ts";
import { isPaid } from "../_shared/signals.ts";
import { brandsInVideo, YT_KEY, yt, ytSaveQuota, ytUsage, ytUsedToday } from "../_shared/youtube.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type Json = Record<string, unknown>;
type Src = "roster" | "scouting" | "hors";
type Post = { v: string; url: string; at: string; title: string; thumb: string; views: number | null; likes: number | null; flag: boolean; ch: string; c: string; h: string; subs: number | null; src: Src; fr?: boolean; seen?: string };
// Règle YouTube (Developer Policies) : une donnée de l'API non relue depuis 30 jours est effacée.
const KEEP_DAYS = 30;
type Info = { subs: number | null; handle: string; uploads: string; country: string };

const QUERIES = ["code promo", "partenariat rémunéré", "sponsorisé", "collaboration commerciale", "lien affilié réduction", "en partenariat avec"];
// Hors agence : on ne garde que les chaînes francophones (langue de la vidéo) ou basées
// en France, Belgique, Suisse, Luxembourg ou Monaco (YouTube renvoie aussi de l'étranger).
const FR_COUNTRIES = new Set(["FR", "BE", "CH", "LU", "MC"]);
const DISCOVERY_IF_UNDER = 6000; // unités déjà utilisées aujourd'hui au-delà desquelles on ne cherche plus
const BUDGET_MS = 110_000;

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

/** « @lea », « youtube.com/@lea », « youtube.com/channel/UC… » → id ou @. */
function parseChannel(raw: string): { id?: string; handle?: string } | null {
  const s = raw.trim();
  const id = /(UC[A-Za-z0-9_-]{22})/.exec(s)?.[1];
  if (id) return { id };
  const h = /@([A-Za-z0-9._-]{3,30})/.exec(s)?.[1] ?? (/^[A-Za-z0-9._-]{3,30}$/.test(s) ? s : "");
  return h ? { handle: h.toLowerCase() } : null;
}

/** Chiffres de vidéos (50 par appel, 1 unité) → posts sponsorisés avec leurs marques. */
async function sponsoredPosts(ids: string[], src: (channelId: string) => Src, subsOf: Map<string, Info>) {
  const out: { post: Post; brands: { key: string; name: string }[] }[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await yt("videos", { part: "snippet,statistics,paidProductPlacementDetails", id: ids.slice(i, i + 50).join(",") });
    for (const x of (r.items as Json[] | undefined) ?? []) {
      const s = (x.snippet ?? {}) as Json;
      const t = (x.statistics ?? {}) as Json;
      const text = `${s.title ?? ""}\n${s.description ?? ""}`;
      const flag = !!(x.paidProductPlacementDetails as Json | undefined)?.hasPaidProductPlacement;
      if (!flag && !isPaid(text)) continue;
      const brands = brandsInVideo(text);
      if (!brands.length) continue;
      const ch = String(s.channelId ?? "");
      const info = subsOf.get(ch);
      const where = src(ch);
      const lang = String(s.defaultAudioLanguage ?? s.defaultLanguage ?? "").toLowerCase();
      const fr = lang.startsWith("fr") || FR_COUNTRIES.has(info?.country ?? "");
      if (where === "hors" && !fr) continue;
      const thumbs = (s.thumbnails ?? {}) as Record<string, { url?: string }>;
      out.push({
        brands,
        post: {
          v: String(x.id ?? ""), url: `https://www.youtube.com/watch?v=${x.id}`, at: String(s.publishedAt ?? ""), title: String(s.title ?? "").slice(0, 200),
          thumb: thumbs.medium?.url ?? thumbs.default?.url ?? "", views: t.viewCount != null ? Number(t.viewCount) : null,
          likes: t.likeCount != null ? Number(t.likeCount) : null, flag, ch, c: String(s.channelTitle ?? ""), h: info?.handle ?? "",
          subs: info?.subs ?? null, src: where, fr,
        },
      });
    }
  }
  return out;
}

/** Abonnés et @ de chaînes (50 par appel, 1 unité). */
async function channelInfo(ids: string[], into: Map<string, Info>) {
  const todo = [...new Set(ids)].filter((id) => id && !into.has(id));
  for (let i = 0; i < todo.length; i += 50) {
    const r = await yt("channels", { part: "snippet,statistics,contentDetails", id: todo.slice(i, i + 50).join(","), maxResults: "50" });
    for (const c of (r.items as Json[] | undefined) ?? []) {
      const st = (c.statistics ?? {}) as Json;
      into.set(String(c.id), {
        subs: st.hiddenSubscriberCount ? null : Number(st.subscriberCount ?? 0) || 0,
        handle: String(((c.snippet ?? {}) as Json).customUrl ?? "").replace(/^@/, ""),
        uploads: String((((c.contentDetails ?? {}) as Json).relatedPlaylists as Json | undefined)?.uploads ?? ""),
        country: String(((c.snippet ?? {}) as Json).country ?? "").toUpperCase(),
      });
    }
  }
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const res = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return res({ error: "methode" }, 405);

  const sb = getServiceClient();
  if (!(await caller(req, sb))) return res({ error: "non_autorise" }, 401);
  let body: { discover?: boolean } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    body = {};
  }
  const probe = await sb.from("yt_radar").select("brand").limit(1);
  if (probe.error) return res({ error: "migration_manquante" });
  if (!YT_KEY) return res({ error: "youtube_non_configure" });
  ytUsage.reset();
  const t0 = Date.now();

  // 1. Chaînes du roster et du Scouting.
  const [cr, pl] = await Promise.all([sb.from("creators").select("handle, platform, status"), sb.from("creator_pool").select("handle")]);
  const mine: { ref: { id?: string; handle?: string }; src: Src }[] = [];
  for (const c of (cr.data as { handle: string | null; platform: string | null; status: string | null }[] | null) ?? []) {
    if (!(c.platform ?? "").toLowerCase().includes("youtube") || (c.status ?? "actif").toLowerCase() === "inactif") continue;
    const ref = parseChannel(c.handle ?? "");
    if (ref) mine.push({ ref, src: "roster" });
  }
  for (const p of (pl.data as { handle: string | null }[] | null) ?? []) {
    if (!/youtube\.com|youtu\.be/i.test(p.handle ?? "")) continue;
    const ref = parseChannel(p.handle ?? "");
    if (ref) mine.push({ ref, src: "scouting" });
  }
  // @ → id : depuis le cache du Sourcing YouTube (yt_channels), sinon 1 unité par @.
  const handles = mine.filter((m) => m.ref.handle).map((m) => m.ref.handle as string);
  const cached = new Map<string, string>();
  if (handles.length) {
    const { data } = await sb.from("yt_channels").select("id, data").limit(2000);
    for (const r of (data as { id: string; data: Json }[] | null) ?? []) {
      const h = String(r.data?.handle ?? "").toLowerCase();
      if (h) cached.set(h, r.id);
    }
  }
  const srcOf = new Map<string, Src>();
  for (const m of mine) {
    let id = m.ref.id ?? (m.ref.handle ? cached.get(m.ref.handle) : undefined);
    if (!id && m.ref.handle && Date.now() - t0 < BUDGET_MS / 3) {
      const r = await yt("channels", { part: "id", forHandle: `@${m.ref.handle}` });
      id = String(((r.items as Json[] | undefined) ?? [])[0]?.id ?? "") || undefined;
    }
    if (id && (!srcOf.has(id) || m.src === "roster")) srcOf.set(id, m.src);
  }
  const info = new Map<string, Info>();
  await channelInfo([...srcOf.keys()], info);
  const videoIds: string[] = [];
  for (const id of srcOf.keys()) {
    if (Date.now() - t0 > BUDGET_MS / 2) break;
    const up = info.get(id)?.uploads;
    if (!up) continue;
    const r = await yt("playlistItems", { part: "contentDetails", playlistId: up, maxResults: "12" });
    for (const x of (r.items as Json[] | undefined) ?? []) {
      const v = String(((x.contentDetails ?? {}) as Json).videoId ?? "");
      if (v) videoIds.push(v);
    }
  }
  const found = await sponsoredPosts(videoIds, (ch) => srcOf.get(ch) ?? "hors", info);

  // 2. Découverte hors agence (si le quota du jour le permet).
  let searched = 0;
  const usedBefore = await ytUsedToday(sb);
  if (body.discover !== false && usedBefore + ytUsage.units < DISCOVERY_IF_UNDER && !ytUsage.quotaHit) {
    const after = new Date(Date.now() - 7 * 86400000).toISOString();
    const disc = new Set<string>();
    for (const q of QUERIES) {
      if (Date.now() - t0 > BUDGET_MS * 0.75 || ytUsage.quotaHit) break;
      const r = await yt("search", { part: "snippet", q, type: "video", regionCode: "FR", relevanceLanguage: "fr", publishedAfter: after, order: "date", maxResults: "25" }, 100);
      searched++;
      for (const x of (r.items as Json[] | undefined) ?? []) {
        const v = String(((x.id ?? {}) as Json).videoId ?? "");
        if (v && !videoIds.includes(v)) disc.add(v);
      }
    }
    if (disc.size) {
      // Chaînes de ces vidéos (pour les abonnés), puis les vidéos elles-mêmes.
      const chans: string[] = [];
      const ids = [...disc];
      for (let i = 0; i < ids.length; i += 50) {
        const first = await yt("videos", { part: "snippet", id: ids.slice(i, i + 50).join(",") });
        chans.push(...((first.items as Json[] | undefined) ?? []).map((x) => String(((x.snippet ?? {}) as Json).channelId ?? "")));
      }
      await channelInfo(chans, info);
      found.push(...(await sponsoredPosts([...disc], (ch) => srcOf.get(ch) ?? "hors", info)));
    }
  }

  // 3. Une ligne par marque ; vidéos fusionnées (40 dernières), statut gardé.
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
  const byBrand = new Map<string, { name: string; posts: Post[] }>();
  for (const f of found) {
    for (const b of f.brands) {
      const e = byBrand.get(b.key) ?? { name: b.name, posts: [] };
      if (!e.posts.some((p) => p.v === f.post.v)) e.posts.push({ ...f.post, seen: now });
      byBrand.set(b.key, e);
    }
  }
  // On retire les vidéos non relues depuis 30 jours (règle YouTube) et celles des chaînes
  // étrangères gardées avant le filtre France ; les marques « à traiter » restées vides partent.
  const keep = (p: Post, rowSeen: string | null) => (p.src !== "hors" || p.fr === true) && (p.seen ?? rowSeen ?? "") >= cutoff;
  const { data: oldRows } = await sb.from("yt_radar").select("brand, name, posts, status, last_seen");
  for (const r of (oldRows as { brand: string; name: string; posts: Post[]; status: string; last_seen: string | null }[] | null) ?? []) {
    // (vidéos d'avant ce champ : datées du dernier passage de leur marque, une fois pour toutes)
    const kept = (r.posts ?? []).filter((p) => keep(p, r.last_seen)).map((p) => (p.seen ? p : { ...p, seen: r.last_seen ?? now }));
    if (kept.length === (r.posts ?? []).length && (r.posts ?? []).every((p) => p.seen)) continue;
    if (!kept.length && r.status === "nouveau" && !byBrand.has(r.brand)) await sb.from("yt_radar").delete().eq("brand", r.brand);
    else await sb.from("yt_radar").update({ posts: kept }).eq("brand", r.brand);
  }
  const keys = [...byBrand.keys()];
  const existing = new Map<string, { name: string; posts: Post[]; last_seen: string | null }>();
  for (let i = 0; i < keys.length; i += 200) {
    const { data } = await sb.from("yt_radar").select("brand, name, posts, last_seen").in("brand", keys.slice(i, i + 200));
    for (const r of (data as { brand: string; name: string; posts: Post[]; last_seen: string | null }[] | null) ?? []) existing.set(r.brand, r);
  }
  const rows = keys.map((k) => {
    const cur = existing.get(k);
    const map = new Map<string, Post>();
    const old = (cur?.posts ?? []).filter((x) => keep(x, cur?.last_seen ?? null)).map((x) => (x.seen ? x : { ...x, seen: cur?.last_seen ?? now }));
    for (const p of [...old, ...(byBrand.get(k)?.posts ?? [])]) map.set(p.v, p);
    const posts = [...map.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
    const name = (byBrand.get(k)?.name ?? "").startsWith("@") && cur?.name ? cur.name : byBrand.get(k)?.name ?? cur?.name ?? k;
    return { brand: k, name, posts, last_seen: now };
  });
  for (let i = 0; i < rows.length; i += 200) await sb.from("yt_radar").upsert(rows.slice(i, i + 200));

  const quota = await ytSaveQuota(sb);
  const out = { ok: true, channels: srcOf.size, videos: videoIds.length, searched, sponsored: found.length, brands: rows.length, quota, ms: Date.now() - t0 };
  await saveState(sb, "yt_radar", out);
  console.log("yt-radar", JSON.stringify(out));
  return res(out);
});
