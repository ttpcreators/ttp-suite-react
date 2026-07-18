import { describe, it, expect } from "vitest";
import { parseNum, totalsOf, fmtCompact, fmtPct, emptyStat, type PostStat } from "./engagement";

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
    expect(fmtCompact(480_000)).toBe("480 K");
    expect(fmtCompact(1_240_000)).toBe("1,24 M");
    // Sous 10 K → chiffre exact, pas « 9 K ». Séparateur = espace fine insécable
    // (U+202F), la typographie française rendue par toLocaleString('fr-FR').
    expect(fmtCompact(9_200)).toBe("9 200");
    expect(fmtCompact(0)).toBe("0");
  });
  it("fmtPct", () => {
    expect(fmtPct(6.42)).toBe("6,4 %");
    expect(fmtPct(5)).toBe("5 %");
    expect(fmtPct(null)).toBe("—");
  });
});
