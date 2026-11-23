/**
 * Posts publiés d'une collab, déclarés par le créateur (logique PURE, testée) : le lien
 * de son post, puis ses stats à 7 jours. Table `collab_posts`
 * (sql/2026-11-23-espace-createur-collab.sql) : le lien fait passer la collab à l'étape 6
 * « Publication », les stats à l'étape 7 « Stats à 7 jours » (trigger côté base). La page
 * Debrief reprend ces chiffres dans le bilan (src/lib/campaignRecap.ts).
 */

export type PostPlatform = "instagram" | "tiktok" | "youtube" | "autre";

export type CollabPost = {
  id: string;
  collab_id: string;
  creator: string;
  url: string;
  platform: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  capture_path: string | null;
  stats_at: string | null;
  created_at: string;
};

export type PostMetric = "views" | "likes" | "comments" | "shares" | "saves";

/** Les 5 chiffres demandés au créateur, dans l'ordre du formulaire. */
export const POST_METRICS: { key: PostMetric; label: string }[] = [
  { key: "views", label: "Vues" },
  { key: "likes", label: "Likes" },
  { key: "comments", label: "Commentaires" },
  { key: "shares", label: "Partages" },
  { key: "saves", label: "Enregistrements" },
];

/** Colonnes lues (toujours les mêmes, côté créateur comme côté agence). */
export const POST_COLS = "id,collab_id,creator,url,platform,views,likes,comments,shares,saves,capture_path,stats_at,created_at";

/**
 * Lien saisi → adresse propre (https ajouté s'il manque), ou null s'il n'est pas lisible.
 * 500 caractères au plus (même limite que la base).
 */
export function normalizeLink(raw: string | null | undefined): string | null {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null; // autre protocole (javascript:, mailto:…)
    s = `https://${s.replace(/^\/+/, "")}`;
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".") || /\s/.test(s)) return null;
  const out = u.toString();
  return out.length <= 500 ? out : null;
}

/** Réseau d'un lien de post. */
export function postPlatform(url: string): PostPlatform {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "autre";
  }
  if (host === "instagram.com" || host.endsWith(".instagram.com") || host === "instagr.am") return "instagram";
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
  if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") return "youtube";
  return "autre";
}

/**
 * Clé de comparaison d'un lien de post, pour reconnaître le même post relevé par les
 * synchros. Elle garde toujours l'identifiant du contenu (sensible à la casse) :
 *   - YouTube : watch?v=ID, youtu.be/ID, /shorts/ID, /live/ID, /embed/ID → « youtube:ID » ;
 *   - TikTok : /@compte/video/ID → « tiktok:ID » ; un lien court (vm.tiktok.com, /t/…) non
 *     résolu garde une clé à part (jamais fusionné à tort, il compte comme un autre post) ;
 *   - Instagram : /p/ID, /reel/ID, /reels/ID, /tv/ID → « instagram:ID » ;
 *   - sinon : domaine (sans www) + chemin, sans « / » final ni paramètres.
 * Lien illisible → "" (jamais rapproché).
 */
export function linkKey(url: string | null | undefined): string {
  const s = String(url ?? "").trim();
  if (!s) return "";
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return "";
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  if (host === "youtu.be") return parts[0] ? `youtube:${parts[0]}` : "";
  if (host === "youtube.com" || host.endsWith(".youtube.com")) {
    const v = u.searchParams.get("v");
    if (u.pathname === "/watch" && v) return `youtube:${v}`;
    if (["shorts", "live", "embed", "v"].includes(parts[0]) && parts[1]) return `youtube:${parts[1]}`;
    return `${host}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  }
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    const i = parts.indexOf("video");
    if (i >= 0 && parts[i + 1]) return `tiktok:${parts[i + 1]}`;
    if (host === "tiktok.com" && parts[0] === "t" && parts[1]) return `tiktok-court:${parts[1]}`;
    if (host !== "tiktok.com" && parts[0]) return `tiktok-court:${host}/${parts[0]}`;
  }
  if (host === "instagram.com" || host === "instagr.am") {
    const i = parts.findIndex((x) => ["p", "reel", "reels", "tv"].includes(x));
    if (i >= 0 && parts[i + 1]) return `instagram:${parts[i + 1]}`;
  }
  return `${host}${u.pathname.replace(/\/+$/, "")}`;
}

/** Un lien de post doit venir d'Instagram, TikTok ou YouTube. */
export function isSocialPostLink(url: string): boolean {
  return postPlatform(url) !== "autre";
}

/**
 * Étape que la collab atteint quand le créateur envoie son post (miroir du trigger SQL
 * collab_posts_advance) : seulement si elle est déjà au tournage (étape 4) ou plus loin,
 * jamais en arrière, rien sur une collab perdue ou archivée. null = l'étape ne bouge pas.
 */
export function postStepTarget(step: number | null | undefined, withStats: boolean, status?: string | null): number | null {
  const cur = step ?? 1;
  if (status === "perdue" || status === "archivee") return null;
  const target = withStats ? 7 : 6;
  return cur >= 4 && cur < target ? target : null;
}

/**
 * Chiffre saisi → nombre entier. « 12 500 », « 12,5k », « 1.2M », « 3 400 » acceptés ;
 * vide → null ; illisible ou négatif → NaN.
 */
export function parseMetric(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").trim().toLowerCase().replace(/[\s  ]/g, "");
  if (!s) return null;
  const m = /^(\d+(?:[.,]\d+)?)([km]?)$/.exec(s);
  if (!m) {
    // « 12.500 » ou « 12,500 » : séparateur de milliers.
    if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ""));
    return Number.NaN;
  }
  const base = Number(m[1].replace(",", "."));
  const mult = m[2] === "k" ? 1_000 : m[2] === "m" ? 1_000_000 : 1;
  // « 12.500 » sans suffixe = douze mille cinq cents (milliers), pas 12,5.
  if (!m[2] && /^\d{1,3}[.,]\d{3}$/.test(s)) return Number(s.replace(/[.,]/g, ""));
  return Math.round(base * mult);
}

/** Le post a-t-il au moins un chiffre ? */
export function hasStats(p: Pick<CollabPost, PostMetric>): boolean {
  return POST_METRICS.some(({ key }) => typeof p[key] === "number");
}

/** Jour où les stats à 7 jours sont attendues (AAAA-MM-JJ), à partir de l'envoi du lien. */
export function statsDueDay(createdAt: string | null | undefined): string {
  const t = Date.parse(String(createdAt ?? ""));
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + 7 * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Table `collab_posts` absente (SQL pas encore lancé). */
export function postsTableMissing(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!e) return false;
  return e.code === "42P01" || e.code === "PGRST205" || (/collab_posts/i.test(e.message ?? "") && /does not exist|schema cache|could not find/i.test(e.message ?? ""));
}

/** Lien déjà envoyé pour cette collab (index unique collab_id + url). */
export function isDuplicatePost(e: { code?: string | null } | null | undefined): boolean {
  return e?.code === "23505";
}

/** Libellé court d'un post : « Instagram », « TikTok », « YouTube », sinon « Post ». */
export function platformLabel(p: string | null | undefined): string {
  return p === "instagram" ? "Instagram" : p === "tiktok" ? "TikTok" : p === "youtube" ? "YouTube" : "Post";
}
