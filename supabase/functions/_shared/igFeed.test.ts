import { describe, expect, it } from "vitest";
import { buildFeed, feedDir, feedThumbPath, missingThumbs, publicFeed, staleThumbs, type FeedSource } from "./igFeed.ts";

const post = (id: string, extra: Partial<FeedSource> = {}): FeedSource => ({
  id, url: `https://www.instagram.com/p/${id}/`, at: "2026-10-20T10:00:00+0000", type: "VIDEO", product: "REELS",
  likes: 100, comments: 5, caption: "Une légende", ...extra,
});

describe("feed Instagram (Mes stats)", () => {
  it("garde 12 posts, coupe les légendes, ajoute chiffres et images", () => {
    const media = Array.from({ length: 15 }, (_, i) => post(`p${i}`, i === 0 ? { caption: "a ".repeat(200) } : {}));
    const feed = buildFeed(media, null, new Map([["p0", { views: 5000, reach: 3000 }]]), new Map([["p0", "feed/c1/p0.jpg"]]));
    expect(feed).toHaveLength(12);
    expect(feed[0].caption.length).toBeLessThanOrEqual(140);
    expect(feed[0].caption.endsWith("…")).toBe(true);
    expect(feed[0]).toMatchObject({ views: 5000, reach: 3000, thumb: "feed/c1/p0.jpg", likes: 100 });
    expect(feed[1].views).toBeUndefined();
  });
  it("sans chiffres du jour, garde ceux déjà connus et l'image déjà copiée", () => {
    const prev = [{ id: "p0", views: 4000, saves: 12, thumb: "feed/c1/p0.jpg" }];
    const [p] = buildFeed([post("p0", { likes: 120 })], prev, new Map([["p0", null]]), new Map());
    expect(p).toMatchObject({ views: 4000, saves: 12, thumb: "feed/c1/p0.jpg", likes: 120 });
  });
  it("ancien feed illisible : ignoré", () => {
    expect(buildFeed([post("p0")], "pas un tableau", new Map(), new Map())[0].thumb).toBeUndefined();
    expect(missingThumbs([post("p0"), post("p1")], [{ id: "p0", thumb: "x" }, null, 3])).toEqual(["p1"]);
  });
  it("chemins sûrs et images à retirer", () => {
    expect(feedThumbPath("c-1", "17/../9")).toBe("feed/c-1/179.jpg");
    expect(feedDir("c-1")).toBe("feed/c-1");
    const feed = buildFeed([post("p0")], null, new Map(), new Map([["p0", "feed/c-1/p0.jpg"]]));
    expect(staleThumbs("feed/c-1", ["p0.jpg", "vieux.jpg"], feed)).toEqual(["feed/c-1/vieux.jpg"]);
  });
  it("déconnexion : plus aucun chiffre privé", () => {
    expect(publicFeed([{ id: "p0", likes: 3, views: 10, reach: 8, saves: 1, shares: 2, thumb: "t" }])).toEqual([{ id: "p0", likes: 3, thumb: "t" }]);
    expect(publicFeed(null)).toEqual([]);
  });
});
