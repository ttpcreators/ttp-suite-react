// ============================================================================
// yt-sourcing/index.ts : Sourcing YouTube (page Sourcing → Trouver des créatrices).
// ----------------------------------------------------------------------------
// Outil officiel de Google (YouTube Data API v3), clé YT_API_KEY (secret serveur).
//   { mode: "search", q, region? } → chaînes trouvées pour un thème (« fitness lyon »).
//   { mode: "brand", q, region? }  → chaînes qui ont fait des vidéos sur une marque.
//   { mode: "list", channels: [...] } → des @ ou liens de chaînes (30 max).
// Pour chaque chaîne (12 dernières vidéos) : abonnés, vues moyennes, engagement
// (likes + commentaires ÷ vues), vidéos par semaine, dernière vidéo, email et indice
// d'agence dans la description, marques des vidéos sponsorisées (liens et @ des
// descriptions). Gardé 7 jours dans yt_channels.
//
// Quota Google : 10 000 unités par jour (recherche = 100, le reste = 1 par lot de
// 50) ; compté dans yt_quota et renvoyé à l'app (quota).
// AUTH : verify_jwt = true + rôle agence vérifié dans profiles.
// ============================================================================

import { corsHeaders, getServiceClient } from "../_shared/google.ts";
import { tidySecret } from "../_shared/instagram.ts";
import { agencyHint, emailsIn, isPaid } from "../_shared/signals.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type Json = Record<string, unknown>;
const KEY = tidySecret(Deno.env.get("YT_API_KEY"));
const API = "https://www.googleapis.com/youtube/v3";
const DAY = 86400000;
const DAILY = 10_000;

let units = 0; // unités consommées par cet appel
let quotaHit = false;
async function yt(path: string, params: Record<string, string>, cost = 1): Promise<Json> {
  units += cost;
  const qs = new URLSearchParams({ ...params, key: KEY });
  try {
    const r = await fetch(`${API}/${path}?${qs}`, { signal: AbortSignal.timeout(15_000) });
    const body = (await r.json().catch(() => ({}))) as Json;
    const reason = ((body.error as Json | undefined)?.errors as Json[] | undefined)?.[0]?.reason;
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") quotaHit = true;
    return body;
  } catch {
    return { error: { message: "reseau" } };
  }
}

