// ============================================================================
// _shared/instagram.ts : lecture des comptes Instagram PRO via l'outil officiel
// de Meta (« business discovery » de l'API Graph), au nom du compte pro de
// l'agence. Sert à ig-avatar (Scouting), ig-sync (roster, marques, livrables)
// et ig-hashtag (recherche par hashtag).
//
// Secrets : META_TOKEN (jeton de l'utilisateur système « scoutingapi », sans
// expiration), META_IG_ID (compte Instagram pro de l'agence), META_GRAPH_VERSION
// facultatif. Les comptes PERSONNELS ne sont pas visibles par cet outil.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Collés à la main dans le Terminal : on enlève espaces et guillemets éventuels.
export const tidySecret = (v: string | undefined) => (v ?? "").trim().replace(/^["']+|["',]+$/g, "").trim();
export const META_TOKEN = tidySecret(Deno.env.get("META_TOKEN"));
export const META_IG_ID = tidySecret(Deno.env.get("META_IG_ID"));
export const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v26.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
export const metaReady = () => !!META_TOKEN && !!META_IG_ID;

const USERNAME = /^[A-Za-z0-9._]{1,30}$/;
/** « @lea.fit », « instagram.com/lea.fit/ » → « lea.fit » (ou "" si invalide). */
export function igUser(handle: string | null | undefined): string {
  const u = (handle ?? "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "");
  return USERNAME.test(u) ? u : "";
}

export type IgPost = {
  id: string;
  caption: string;
  likes: number | null; // null = likes masqués par le compte
  comments: number;
  at: string; // ISO
  type: string; // IMAGE | VIDEO | CAROUSEL_ALBUM
  product: string; // FEED | REELS | …
  url: string; // lien public du post
};
export type IgProfile = {
  username: string;
  name: string;
  bio: string;
  website: string;
  picture: string;
  followers: number;
  following: number;
  posts: number;
  media: IgPost[];
};
export type IgResult = { ok: true; profile: IgProfile } | { ok: false; why: string; stop?: boolean };

type GraphError = { code?: number; error_subcode?: number; message?: string };
/** Erreur Meta → raison lisible ; stop = inutile de continuer (jeton, limite). */
export function graphWhy(e: GraphError): { why: string; stop?: boolean } {
  if (e.code === 190) return { why: "meta_jeton", stop: true };
  if (e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613) return { why: "meta_limite", stop: true };
  if (e.code === 110 || e.error_subcode === 2207013 || /Invalid user id|cannot be found/i.test(e.message ?? "")) return { why: "compte_perso" };
  if (e.code === 10 || e.code === 200) return { why: "meta_autorisation", stop: true };
  return { why: `meta_${e.code ?? "erreur"}` };
}

// ── Compteur de demandes à Meta ──────────────────────────────────────────────
// Meta renvoie à chaque réponse la part de son quota déjà utilisée (en %), et en
// cas de blocage le temps estimé avant de pouvoir redemander. On le note pour
// l'afficher dans l'app (table ig_quota, via saveUsage en fin de fonction).
type Usage = { calls: number; appPct: number | null; bucPct: number | null; regainMin: number | null; limited: boolean };
const usage: Usage = { calls: 0, appPct: null, bucPct: null, regainMin: null, limited: false };
const pctOf = (o: Record<string, unknown> | undefined) =>
  o ? Math.max(Number(o.call_count ?? 0), Number(o.total_time ?? 0), Number(o.total_cputime ?? 0)) : null;
function readUsage(h: Headers) {
  try {
    const app = h.get("x-app-usage");
    if (app) usage.appPct = pctOf(JSON.parse(app));
    const buc = h.get("x-business-use-case-usage");
    if (buc) {
      const all = Object.values(JSON.parse(buc) as Record<string, Record<string, unknown>[]>).flat();
      if (all.length) {
        usage.bucPct = Math.max(...all.map((x) => pctOf(x) ?? 0));
        const wait = Math.max(...all.map((x) => Number(x.estimated_time_to_regain_access ?? 0)));
        usage.regainMin = wait > 0 ? wait : null;
      }
    }
  } catch {
    /* en-tête illisible : on garde l'ancien relevé */
  }
}

/** GET JSON avec délai max (Meta peut traîner) ; erreur réseau → { error }. */
export async function getJson(url: string, ms = 15_000): Promise<Record<string, unknown>> {
  try {
    usage.calls++;
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    readUsage(r.headers);
    const body = await r.json().catch(() => ({ error: { message: `http_${r.status}` } }));
    const code = (body as { error?: { code?: number } }).error?.code;
    if (code === 4 || code === 17 || code === 32 || code === 613) usage.limited = true;
    return body;
  } catch {
    return { error: { message: "reseau" } };
  }
}

/**
 * Enregistre le relevé du quota dans ig_quota (une seule ligne) : demandes de
 * l'heure et du jour (fenêtres glissantes simples), % utilisé, heure de reprise.
 * Renvoie le relevé pour l'inclure dans la réponse à l'app.
 */
export async function saveUsage(sb: SupabaseClient): Promise<Record<string, unknown> | null> {
  if (!usage.calls) return null;
  try {
    const { data: cur } = await sb.from("ig_quota").select("data").eq("id", 1).maybeSingle<{ data: Record<string, unknown> }>();
    const prev = cur?.data ?? {};
    const now = Date.now();
    const iso = new Date(now).toISOString();
    const keep = (start: unknown, ms: number) => typeof start === "string" && now - Date.parse(start) < ms;
    const hourStart = keep(prev.hourStart, 3600000) ? (prev.hourStart as string) : iso;
    const dayStart = keep(prev.dayStart, 86400000) ? (prev.dayStart as string) : iso;
    const prevBlocked = typeof prev.blockedUntil === "string" && Date.parse(prev.blockedUntil) > now ? prev.blockedUntil : null;
    const data = {
      hourStart, hourCalls: (hourStart === prev.hourStart ? Number(prev.hourCalls ?? 0) : 0) + usage.calls,
      dayStart, dayCalls: (dayStart === prev.dayStart ? Number(prev.dayCalls ?? 0) : 0) + usage.calls,
      appPct: usage.appPct ?? prev.appPct ?? null,
      bucPct: usage.bucPct ?? prev.bucPct ?? null,
      // Bloqué : heure de reprise donnée par Meta, sinon 1 h par prudence.
      blockedUntil: usage.regainMin ? new Date(now + usage.regainMin * 60000).toISOString()
        : usage.limited ? new Date(now + 3600000).toISOString() : prevBlocked,
      lastAt: iso,
    };
    usage.calls = 0;
    usage.limited = false;
    await sb.from("ig_quota").upsert({ id: 1, data, at: iso });
    return data;
  } catch {
    return null;
  }
}

const POST_FIELDS = "id,caption,like_count,comments_count,timestamp,media_type,media_product_type,permalink";
export function toPost(m: Record<string, unknown>): IgPost {
  return {
    id: String(m.id ?? ""),
    caption: String(m.caption ?? ""),
    likes: typeof m.like_count === "number" ? m.like_count : null,
    comments: typeof m.comments_count === "number" ? m.comments_count : 0,
    at: String(m.timestamp ?? ""),
    type: String(m.media_type ?? ""),
    product: String(m.media_product_type ?? ""),
    url: String(m.permalink ?? ""),
  };
}

/** Profil + derniers posts d'un compte pro (mediaLimit = 0 : profil seul). */
export async function discover(handle: string, mediaLimit = 12): Promise<IgResult> {
  if (!metaReady()) return { ok: false, why: "meta_non_configure", stop: true };
  const user = igUser(handle);
  if (!user) return { ok: false, why: "nom_invalide" };
  const media = mediaLimit > 0 ? `,media.limit(${mediaLimit}){${POST_FIELDS}}` : "";
  const fields = `business_discovery.username(${user}){username,name,biography,website,profile_picture_url,followers_count,follows_count,media_count${media}}`;
  const body = await getJson(`${GRAPH}/${META_IG_ID}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(META_TOKEN)}`);
  if (body.error) {
    const e = body.error as GraphError;
    return e.message === "reseau" ? { ok: false, why: "reseau" } : { ok: false, ...graphWhy(e) };
  }
  const bd = body.business_discovery as Record<string, unknown> | undefined;
  if (!bd) return { ok: false, why: "sans_reponse" };
  const list = ((bd.media as { data?: Record<string, unknown>[] } | undefined)?.data ?? []).map(toPost);
  return {
    ok: true,
    profile: {
      username: String(bd.username ?? user),
      name: String(bd.name ?? ""),
      bio: String(bd.biography ?? ""),
      website: String(bd.website ?? ""),
      picture: String(bd.profile_picture_url ?? ""),
      followers: Number(bd.followers_count ?? 0) || 0,
      following: Number(bd.follows_count ?? 0) || 0,
      posts: Number(bd.media_count ?? 0) || 0,
      media: list,
    },
  };
}

/**
 * Engagement public moyen (likes + commentaires) / abonnés, en %, sur les posts
 * donnés ; les posts aux likes masqués sont ignorés. null si rien à mesurer.
 */
export function engagementRate(media: IgPost[], followers: number): number | null {
  const counted = media.filter((m) => m.likes !== null);
  if (!counted.length || followers <= 0) return null;
  const avg = counted.reduce((s, m) => s + (m.likes ?? 0) + m.comments, 0) / counted.length;
  return Math.round((avg / followers) * 10000) / 100; // 2 décimales
}

/** Posts par semaine sur la période couverte par les posts donnés. */
export function postsPerWeek(media: IgPost[]): number | null {
  const ts = media.map((m) => Date.parse(m.at)).filter((t) => !Number.isNaN(t)).sort((a, b) => a - b);
  if (ts.length < 2) return null;
  const weeks = (ts[ts.length - 1] - ts[0]) / (7 * 86400000);
  return weeks > 0 ? Math.round(((ts.length - 1) / weeks) * 10) / 10 : null;
}

/** Copie la photo de profil dans le bucket public « avatars » (les liens Meta expirent). */
export async function storePicture(sb: SupabaseClient, user: string, src: string): Promise<{ url: string | null; why?: string }> {
  if (!src) return { url: null, why: "sans_photo" };
  try {
    if (!/(\.|^)(cdninstagram\.com|fbcdn\.net)$/.test(new URL(src).hostname)) return { url: null, why: "adresse_inattendue" };
    const img = await fetch(src, { signal: AbortSignal.timeout(15_000) });
    const type = img.headers.get("content-type") ?? "";
    if (!img.ok || !type.startsWith("image/")) return { url: null, why: `image_${img.status}` };
    const bytes = new Uint8Array(await img.arrayBuffer());
    if (!bytes.length || bytes.length > 2_000_000) return { url: null, why: "image_taille" };
    const path = `instagram/${user.toLowerCase()}.jpg`;
    const { error } = await sb.storage.from("avatars").upload(path, bytes, { upsert: true, contentType: type, cacheControl: "86400" });
    if (error) return { url: null, why: "stockage" };
    // ?v= : la nouvelle photo remplace l'ancienne sans attendre le cache.
    return { url: `${sb.storage.from("avatars").getPublicUrl(path).data.publicUrl}?v=${Date.now()}` };
  } catch {
    return { url: null, why: "image_erreur" };
  }
}

// ── Recherche par hashtag ────────────────────────────────────────────────────
// Demande la fonction « Instagram Public Content Access » validée par Meta (App
// Review). Limite Meta : 30 hashtags différents par 7 jours glissants. Meta ne
// donne PAS l'auteur des posts : on renvoie le lien, l'agence ouvre le post.

export type HashtagResult = { ok: true; posts: IgPost[] } | { ok: false; why: string };

export async function hashtagPosts(tag: string, kind: "top" | "recent"): Promise<HashtagResult> {
  if (!metaReady()) return { ok: false, why: "meta_non_configure" };
  const q = tag.trim().replace(/^#/, "").toLowerCase();
  if (!/^[\p{L}\p{N}_]{1,60}$/u.test(q)) return { ok: false, why: "hashtag_invalide" };
  const auth = `user_id=${encodeURIComponent(META_IG_ID)}&access_token=${encodeURIComponent(META_TOKEN)}`;
  const found = await getJson(`${GRAPH}/ig_hashtag_search?q=${encodeURIComponent(q)}&${auth}`);
  if (found.error) return { ok: false, why: graphWhy(found.error as GraphError).why };
  const id = ((found.data as { id?: string }[] | undefined) ?? [])[0]?.id;
  if (!id) return { ok: false, why: "hashtag_introuvable" };
  const edge = kind === "recent" ? "recent_media" : "top_media";
  const media = await getJson(`${GRAPH}/${id}/${edge}?fields=${POST_FIELDS}&limit=50&${auth}`);
  if (media.error) return { ok: false, why: graphWhy(media.error as GraphError).why };
  return { ok: true, posts: ((media.data as Record<string, unknown>[] | undefined) ?? []).map(toPost) };
}
