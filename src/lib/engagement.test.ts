import { describe, it, expect } from "vitest";
import { parseNum, totalsOf, fmtCompact, fmtPct, emptyStat, erVerdict, reliableEr, platformOfKind, allHaveReach, singlePlatform, GOOD_ER_REACH, type PostStat } from "./engagement";

const post = (o: Partial<PostStat>): PostStat => ({ ...emptyStat("x"), ...o });

describe("parseNum — lecture des chiffres relevés sur une capture", () => {
  it("lit un entier simple et les espaces de milliers", () => {
    expect(parseNum("12345")).toBe(12345);
    expect(parseNum("12 345")).toBe(12345);
    expect(parseNum("12 345")).toBe(12345); // espace insécable (copier-coller iOS)
  });
  it("lit les suffixes K / M, collés ou espacés, quelle que soit la casse", () => {
    expect(parseNum("480k")).toBe(480_000);
    expect(parseNum("480 K")).toBe(480_000);
    expect(parseNum("1,2 M")).toBe(1_200_000);
    expect(parseNum("1.2M")).toBe(1_200_000);
  });
  it("distingue le point décimal du séparateur de milliers", () => {
    expect(parseNum("12.345")).toBe(12345); // 3 chiffres + pas de suffixe → milliers
    expect(parseNum("12.3K")).toBe(12_300); // suffixe → décimale
    expect(parseNum("1,234.5")).toBe(1234.5); // format anglais mixte
    expect(parseNum("1.234,5")).toBe(1234.5); // format français mixte
  });
  it("lit les virgules de milliers anglaises, y compris multiples", () => {
    expect(parseNum("1,200,000")).toBe(1_200_000); // ne devient PAS 1.2
    expect(parseNum("12,345")).toBe(12_345);
    expect(parseNum("123,456,789")).toBe(123_456_789);
    expect(parseNum("6,42")).toBe(6.42); // décimale française préservée
  });
  it("renvoie 0 — jamais NaN — sur une saisie illisible", () => {
    expect(parseNum("")).toBe(0);
    expect(parseNum("abc")).toBe(0);
    expect(parseNum(null)).toBe(0);
    expect(parseNum(undefined)).toBe(0);
    expect(parseNum(Number.NaN)).toBe(0);
    expect(parseNum("-50")).toBe(0);
  });
});

describe("totalsOf — taux d'engagement", () => {
  it("additionne les interactions sans compter les vues", () => {
    const t = totalsOf([post({ reach: 1000, likes: 100, comments: 10, saves: 5, shares: 5, views: 99_999 })]);
    expect(t.interactions).toBe(120);
    expect(t.views).toBe(99_999);
    expect(t.erReach).toBeCloseTo(12, 5); // 120 / 1000
  });

  it("calcule le taux sur la couverture, toutes publications confondues", () => {
    const t = totalsOf([
      post({ reach: 1000, likes: 50 }),
      post({ reach: 3000, likes: 150 }),
    ]);
    expect(t.reach).toBe(4000);
    expect(t.erReach).toBeCloseTo(5, 5); // 200 / 4000
    expect(t.avgReach).toBe(2000);
  });

  it("divise par le nombre de publications pour le taux sur abonnés", () => {
    // 2 publications, 200 interactions au total, 10 000 abonnés
    // → moyenne 100 par publi → 1 % (et NON 2 % : 10 publis ne doivent pas gonfler le taux)
    const t = totalsOf([post({ likes: 100 }), post({ likes: 100 })], 10_000);
    expect(t.erFollowers).toBeCloseTo(1, 5);
  });

  it("renvoie null (et pas 0 ni une division par zéro) quand la base manque", () => {
    const t = totalsOf([post({ likes: 100 })], 0);
    expect(t.erReach).toBeNull(); // couverture à 0 → indéterminé
    expect(t.erFollowers).toBeNull(); // abonnés inconnus → indéterminé
    const vide = totalsOf([], 10_000);
    expect(vide.erFollowers).toBeNull(); // 0 publication → indéterminé
    expect(vide.avgReach).toBe(0);
  });

  it("ignore les valeurs négatives au lieu de retrancher des interactions", () => {
    const t = totalsOf([post({ reach: 1000, likes: 100, comments: -50 })]);
    expect(t.interactions).toBe(100);
  });

  it("saisie globale : le nombre de publications saisi prime sur le nombre de lignes", () => {
    // 1 ligne de totaux, mais 4 publications déclarées → la moyenne se fait sur 4.
    const t = totalsOf([post({ reach: 40_000, likes: 3_800, comments: 200 })], 10_000, 4);
    expect(t.posts).toBe(4);
    expect(t.avgReach).toBe(10_000); // 40 000 / 4
    expect(t.erReach).toBeCloseTo(10, 5); // 4 000 / 40 000 — insensible au nb de publis
    expect(t.erFollowers).toBeCloseTo(10, 5); // (4 000 / 4) / 10 000
  });

  it("saisie globale : un nombre de publications à 0 ou absurde retombe sur les lignes", () => {
    expect(totalsOf([post({ likes: 10 }), post({ likes: 10 })], 0, 0).posts).toBe(2);
    expect(totalsOf([post({ likes: 10 }), post({ likes: 10 })], 0, -5).posts).toBe(2);
  });
});