// ── Lecture d'une chaîne ─────────────────────────────────────────────────────
// Domaines qui ne sont pas une marque (réseaux, liens courts, outils).
const NOT_BRAND = /(^|\.)(youtube|youtu|instagram|tiktok|facebook|fb|twitter|x|threads|snapchat|pinterest|linkedin|twitch|discord|spotify|deezer|apple|google|goo|bit|tinyurl|linktr|beacons|linkin|lnk|campsite|bio|hoo|stan|patreon|paypal|tipeee|gofundme|wikipedia|gmail|outlook|t|wa|whatsapp|telegram|amzn|amazon-adsystem)\.[a-z.]+$/i;
/** Marques des vidéos sponsorisées : domaines des liens et @ cités dans la description. */
function brandsIn(desc: string): string[] {
  const out = new Set<string>();
  for (const m of desc.matchAll(/https?:\/\/(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) {
    const host = m[1].toLowerCase();
    if (NOT_BRAND.test(host)) continue;
    out.add(host.replace(/^(shop|store|fr|eu|uk|us|m|go|click|lien|links?)\./, ""));
  }
  for (const m of desc.matchAll(/(?:^|[\s(])@([A-Za-z0-9._-]{3,30})/g)) out.add(`@${m[1].replace(/\.+$/, "").toLowerCase()}`);
  return [...out].slice(0, 8);
}

type Video = { id: string; title: string; desc: string; at: string; views: number; likes: number; comments: number; paid: boolean };
type Channel = { id: string; data: Json };

/** Chiffres de plusieurs chaînes (ids), avec leurs 12 dernières vidéos. */
async function readChannels(ids: string[]): Promise<Channel[]> {
  const out: Channel[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const ch = await yt("channels", { part: "snippet,statistics,contentDetails,brandingSettings", id: ids.slice(i, i + 50).join(","), maxResults: "50" });
    for (const c of (ch.items as Json[] | undefined) ?? []) {
      const sn = (c.snippet ?? {}) as Json;
      const st = (c.statistics ?? {}) as Json;
      const uploads = String(((c.contentDetails as Json | undefined)?.relatedPlaylists as Json | undefined)?.uploads ?? "");
      // 12 dernières vidéos (1 unité), puis leurs chiffres (1 unité).
      let videos: Video[] = [];
      if (uploads) {
        const pl = await yt("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: "12" });
        const vids = ((pl.items as Json[] | undefined) ?? []).map((x) => String((x.contentDetails as Json | undefined)?.videoId ?? "")).filter(Boolean);
        if (vids.length) {
          let v = await yt("videos", { part: "snippet,statistics,paidProductPlacementDetails", id: vids.join(",") });
          if (v.error) v = await yt("videos", { part: "snippet,statistics", id: vids.join(",") });
          videos = ((v.items as Json[] | undefined) ?? []).map((x) => {
            const s = (x.snippet ?? {}) as Json;
            const t = (x.statistics ?? {}) as Json;
            const desc = String(s.description ?? "");
            const flagged = !!(x.paidProductPlacementDetails as Json | undefined)?.hasPaidProductPlacement;
            return {
              id: String(x.id ?? ""), title: String(s.title ?? ""), desc, at: String(s.publishedAt ?? ""),
              views: Number(t.viewCount ?? 0) || 0, likes: Number(t.likeCount ?? 0) || 0, comments: Number(t.commentCount ?? 0) || 0,
              paid: flagged || isPaid(`${s.title ?? ""} ${desc}`),
            };
          });
        }
      }
      const subs = st.hiddenSubscriberCount ? null : Number(st.subscriberCount ?? 0) || 0;
      const withViews = videos.filter((v) => v.views > 0);
      const avgViews = withViews.length ? Math.round(withViews.reduce((a, v) => a + v.views, 0) / withViews.length) : null;
      const er = withViews.length ? Math.round((withViews.reduce((a, v) => a + v.likes + v.comments, 0) / withViews.reduce((a, v) => a + v.views, 0)) * 10000) / 100 : null;
      const ts = videos.map((v) => Date.parse(v.at)).filter((t) => !Number.isNaN(t)).sort((a, b) => a - b);
      const weeks = ts.length >= 2 ? (ts[ts.length - 1] - ts[0]) / (7 * DAY) : 0;
      const perWeek = weeks > 0 ? Math.round(((ts.length - 1) / weeks) * 10) / 10 : null;
      const about = `${sn.description ?? ""} ${((c.brandingSettings as Json | undefined)?.channel as Json | undefined)?.description ?? ""}`;
      const email = emailsIn(about)[0] ?? "";
      const deals = [...new Set(videos.filter((v) => v.paid).flatMap((v) => brandsIn(v.desc)))].slice(0, 8);
      const handle = String(sn.customUrl ?? "").replace(/^@/, "");
      out.push({
        id: String(c.id ?? ""),
        data: {
          v: 1, platform: "youtube", name: String(sn.title ?? ""), handle, country: String(sn.country ?? ""),
          bio: String(sn.description ?? "").slice(0, 300), picture: String(((sn.thumbnails as Json | undefined)?.default as Json | undefined)?.url ?? ""),
          followers: subs, views: Number(st.viewCount ?? 0) || 0, videos: Number(st.videoCount ?? 0) || 0,
          avgViews, er, perWeek, lastPost: videos[0]?.at ?? null, email, emailFrom: email ? "bio" : "",
          agency: agencyHint(about, email), deals,
          sponsored: videos.filter((v) => v.paid).length, sample: videos.length,
          url: handle ? `https://www.youtube.com/@${handle}` : `https://www.youtube.com/channel/${c.id}`,
        },
      });
    }
  }
  return out;
}

/** Depuis le cache (7 j) quand c'est possible, sinon lu chez YouTube et gardé. */
async function channels(sb: SupabaseClient, ids: string[]): Promise<Channel[]> {
  const uniq = [...new Set(ids)].filter(Boolean);
  if (!uniq.length) return [];
  const { data } = await sb.from("yt_channels").select("id, data, at").in("id", uniq);
  const fresh = new Map(((data as { id: string; data: Json; at: string }[] | null) ?? [])
    .filter((r) => Date.now() - Date.parse(r.at) < 7 * DAY).map((r) => [r.id, r.data]));
  const todo = uniq.filter((id) => !fresh.has(id));
  const read = todo.length && !quotaHit ? await readChannels(todo) : [];
  if (read.length) await sb.from("yt_channels").upsert(read.map((c) => ({ id: c.id, data: c.data, at: new Date().toISOString() })));
  // Règle YouTube : rien de plus de 30 jours sans être relu (le cache n'en sert que 7).
  await sb.from("yt_channels").delete().lt("at", new Date(Date.now() - 30 * DAY).toISOString());
  const byId = new Map<string, Json>([...fresh, ...read.map((c) => [c.id, c.data] as [string, Json])]);
  return uniq.filter((id) => byId.has(id)).map((id) => ({ id, data: byId.get(id) as Json }));
}

/** « @lea », « youtube.com/@lea », « youtube.com/channel/UC… » → id de chaîne. */
async function resolve(input: string): Promise<string | null> {
  const s = input.trim();
  const id = /(UC[A-Za-z0-9_-]{22})/.exec(s)?.[1];
  if (id) return id;
  const h = /@([A-Za-z0-9._-]{3,30})/.exec(s)?.[1] ?? (/^[A-Za-z0-9._-]{3,30}$/.test(s) ? s : "");
  if (!h) return null;
  const r = await yt("channels", { part: "id", forHandle: `@${h}` });
  return String(((r.items as Json[] | undefined) ?? [])[0]?.id ?? "") || null;
}

async function saveQuota(sb: SupabaseClient) {
  const day = new Date().toISOString().slice(0, 10);
  const { data } = await sb.from("yt_quota").select("units").eq("day", day).maybeSingle<{ units: number }>();
  const total = (data?.units ?? 0) + units;
  await sb.from("yt_quota").upsert({ day, units: total });
  return { used: total, limit: DAILY, blocked: quotaHit };
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const res = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return res({ error: "methode" }, 405);

  const sb = getServiceClient();
  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  const { data: u } = bearer ? await sb.auth.getUser(bearer) : { data: null };
  if (!u?.user?.id) return res({ error: "non_autorise" }, 401);
  const { data: prof } = await sb.from("profiles").select("role").eq("user_id", u.user.id).maybeSingle<{ role: string }>();
  if (prof?.role !== "agency") return res({ error: "non_autorise" }, 403);
  if (!KEY) return res({ error: "youtube_non_configure" });
  const probe = await sb.from("yt_channels").select("id").limit(1);
  if (probe.error) return res({ error: "migration_manquante" });

  let body: { mode?: string; q?: string; region?: string; channels?: unknown } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return res({ error: "json" }, 400);
  }
  units = 0;
  quotaHit = false;
  const region = /^[A-Z]{2}$/.test(String(body.region ?? "")) ? String(body.region) : "FR";
  const q = String(body.q ?? "").trim().slice(0, 100);
  let ids: string[] = [];
  const counts = new Map<string, number>(); // « Depuis une marque » : nombre de vidéos sur la marque

  if (body.mode === "search" || body.mode === "brand") {
    if (!q) return res({ error: "recherche_vide" }, 400);
    const params: Record<string, string> = {
      part: "snippet", q, type: body.mode === "search" ? "channel" : "video", maxResults: "25", regionCode: region,
      relevanceLanguage: region === "FR" || region === "BE" || region === "CH" || region === "CA" ? "fr" : "en",
    };
    const s = await yt("search", params, 100);
    for (const it of (s.items as Json[] | undefined) ?? []) {
      const sn = (it.snippet ?? {}) as Json;
      const id = String(sn.channelId ?? (it.id as Json | undefined)?.channelId ?? "");
      if (!id) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    ids = [...counts.keys()];
  } else if (body.mode === "list") {
    const list = (Array.isArray(body.channels) ? body.channels : []).map((x) => String(x ?? "")).filter(Boolean).slice(0, 30);
    for (const x of list) {
      const id = await resolve(x);
      if (id) ids.push(id);
    }
  } else return res({ error: "mode" }, 400);

  const found = quotaHit ? [] : await channels(sb, ids);
  const quota = await saveQuota(sb);
  return res({
    candidates: found.map((c) => ({ username: String(c.data.handle || c.id), id: c.id, count: counts.get(c.id), data: c.data, why: null })),
    stopped: quotaHit ? "quota_youtube" : undefined,
    quota,
  });
});
