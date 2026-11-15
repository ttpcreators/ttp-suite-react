import { describe, expect, it } from "vitest";
import { erSurAbonnes, erSurVues, interactions, postsRetenus, ratioPct } from "./engagementRate.ts";

const NOW = Date.parse("2026-11-16T12:00:00Z");
const jours = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("taux d'engagement : une seule formule", () => {
  it("arrondit à 2 décimales et refuse une base nulle", () => {
    expect(ratioPct(1, 3)).toBe(33.33);
    expect(ratioPct(5, 0)).toBeNull();
    expect(ratioPct(null, 100)).toBeNull();
  });

  it("compte toutes les interactions connues", () => {
    expect(interactions({ likes: 10, comments: 2, shares: 3, saves: 1 })).toBe(16);
    expect(interactions({ likes: 10, comments: null })).toBe(10);
  });

  it("garde les 12 derniers posts de plus de 7 jours, sans likes masqués", () => {
    const posts = [
      { at: jours(1), likes: 999 },
      { at: jours(2), likes: null },
      ...Array.from({ length: 15 }, (_, i) => ({ at: jours(8 + i), likes: i })),
    ];
    const r = postsRetenus(posts, NOW);
    expect(r).toHaveLength(12);
    expect(r[0].likes).toBe(0);
    expect(r.some((p) => p.likes === 999)).toBe(false);
  });

  it("prend les plus récents quand aucun post n'a 7 jours", () => {
    expect(postsRetenus([{ at: jours(1), likes: 5 }, { at: jours(2), likes: 7 }], NOW)).toHaveLength(2);
  });

  it("sur les abonnés : la moyenne par post divisée par les abonnés", () => {
    const posts = [
      { at: jours(8), likes: 90, comments: 10 },
      { at: jours(9), likes: 280, comments: 20 },
    ];
    expect(erSurAbonnes(posts, 10_000, NOW)).toBe(2); // (100 + 300) / 2 / 10 000
    expect(erSurAbonnes(posts, 0, NOW)).toBeNull();
    expect(erSurAbonnes([], 10_000, NOW)).toBeNull();
  });

  it("sur les vues : la somme des interactions divisée par la somme des vues", () => {
    const videos = [
      { at: jours(8), views: 1000, likes: 50, comments: 5, shares: 5 },
      { at: jours(9), views: 3000, likes: 100, comments: 20, shares: 20 },
      { at: jours(10), views: 0, likes: 999 },
    ];
    expect(erSurVues(videos, NOW)).toBe(5); // 200 / 4 000
    expect(erSurVues([{ at: jours(8), views: null, likes: 3 }], NOW)).toBeNull();
  });
});
