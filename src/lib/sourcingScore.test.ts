import { describe, it, expect } from "vitest";
import { erRef, instagramBreakdown, scoreBreakdown, scoreOf, scoreTone, youtubeBreakdown, type ScoreInput } from "./sourcingScore";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

/** L'ancien calcul (Sourcing.tsx avant le panneau « Pourquoi »), recopié tel quel : la note ne doit pas bouger. */
function legacyIg(d: ScoreInput): number {
  const f = d.followers ?? 0;
  const ref = erRef(f);
  let flags = 0;
  let s = 0;
  if (d.er != null) s += Math.min(40, (d.er / ref) * 30);
  s += Math.min(15, (d.perWeek ?? 0) * 5);
  if (d.deals?.length) s += 15;
  if (d.email) s += 10;
  if (!d.agency) s += 10;
  const quiet = d.lastPost ? (NOW - Date.parse(d.lastPost)) / 86400000 : 999;
  if (quiet < 14) s += 10;
  if (d.er != null && d.er < ref * 0.25) flags++;
  if ((d.following ?? 0) > f && f < 50_000) flags++;
  if (quiet > 60 && quiet < 999) flags++;
  s -= flags * 15;
  return Math.max(0, Math.min(100, Math.round(s)));
}
function legacyYt(d: ScoreInput): number {
  const f = d.followers ?? 0;
  let flags = 0;
  let s = 0;
  const vr = d.avgViews != null && f > 0 ? d.avgViews / f : null;
  if (vr != null) s += Math.min(30, (vr / 0.25) * 22);
  else if (d.avgViews) s += 15;
  if (d.er != null) s += Math.min(10, (d.er / 4) * 8);
  s += Math.min(15, (d.perWeek ?? 0) * 10);
  if (d.deals?.length || d.sponsored) s += 15;
  if (d.email) s += 10;
  if (!d.agency) s += 10;
  const quiet = d.lastPost ? (NOW - Date.parse(d.lastPost)) / 86400000 : 999;
  if (quiet < 30) s += 10;
  if (vr != null && vr < 0.02) flags++;
  if (quiet > 90 && quiet < 999) flags++;
  s -= flags * 15;
  return Math.max(0, Math.min(100, Math.round(s)));
}

const IG: ScoreInput[] = [
  {},
  { followers: 24_000, er: 6.1, perWeek: 1.2, lastPost: daysAgo(3), email: "a@b.fr", deals: ["nike"] },
  { followers: 24_000, er: 0.5, perWeek: 0.2, lastPost: daysAgo(70), following: 30_000, agency: "management" },
  { followers: 8_000, er: 5, perWeek: 3, lastPost: daysAgo(20) },
  { followers: 1_500_000, er: 1.3, perWeek: null, lastPost: null, email: "x@y.com" },
];
const YT: ScoreInput[] = [
  { platform: "youtube" },
  { platform: "youtube", followers: 50_000, avgViews: 20_000, er: 4.5, perWeek: 2, lastPost: daysAgo(4), sponsored: 2, email: "a@b.fr" },
  { platform: "youtube", followers: 200_000, avgViews: 1_000, er: 0.5, perWeek: 0.1, lastPost: daysAgo(120), agency: "booking" },
  { platform: "youtube", avgViews: 3_000, perWeek: 1 },
];

describe("score Potentiel : même note qu'avant", () => {
  it("Instagram", () => {
    for (const d of IG) expect(scoreOf(d, NOW).score).toBe(legacyIg(d));
  });
  it("YouTube", () => {
    for (const d of YT) expect(scoreOf(d, NOW).score).toBe(legacyYt(d));
  });
});

describe("détail du score", () => {
  it("la note = somme des points des facteurs, moins 15 par alerte (bornée)", () => {
    for (const d of [...IG, ...YT]) {
      const b = scoreBreakdown(d, NOW);
      const raw = b.factors.reduce((s, f) => s + f.points, 0) - b.penalty;
      expect(b.score).toBe(Math.max(0, Math.min(100, Math.round(raw))));
      expect(b.penalty).toBe(b.flags.length * 15);
      for (const f of b.factors) {
        expect(f.points).toBeGreaterThanOrEqual(0);
        expect(f.points).toBeLessThanOrEqual(f.max);
      }
    }
  });
  it("les plafonds font 100 points au total sur chaque réseau", () => {
    expect(instagramBreakdown({}, NOW).factors.reduce((s, f) => s + f.max, 0)).toBe(100);
    expect(youtubeBreakdown({ platform: "youtube" }, NOW).factors.reduce((s, f) => s + f.max, 0)).toBe(100);
  });
  it("verdicts Instagram lus sur les seuils du calcul", () => {
    const b = instagramBreakdown(IG[1], NOW);
    const by = Object.fromEntries(b.factors.map((f) => [f.key, f]));
    expect(by.er.verdict).toBe("Excellent"); // 6,1 % pour 24k : au-delà du plafond de 40 points
    expect(by.er.tone).toBe("ok");
    expect(by.email.verdict).toBe("Trouvé");
    expect(by.agency.verdict).toBe("Sans agence");
    expect(by.active.verdict).toBe("Récente");
    const low = Object.fromEntries(instagramBreakdown(IG[2], NOW).factors.map((f) => [f.key, f]));
    expect(low.er.verdict).toBe("Très bas");
    expect(low.email.verdict).toBe("Absent");
    expect(low.email.tone).toBe("closed");
    expect(low.agency.tone).toBe("wait");
    expect(low.active.verdict).toBe("Pas récente");
    expect(instagramBreakdown(IG[2], NOW).flags).toHaveLength(3);
  });
  it("chiffre inconnu : verdict « Inconnu », zéro point", () => {
    const by = Object.fromEntries(instagramBreakdown({}, NOW).factors.map((f) => [f.key, f]));
    expect(by.er).toMatchObject({ verdict: "Inconnu", points: 0 });
    expect(by.rhythm).toMatchObject({ verdict: "Inconnu", points: 0 });
    expect(by.active).toMatchObject({ verdict: "Inconnue", points: 0 });
  });
  it("YouTube : abonnés masqués jugés sur les vues seules", () => {
    const views = youtubeBreakdown(YT[3], NOW).factors.find((f) => f.key === "views");
    expect(views).toMatchObject({ points: 15, verdict: "Abonnés masqués", tone: "wait" });
  });
});

describe("couleur de l'anneau", () => {
  it("vert dès 70, orange de 40 à 69, gris en dessous", () => {
    expect(scoreTone(100)).toBe("ok");
    expect(scoreTone(70)).toBe("ok");
    expect(scoreTone(69)).toBe("wait");
    expect(scoreTone(40)).toBe("wait");
    expect(scoreTone(39)).toBe("closed");
    expect(scoreTone(0)).toBe("closed");
  });
});
