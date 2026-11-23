import { describe, expect, it } from "vitest";
import { hasStats, isDuplicatePost, isSocialPostLink, linkKey, metricAmbigu, normalizeLink, parseMetric, postPlatform, postStepTarget, postsTableMissing, statsDueDay } from "./collabPosts";

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

  it("clé d'un post : garde l'id du contenu", () => {
    expect(linkKey("https://www.instagram.com/reel/ABC/?igsh=1")).toBe(linkKey("instagram.com/p/ABC"));
    expect(linkKey("https://www.instagram.com/reel/ABC/")).not.toBe(linkKey("https://www.instagram.com/reel/abc/"));
    // YouTube : trois formes du même lien, une seule clé ; deux vidéos, deux clés.
    const yt = linkKey("https://www.youtube.com/watch?v=Ab12Cd34Ef5&t=10s");
    expect(yt).toBe("youtube:Ab12Cd34Ef5");
    expect(linkKey("https://youtu.be/Ab12Cd34Ef5?si=x")).toBe(yt);
    expect(linkKey("https://youtube.com/shorts/Ab12Cd34Ef5")).toBe(yt);
    expect(linkKey("https://www.youtube.com/watch?v=Zz99Yy88Xx7")).not.toBe(yt);
    expect(linkKey("https://m.youtube.com/watch?v=Zz99Yy88Xx7")).toBe("youtube:Zz99Yy88Xx7");
    // TikTok : id de la vidéo ; un lien court non résolu reste à part.
    expect(linkKey("https://www.tiktok.com/@test/video/7301?lang=fr")).toBe("tiktok:7301");
    expect(linkKey("https://vm.tiktok.com/ZMabc/")).toBe("tiktok-court:vm.tiktok.com/ZMabc");
    expect(linkKey("https://vm.tiktok.com/ZMabc/")).not.toBe(linkKey("https://vm.tiktok.com/ZMxyz/"));
    expect(linkKey("https://vm.tiktok.com/ZMabc/")).not.toBe(linkKey("https://www.tiktok.com/@test/video/7301"));
    expect(linkKey("")).toBe("");
  });

  it("n'accepte que des liens Instagram, TikTok ou YouTube", () => {
    expect(isSocialPostLink("https://www.instagram.com/reel/x/")).toBe(true);
    expect(isSocialPostLink("https://youtu.be/x")).toBe(true);
    expect(isSocialPostLink("https://example.com/x")).toBe(false);
  });

  it("étape atteinte : seulement à partir du tournage, jamais en arrière", () => {
    expect(postStepTarget(4, false)).toBe(6);
    expect(postStepTarget(5, true)).toBe(7);
    expect(postStepTarget(6, true)).toBe(7);
    expect(postStepTarget(2, false)).toBeNull();
    expect(postStepTarget(3, true)).toBeNull();
    expect(postStepTarget(8, true)).toBeNull();
    expect(postStepTarget(6, false)).toBeNull();
    expect(postStepTarget(5, false, "perdue")).toBeNull();
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

  it("repère un chiffre à virgule sans K ni M (pavé iPhone sans K/M)", () => {
    // Ambigus : « 12,5 » voulait sans doute dire 12,5 K.
    expect(metricAmbigu("12,5")).toBe(true);
    expect(metricAmbigu("3.2")).toBe(true);
    expect(metricAmbigu(" 0,8 ")).toBe(true);
    expect(metricAmbigu("1 234,5")).toBe(true);
    expect(metricAmbigu("12.50")).toBe(true);
    // Clairs : K/M précisé, entier, séparateur de milliers, vide ou illisible.
    expect(metricAmbigu("12,5K")).toBe(false);
    expect(metricAmbigu("12,5 k")).toBe(false);
    expect(metricAmbigu("1.2M")).toBe(false);
    expect(metricAmbigu("12500")).toBe(false);
    expect(metricAmbigu("12 500")).toBe(false);
    expect(metricAmbigu("12.500")).toBe(false);
    expect(metricAmbigu("1,234,567")).toBe(false);
    expect(metricAmbigu("")).toBe(false);
    expect(metricAmbigu(null)).toBe(false);
    expect(metricAmbigu("beaucoup")).toBe(false);
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
