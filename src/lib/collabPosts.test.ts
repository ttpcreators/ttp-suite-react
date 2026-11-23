import { describe, expect, it } from "vitest";
import { hasStats, isDuplicatePost, linkKey, normalizeLink, parseMetric, postPlatform, postsTableMissing, statsDueDay } from "./collabPosts";

describe("posts publiés déclarés par le créateur", () => {
  it("lit un lien collé, ajoute https et refuse le reste", () => {
    expect(normalizeLink("instagram.com/reel/abc")).toBe("https://instagram.com/reel/abc");
    expect(normalizeLink(" https://www.tiktok.com/@test/video/1 ")).toBe("https://www.tiktok.com/@test/video/1");
    expect(normalizeLink("")).toBeNull();
    expect(normalizeLink("javascript:alert(1)")).toBeNull();
    expect(normalizeLink("pas un lien")).toBeNull();
    expect(normalizeLink(`https://example.com/${"a".repeat(600)}`)).toBeNull();
  });

  it("reconnaît le réseau", () => {
    expect(postPlatform("https://www.instagram.com/p/x/")).toBe("instagram");
    expect(postPlatform("https://vm.tiktok.com/x")).toBe("tiktok");
    expect(postPlatform("https://youtu.be/x")).toBe("youtube");
    expect(postPlatform("https://example.com")).toBe("autre");
  });

  it("compare deux liens sans www, paramètres ni / final", () => {
    expect(linkKey("https://www.instagram.com/reel/ABC/?igsh=1")).toBe(linkKey("instagram.com/reel/abc"));
  });

  it("lit les chiffres comme on les tape", () => {
    expect(parseMetric("12 500")).toBe(12500);
    expect(parseMetric("12,5k")).toBe(12500);
    expect(parseMetric("1.2M")).toBe(1200000);
    expect(parseMetric("12.500")).toBe(12500);
    expect(parseMetric("1,234,567")).toBe(1234567);
    expect(parseMetric("")).toBeNull();
    expect(parseMetric("-3")).toBeNaN();
    expect(parseMetric("beaucoup")).toBeNaN();
  });

  it("stats présentes, date des 7 jours, erreurs de la base", () => {
    expect(hasStats({ views: null, likes: 0, comments: null, shares: null, saves: null })).toBe(true);
    expect(hasStats({ views: null, likes: null, comments: null, shares: null, saves: null })).toBe(false);
    expect(statsDueDay("2026-11-23T10:00:00")).toBe("2026-11-30");
    expect(postsTableMissing({ code: "PGRST205", message: "Could not find the table 'public.collab_posts' in the schema cache" })).toBe(true);
    expect(postsTableMissing({ code: "42501", message: "collab interdite" })).toBe(false);
    expect(isDuplicatePost({ code: "23505" })).toBe(true);
  });
});