describe("formats", () => {
  it("fmtCompact", () => {
    expect(fmtCompact(480_000)).toBe("480K");
    expect(fmtCompact(1_240_000)).toBe("1,2M");
    expect(fmtCompact(9_200)).toBe("9,2K");
    expect(fmtCompact(0)).toBe("0");
  });
  it("fmtPct", () => {
    expect(fmtPct(6.42)).toBe("6,4 %");
    expect(fmtPct(5)).toBe("5 %");
    expect(fmtPct(null)).toBe("—");
  });
});

describe("parseNum tolère les approximations", () => {
  it("« ~12k », « ≈ 12 000 », « 45K abonnés »", () => {
    expect(parseNum("~12k")).toBe(12_000);
    expect(parseNum("≈ 12 000")).toBe(12_000);
    expect(parseNum("45K abonnés")).toBe(45_000);
    expect(parseNum("1,2 M")).toBe(1_200_000); // « m » seul reste un suffixe
  });
});

describe("taux global sur une base homogène", () => {
  const s = (kind: string, p: Partial<PostStat>): PostStat => ({ ...emptyStat(kind + Math.random(), kind), ...p });
  it("réseau d'une publication d'après son type", () => {
    expect(platformOfKind("Reel")).toBe("instagram");
    expect(platformOfKind("Carrousel")).toBe("instagram");
    expect(platformOfKind("TikTok")).toBe("tiktok");
    expect(platformOfKind("Short")).toBe("youtube");
    expect(platformOfKind("YouTube")).toBe("youtube");
  });
  it("couverture partout → taux sur la couverture", () => {
    const st = [s("Reel", { reach: 10_000, likes: 500 }), s("Post", { reach: 10_000, likes: 300 })];
    expect(allHaveReach(st)).toBe(true);
    expect(reliableEr(st, { instagram: 1000 })).toEqual({ er: 4, basis: "reach", followers: 0 });
  });
  it("un seul réseau sans couverture → abonnés de CE réseau", () => {
    const st = [s("TikTok", { likes: 900, comments: 100 })];
    expect(singlePlatform(st)).toBe("tiktok");
    expect(reliableEr(st, { instagram: 10_000, tiktok: 50_000 })).toEqual({ er: 2, basis: "followers", followers: 50_000 });
    expect(reliableEr(st, { instagram: 10_000 }).er).toBeNull();
  });
  it("Instagram + TikTok sans couverture partout → pas de taux global", () => {
    const st = [s("Reel", { reach: 50_000, likes: 5000 }), s("TikTok", { likes: 9000 })];
    expect(singlePlatform(st)).toBeNull();
    expect(reliableEr(st, { instagram: 30_000, tiktok: 200_000 })).toEqual({ er: null, basis: null, followers: 0 });
  });
  it("repère « bon taux » unique", () => {
    expect(GOOD_ER_REACH).toBe(4);
    expect(erVerdict(GOOD_ER_REACH)?.label).toBe("Bon");
    expect(erVerdict(GOOD_ER_REACH - 0.1)?.label).toBe("Correct");
  });
});
