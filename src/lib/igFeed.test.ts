import { describe, expect, it } from "vitest";
import { engagement28, median, rankFeed, ratioLabel, readFeed, type FeedPost } from "./igFeed";

const now = new Date("2026-10-27T12:00:00Z");
const p = (id: string, daysAgo: number, extra: Partial<FeedPost> = {}): FeedPost => ({
  id, url: `https://www.instagram.com/p/${id}/`, at: new Date(now.getTime() - daysAgo * 86400000).toISOString(), likes: 100, comments: 0, ...extra,
});

describe("Mes stats : feed Instagram", () => {
  it("lit un feed abîmé sans planter, du plus récent au plus ancien", () => {
    const feed = readFeed([p("a", 5), null, { id: 3 }, p("b", 1, { likes: "x" as unknown as number })]);
    expect(feed.map((x) => x.id)).toEqual(["b", "a"]);
    expect(feed[0].likes).toBeNull();
    expect(readFeed("rien")).toEqual([]);
  });
  it("classe sur les vues si le compte est connecté, sinon sur likes + commentaires", () => {
    const feed = [p("a", 10, { views: 1000 }), p("b", 9, { views: 5000 }), p("c", 8, { views: 1200 }), p("d", 7, { views: 900 }), p("e", 0, { views: 10 })];
    const r = rankFeed(feed, 3, now);
    expect(r.byViews).toBe(true);
    expect(r.top.map((t) => t.post.id)).toEqual(["b", "c", "a"]);
    expect(r.top[0].ratio).toBe(5); // 5000 ÷ médiane 1000
    expect(r.weakest?.post.id).toBe("d"); // « e » est trop récent pour être jugé
    const pub = rankFeed([p("a", 3, { likes: 10 }), p("b", 3, { likes: 50, comments: 10 })], 3, now);
    expect(pub.byViews).toBe(false);
    expect(pub.top[0].post.id).toBe("b");
    expect(pub.weakest).toBeNull(); // pas assez de posts pour juger
  });
  it("médiane et ratio affiché", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
    expect(ratioLabel(2.4)).toBe("×2,4");
    expect(ratioLabel(1.1)).toBeNull();
    expect(ratioLabel(null)).toBeNull();
  });
  it("engagement des 28 jours", () => {
    expect(engagement28({ views: 20000, interactions: 900 })).toBe(4.5);
    expect(engagement28({ views: 0, interactions: 3 })).toBeNull();
    expect(engagement28(null)).toBeNull();
  });
});
