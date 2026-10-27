/**
 * Page « Mes stats » (logique PURE, testée par igFeed.test.ts) : à partir de la colonne
 * `creators.ig` écrite chaque jour par ig-sync (feed des 12 derniers posts, statistiques
 * du compte connecté, relevé quotidien des abonnés).
 */

export type FeedPost = {
  id: string;
  url: string;
  at: string;
  type?: string;
  product?: string;
  likes: number | null;
  comments: number;
  caption?: string;
  /** Chemin de l'image copiée dans le bucket public `avatars`. */
  thumb?: string;
  // Chiffres privés (compte connecté)
  views?: number;
  reach?: number;
  saves?: number;
  shares?: number;
};

const num = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Feed lu dans la colonne jsonb (valeurs bizarres écartées), du plus récent au plus ancien. */
export function readFeed(raw: unknown): FeedPost[] {
  if (!Array.isArray(raw)) return [];
  return (raw as FeedPost[])
    .filter((p) => p && typeof p === "object" && typeof p.id === "string" && typeof p.url === "string")
    .map((p) => ({ ...p, likes: num(p.likes) ? p.likes : null, comments: num(p.comments) ? p.comments : 0 }))
    .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
}

/** Le feed a-t-il des vues (compte connecté) ? Sinon on classe sur likes + commentaires. */
export function hasViews(feed: FeedPost[]): boolean {
  return feed.some((p) => num(p.views) && p.views > 0);
}

/** Score d'un post : ses vues si le feed en a, sinon likes + commentaires. */
export function postScore(p: FeedPost, byViews: boolean): number {
  return byViews ? (num(p.views) ? p.views : 0) : (p.likes ?? 0) + p.comments;
}

export function median(values: number[]): number {
  const v = values.filter(num).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export type RankedPost = { post: FeedPost; score: number; ratio: number | null };

/** Un post de moins de 2 jours n'a pas fini de tourner : jamais classé « moins bon ». */
const SETTLED_MS = 2 * 86400000;

/**
 * « Ce qui marche » : les `n` meilleurs posts (ratio = score ÷ médiane du feed) et le
 * moins bon parmi ceux qui ont eu le temps de tourner (null s'il n'y en a pas assez).
 */
export function rankFeed(feed: FeedPost[], n = 3, now: Date = new Date()): { top: RankedPost[]; weakest: RankedPost | null; byViews: boolean } {
  const byViews = hasViews(feed);
  const scored = feed.map((post) => ({ post, score: postScore(post, byViews) }));
  const med = median(scored.map((s) => s.score));
  const withRatio = (s: { post: FeedPost; score: number }): RankedPost => ({ ...s, ratio: med > 0 ? Math.round((s.score / med) * 10) / 10 : null });
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const top = sorted.filter((s) => s.score > 0).slice(0, n).map(withRatio);
  const settled = scored.filter((s) => now.getTime() - (Date.parse(s.post.at) || 0) >= SETTLED_MS);
  const low = settled.length >= 4 ? [...settled].sort((a, b) => a.score - b.score)[0] : null;
  const weakest = low && !top.some((t) => t.post.id === low.post.id) ? withRatio(low) : null;
  return { top, weakest, byViews };
}

/** Taux d'engagement des 28 derniers jours : interactions ÷ vues, en % (comme le relevé automatique). */
export function engagement28(ins: { views?: number | null; interactions?: number | null } | null | undefined): number | null {
  if (!ins || !num(ins.views) || ins.views <= 0 || !num(ins.interactions)) return null;
  return Math.round((ins.interactions / ins.views) * 1000) / 10;
}

/** Ratio « ×2,4 » (null si rien à comparer ou trop proche de la moyenne). */
export function ratioLabel(ratio: number | null): string | null {
  if (ratio === null || ratio < 1.2) return null;
  return `×${String(ratio).replace(".", ",")}`;
}
