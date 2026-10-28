// ============================================================================
// _shared/creatorCollabs.ts : les collabs d'un créateur, post par post (fiche « Analyser
// un créateur » du Scouting, ig-sourcing mode « collabs »). Règles PURES, testées.
// ============================================================================

export type CollabPost = {
  id: string; url: string; at: string; kind: string; likes: number | null; comments: number;
  /** Engagement du post : (likes + commentaires) / abonnés, en %. */
  er: number | null;
  paid: boolean; brands: string[]; caption: string;
};
export type BrandSummary = { brand: string; posts: number; paid: number; last: string; er: number | null };

/** Format lisible d'un post Instagram. */
export function postKind(type: string, product: string): string {
  if (product === "REELS") return "Reel";
  if (type === "CAROUSEL_ALBUM") return "Carrousel";
  if (type === "VIDEO") return "Vidéo";
  return "Photo";
}

/** Engagement d'un post en % (null si les likes sont masqués ou sans abonnés). */
export function postEr(likes: number | null, comments: number, followers: number): number | null {
  if (likes == null || !followers) return null;
  return Math.round(((likes + comments) / followers) * 10000) / 100;
}

/** Une ligne par marque : nombre de posts, dont payés, dernier post, engagement moyen. */
export function brandSummary(posts: CollabPost[]): BrandSummary[] {
  const m = new Map<string, { posts: number; paid: number; last: string; ers: number[] }>();
  for (const p of posts) {
    for (const b of p.brands) {
      const x = m.get(b) ?? { posts: 0, paid: 0, last: "", ers: [] };
      x.posts++;
      if (p.paid) x.paid++;
      if (p.at > x.last) x.last = p.at;
      if (p.er != null) x.ers.push(p.er);
      m.set(b, x);
    }
  }
  return [...m.entries()]
    .map(([brand, x]) => ({ brand, posts: x.posts, paid: x.paid, last: x.last, er: x.ers.length ? Math.round((x.ers.reduce((a, b) => a + b, 0) / x.ers.length) * 100) / 100 : null }))
    .sort((a, b) => b.paid - a.paid || b.posts - a.posts || b.last.localeCompare(a.last));
}
