// ============================================================================
// _shared/engagementRate.ts : LE calcul du taux d'engagement d'un compte, le même partout
// (ig-sync, ig-sourcing, ig-avatar, tt-sync, yt-sync, yt-sourcing, Base créateurs,
// media kits, Alfred). Logique pure, testée par engagementRate.test.ts. Importé aussi par
// l'app (src/lib/igFeed.ts).
//
// Deux bases, qui ne disent pas la même chose et ne se comparent jamais entre elles :
//   • sur les abonnés (Instagram public, media kits) : interactions moyennes par post ÷ abonnés ;
//   • sur les vues (TikTok, YouTube, statistiques d'un compte connecté) : interactions ÷ vues.
// Les règles communes :
//   • interactions = likes + commentaires + partages + enregistrements, ceux qui sont connus ;
//   • un post aux likes masqués ne compte pas (il ferait baisser le taux à tort) ;
//   • les 12 derniers posts publiés depuis au moins 7 jours (leurs chiffres ont fini de monter) ;
//     s'il n'y en a aucun, les 12 derniers ;
//   • en %, arrondi à 2 décimales.
// ============================================================================

export type EngPost = {
  at?: string | null;
  likes: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  views?: number | null;
};

export const ER_POSTS = 12;
export const ER_RECUL_JOURS = 7;
const JOUR = 86_400_000;

/** En %, arrondi à 2 décimales. null si la base est nulle ou un chiffre illisible. */
export function ratioPct(part: number | null | undefined, base: number | null | undefined): number | null {
  if (part == null || base == null || !Number.isFinite(part) || !Number.isFinite(base) || base <= 0 || part < 0) return null;
  return Math.round((part / base) * 10000) / 100;
}

/** Interactions connues d'un post (likes + commentaires + partages + enregistrements). */
export function interactions(p: EngPost): number {
  const n = (x: number | null | undefined) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0);
  return n(p.likes) + n(p.comments) + n(p.shares) + n(p.saves);
}

/** Les posts retenus : likes visibles, publiés depuis 7 jours au moins (sinon les plus récents), 12 au plus. */
export function postsRetenus<T extends EngPost>(posts: T[], maintenant = Date.now()): T[] {
  const visibles = posts
    .filter((p) => p.likes != null)
    .map((p, i) => ({ p, i, t: p.at ? Date.parse(p.at) : NaN }))
    // Du plus récent au plus ancien ; sans date, l'ordre reçu (les API donnent le plus récent d'abord).
    .sort((a, b) => (Number.isNaN(a.t) || Number.isNaN(b.t) ? a.i - b.i : b.t - a.t));
  const murs = visibles.filter((x) => !Number.isNaN(x.t) && maintenant - x.t >= ER_RECUL_JOURS * JOUR);
  return (murs.length ? murs : visibles).slice(0, ER_POSTS).map((x) => x.p);
}

/** Taux sur les abonnés : interactions moyennes par post ÷ abonnés, en %. */
export function erSurAbonnes(posts: EngPost[], abonnes: number | null | undefined, maintenant = Date.now()): number | null {
  const retenus = postsRetenus(posts, maintenant);
  if (!retenus.length || !abonnes || abonnes <= 0) return null;
  return ratioPct(retenus.reduce((s, p) => s + interactions(p), 0) / retenus.length, abonnes);
}

/** Taux sur les vues : interactions ÷ vues des posts retenus qui ont des vues, en %. */
export function erSurVues(posts: EngPost[], maintenant = Date.now()): number | null {
  const retenus = postsRetenus(posts.filter((p) => typeof p.views === "number" && p.views > 0), maintenant);
  if (!retenus.length) return null;
  return ratioPct(retenus.reduce((s, p) => s + interactions(p), 0), retenus.reduce((s, p) => s + (p.views ?? 0), 0));
}
