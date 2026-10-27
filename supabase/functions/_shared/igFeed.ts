// ============================================================================
// _shared/igFeed.ts : le feed Instagram d'une créatrice (page « Mes stats »).
// ----------------------------------------------------------------------------
// Logique PURE (testée par igFeed.test.ts). ig-sync range dans creators.ig.feed
// ses FEED_SIZE derniers posts : lien, date, format, likes, commentaires, début
// de légende, image copiée dans le bucket public `avatars` (les adresses d'image
// de Meta expirent au bout de quelques jours) et, si elle a connecté son compte,
// vues, couverture, enregistrements et partages de chaque post.
// ============================================================================

export const FEED_SIZE = 12;
const CAPTION_MAX = 140;

/** Post tel que lu chez Meta (business discovery). */
export type FeedSource = {
  id: string;
  url: string;
  at: string;
  type: string;
  product: string;
  likes: number | null;
  comments: number;
  caption: string;
};
export type PostStats = { reach?: number; saves?: number; shares?: number; views?: number };
export type FeedPost = Omit<FeedSource, "caption"> & PostStats & { caption: string; thumb?: string };

/** Chemin de l'image copiée d'un post dans le bucket `avatars`. */
export function feedThumbPath(creatorId: string, postId: string): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "");
  return `feed/${safe(creatorId)}/${safe(postId)}.jpg`;
}

/** Dossier des images du feed d'une créatrice. */
export function feedDir(creatorId: string): string {
  return feedThumbPath(creatorId, "x").replace(/\/x\.jpg$/, "");
}

function shortCaption(s: string): string {
  const one = (s ?? "").replace(/\s+/g, " ").trim();
  return one.length > CAPTION_MAX ? `${one.slice(0, CAPTION_MAX - 1).trimEnd()}…` : one;
}

/** Ancien feed (colonne jsonb) → posts par id, sans planter sur une valeur bizarre. */
export function prevFeedById(prev: unknown): Map<string, FeedPost> {
  const out = new Map<string, FeedPost>();
  if (!Array.isArray(prev)) return out;
  for (const p of prev) if (p && typeof p === "object" && typeof (p as FeedPost).id === "string") out.set((p as FeedPost).id, p as FeedPost);
  return out;
}

/**
 * Feed à enregistrer : les FEED_SIZE derniers posts, chiffres publics à jour, chiffres
 * privés du jour (sinon ceux déjà connus), image copiée (nouvelle, sinon l'ancienne).
 */
export function buildFeed(
  media: FeedSource[],
  prev: unknown,
  stats: Map<string, PostStats | null>,
  thumbs: Map<string, string>,
): FeedPost[] {
  const old = prevFeedById(prev);
  return media.slice(0, FEED_SIZE).map((m) => {
    const before = old.get(m.id);
    const s = stats.get(m.id) ?? null;
    const keep = (k: keyof PostStats) => (typeof s?.[k] === "number" ? s[k] : before?.[k]);
    const post: FeedPost = {
      id: m.id, url: m.url, at: m.at, type: m.type, product: m.product,
      likes: m.likes, comments: m.comments, caption: shortCaption(m.caption),
    };
    for (const k of ["views", "reach", "saves", "shares"] as const) {
      const v = keep(k);
      if (typeof v === "number") post[k] = v;
    }
    const thumb = thumbs.get(m.id) ?? before?.thumb;
    if (thumb) post.thumb = thumb;
    return post;
  });
}

/** Posts dont l'image reste à copier. */
export function missingThumbs(media: FeedSource[], prev: unknown): string[] {
  const old = prevFeedById(prev);
  return media.slice(0, FEED_SIZE).filter((m) => !old.get(m.id)?.thumb).map((m) => m.id);
}

/** Fichiers du dossier qui ne servent plus (posts sortis du feed). */
export function staleThumbs(dir: string, files: string[], feed: FeedPost[]): string[] {
  const keep = new Set(feed.map((p) => p.thumb).filter(Boolean));
  return files.map((f) => `${dir}/${f}`).filter((path) => !keep.has(path));
}

/** Feed sans les chiffres privés (vues, couverture, enregistrements, partages) : à la déconnexion. */
export function publicFeed(prev: unknown): FeedPost[] {
  return [...prevFeedById(prev).values()].map(({ views: _v, reach: _r, saves: _s, shares: _sh, ...rest }) => rest);
}
