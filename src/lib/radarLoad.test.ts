import { describe, expect, it } from "vitest";
import { chunks, loadRadar, RADAR_ERROR_TEXT, RADAR_LIMIT, RADAR_POSTS_CHUNK, radarLoadError, radarSince, type RadarDbError, type RadarFetch } from "./radarLoad";

type Light = { brand: string; status: string; last_seen: string };
type Post = { c: string };

const NOW = Date.parse("2026-11-27T12:00:00Z");
const light = (n: number, prefix = "marque-"): Light[] =>
  Array.from({ length: n }, (_, i) => ({ brand: `${prefix}${i}`, status: "nouveau", last_seen: "2026-11-27T10:40:00Z" }));

/** Faux accès base : note les appels, renvoie ce qu'on lui donne. */
function fake(o: { window: Light[]; all?: Light[]; listError?: RadarDbError; fallbackError?: RadarDbError; postsError?: RadarDbError; skip?: string[] }) {
  const calls = { list: [] as (string | null)[], posts: [] as string[][] };
  const fetch: RadarFetch<Light, Post> = {
    list: async (since) => {
      calls.list.push(since);
      if (since !== null) return o.listError ? { data: null, error: o.listError } : { data: o.window, error: null };
      return o.fallbackError ? { data: null, error: o.fallbackError } : { data: o.all ?? o.window, error: null };
    },
    posts: async (brands) => {
      calls.posts.push(brands);
      if (o.postsError) return { data: null, error: o.postsError };
      return { data: brands.filter((b) => !o.skip?.includes(b)).map((b) => ({ brand: b, posts: [{ c: `createur-de-${b}` }] })), error: null };
    },
  };
  return { fetch, calls };
}

describe("erreurs du radar", () => {
  it("table absente : la mise à jour est en attente", () => {
    expect(radarLoadError({ code: "42P01", message: 'relation "public.ig_radar" does not exist' })).toBe("absente");
    expect(radarLoadError({ code: "PGRST205", message: "Could not find the table 'public.ig_radar' in the schema cache" })).toBe("absente");
  });
  it("délai dépassé : trop lent, pas « pas encore activée »", () => {
    expect(radarLoadError({ code: "57014", message: "canceling statement due to statement timeout" })).toBe("lent");
    expect(radarLoadError({ message: "canceling statement due to statement timeout" })).toBe("lent");
    expect(RADAR_ERROR_TEXT.lent).not.toMatch(/pas encore activée/);
  });
  it("le reste (réseau, droits) : erreur simple ; rien si pas d'erreur", () => {
    expect(radarLoadError({ code: "", message: "TypeError: Failed to fetch" })).toBe("autre");
    expect(radarLoadError({ code: "42501", message: "permission denied for table ig_radar" })).toBe("autre");
    expect(radarLoadError(null)).toBeNull();
  });
});

describe("lecture en deux temps", () => {
  it("fenêtre de 7 jours d'abord, puis les posts par paquets de 150, dans l'ordre de la liste", async () => {
    const { fetch, calls } = fake({ window: light(RADAR_LIMIT) });
    const r = await loadRadar(fetch, NOW);
    expect(calls.list).toEqual([radarSince(NOW)]);
    expect(radarSince(NOW)).toBe("2026-11-20T12:00:00.000Z");
    expect(calls.posts).toHaveLength(Math.ceil(RADAR_LIMIT / RADAR_POSTS_CHUNK));
    expect(calls.posts.every((p) => p.length <= RADAR_POSTS_CHUNK)).toBe(true);
    if (!r.ok) throw new Error("lecture ratée");
    expect(r.rows).toHaveLength(RADAR_LIMIT);
    expect(r.rows[0]).toEqual({ brand: "marque-0", status: "nouveau", last_seen: "2026-11-27T10:40:00Z", posts: [{ c: "createur-de-marque-0" }] });
    expect(r.rows[RADAR_LIMIT - 1].brand).toBe(`marque-${RADAR_LIMIT - 1}`);
  });
  it("moins de 1 000 marques sur 7 jours (radar arrêté) : relit sans limite de date", async () => {
    const { fetch, calls } = fake({ window: light(3), all: light(5, "ancienne-") });
    const r = await loadRadar(fetch, NOW);
    expect(calls.list).toEqual([radarSince(NOW), null]);
    expect(r.ok && r.rows.map((x) => x.brand)).toEqual(["ancienne-0", "ancienne-1", "ancienne-2", "ancienne-3", "ancienne-4"]);
  });
  it("radar vide : aucune lecture de posts", async () => {
    const { fetch, calls } = fake({ window: [] });
    const r = await loadRadar(fetch, NOW);
    expect(r).toEqual({ ok: true, rows: [] });
    expect(calls.posts).toEqual([]);
  });
  it("une marque effacée entre les deux lectures sort de la liste", async () => {
    const { fetch } = fake({ window: light(4), skip: ["marque-2"] });
    const r = await loadRadar(fetch, NOW);
    expect(r.ok && r.rows.map((x) => x.brand)).toEqual(["marque-0", "marque-1", "marque-3"]);
  });
  it("délai dépassé sur la liste, sur la relecture ou sur un paquet de posts : erreur « lent » avec le détail", async () => {
    const lent = { code: "57014", message: "canceling statement due to statement timeout" };
    expect(await loadRadar(fake({ window: [], listError: lent }).fetch, NOW)).toEqual({ ok: false, error: "lent", detail: "57014 canceling statement due to statement timeout" });
    expect((await loadRadar(fake({ window: light(2), fallbackError: lent }).fetch, NOW)).ok).toBe(false);
    const r = await loadRadar(fake({ window: light(RADAR_LIMIT), postsError: lent }).fetch, NOW);
    expect(r.ok === false && r.error).toBe("lent");
  });
  it("table absente : erreur « absente »", async () => {
    const r = await loadRadar(fake({ window: [], listError: { code: "PGRST205", message: "Could not find the table 'public.ig_radar'" } }).fetch, NOW);
    expect(r.ok === false && r.error).toBe("absente");
  });
});

describe("paquets", () => {
  it("découpe sans perdre ni dupliquer", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([], 150)).toEqual([]);
    expect(chunks([1, 2], 0)).toEqual([[1], [2]]);
  });
});
