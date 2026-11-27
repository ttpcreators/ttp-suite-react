/*
 * Radar à marques Instagram (Sourcing › Radar) : lecture de la liste, règles pures
 * testées (radarLoad.test.ts). L'accès base est passé en paramètre (`RadarFetch`).
 *
 * Pourquoi : ig_radar fait 45 000 lignes et 67 Mo (colonne `posts`). Lire d'un coup les
 * 1 000 marques vues en dernier AVEC leurs posts dépassait parfois la limite de 8 s de la
 * base (erreur 57014), et l'écran disait à tort « pas encore activée ». Désormais :
 *   1. une liste légère (marque, statut, dates), sans les posts : d'abord les marques vues
 *      ces 7 derniers jours (le radar passe toutes les 2 h, la base filtre la date avant
 *      de vérifier les droits) ; s'il y en a moins de 1 000, on relit sans cette limite
 *      (radar arrêté depuis des jours, table presque vide) ;
 *   2. les posts, par paquets de 150 marques (lecture par la clé, rapide).
 * Une erreur dit ce qui se passe : table absente (SQL pas lancé), trop lent, autre.
 */

export type RadarDbError = { code?: string | null; message?: string | null } | null | undefined;
export type RadarLoadError = "absente" | "lent" | "autre";
export type RadarResult<T> = { data: T[] | null; error: RadarDbError };

/** Nombre de marques lues (les plus récentes). */
export const RADAR_LIMIT = 1000;
/** Fenêtre de la première lecture, en jours. */
export const RADAR_WINDOW_DAYS = 7;
/** Taille d'un paquet de marques pour lire les posts. */
export const RADAR_POSTS_CHUNK = 150;

/** Nature d'une erreur de lecture du radar ; null s'il n'y en a pas. */
export function radarLoadError(e: RadarDbError): RadarLoadError | null {
  if (!e) return null;
  const code = e.code ?? "";
  const msg = e.message ?? "";
  if (code === "42P01" || code === "PGRST205" || /could not find the table|relation .* does not exist/i.test(msg)) return "absente";
  if (code === "57014" || /statement timeout|canceling statement/i.test(msg)) return "lent";
  return "autre";
}

/** Ce que l'écran affiche pour chaque erreur. */
export const RADAR_ERROR_TEXT: Record<RadarLoadError, string> = {
  absente: "Cette partie n'est pas encore activée : une mise à jour est en attente (voir Réglages › Diagnostic).",
  lent: "Le radar met trop de temps à charger. Réessaie dans un instant.",
  autre: "Le radar n'a pas pu se charger. Réessaie dans un instant.",
};

/** Début de la fenêtre de la première lecture (ISO). */
export const radarSince = (now: number, days = RADAR_WINDOW_DAYS): string => new Date(now - days * 86_400_000).toISOString();

/** Découpe une liste en paquets (le dernier peut être plus court). */
export function chunks<T>(list: readonly T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

export type RadarFetch<L, P> = {
  /** Liste légère triée par dernière vue (la plus récente d'abord) ; `since` null : sans limite de date. */
  list: (since: string | null) => PromiseLike<RadarResult<L>>;
  /** Posts d'un paquet de marques. */
  posts: (brands: string[]) => PromiseLike<RadarResult<{ brand: string; posts: P[] | null }>>;
};

export type RadarLoad<L, P> =
  | { ok: true; rows: (L & { posts: P[] })[] }
  | { ok: false; error: RadarLoadError; detail: string };

/** Lit le radar en deux temps (voir l'en-tête). Ne lève pas : une erreur est renvoyée. */
export async function loadRadar<L extends { brand: string }, P>(fetch: RadarFetch<L, P>, now: number): Promise<RadarLoad<L, P>> {
  const fail = (e: RadarDbError): RadarLoad<L, P> => ({
    ok: false,
    error: radarLoadError(e) ?? "autre",
    detail: `${e?.code ?? ""} ${e?.message ?? ""}`.trim(),
  });
  let r = await fetch.list(radarSince(now));
  if (r.error) return fail(r.error);
  if ((r.data?.length ?? 0) < RADAR_LIMIT) {
    r = await fetch.list(null);
    if (r.error) return fail(r.error);
  }
  const list = r.data ?? [];
  const posts = new Map<string, P[]>();
  for (const part of chunks(list.map((x) => x.brand), RADAR_POSTS_CHUNK)) {
    const p = await fetch.posts(part);
    if (p.error) return fail(p.error);
    for (const x of p.data ?? []) posts.set(x.brand, Array.isArray(x.posts) ? x.posts : []);
  }
  // Une marque effacée entre les deux lectures (ménage du radar) sort de la liste.
  const rows: (L & { posts: P[] })[] = [];
  for (const x of list) {
    const p = posts.get(x.brand);
    if (p) rows.push({ ...x, posts: p });
  }
  return { ok: true, rows };
}
