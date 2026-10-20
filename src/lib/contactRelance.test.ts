import { describe, expect, it } from "vitest";
import { agoLabel, agoShort, relanceCountdown, relanceInfo } from "./contactRelance";
import { needsRelance, type Touch } from "./touches";

const DAY = 86400000;
const NOW = new Date("2026-10-20T12:00:00Z").getTime();
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();
const touch = (daysAgo: number, kind: Touch["kind"] = "contact"): Touch => ({ id: `t${daysAgo}`, date: iso(daysAgo), canal: "email", kind });

describe("relanceInfo", () => {
  it("jamais contacté : rien à relancer", () => {
    expect(relanceInfo([], null, 45, NOW)).toEqual({ contacted: false, days: null, due: false, daysLeft: null, progress: 0 });
  });

  it("dernier échange il y a 22 jours sur un cycle de 45 : dans 23 jours", () => {
    const r = relanceInfo([touch(22)], null, 45, NOW);
    expect(r.contacted).toBe(true);
    expect(r.days).toBe(22);
    expect(r.due).toBe(false);
    expect(r.daysLeft).toBe(23);
    expect(r.progress).toBeCloseTo(22 / 45);
  });

  it("pile au seuil : à relancer, comme needsRelance", () => {
    const list = [touch(45)];
    const r = relanceInfo(list, null, 45, NOW);
    expect(r.due).toBe(true);
    expect(r.daysLeft).toBe(0);
    expect(r.progress).toBe(1);
  });

  it("prend la plus récente entre touches et dernier mail sortant", () => {
    const r = relanceInfo([touch(120)], iso(10), 45, NOW);
    expect(r.days).toBe(10);
    expect(r.due).toBe(false);
  });

  it("une réponse reçue remet le compteur à zéro", () => {
    const r = relanceInfo([touch(90), touch(3, "reponse")], null, 45, NOW);
    expect(r.days).toBe(3);
    expect(r.daysLeft).toBe(42);
  });

  it("seuil invalide ou nul : un jour minimum", () => {
    expect(relanceInfo([touch(2)], null, 0, NOW).due).toBe(true);
    expect(relanceInfo([touch(0)], null, Number.NaN, NOW).daysLeft).toBe(1);
  });

  it("date dans le futur : pas de jours négatifs", () => {
    const r = relanceInfo([touch(-3)], null, 45, NOW);
    expect(r.days).toBe(0);
    expect(r.progress).toBe(0);
    expect(r.due).toBe(false);
  });

  it("concorde avec needsRelance (horloge réelle)", () => {
    for (const d of [0, 10, 44, 45, 46, 200]) {
      const list = [{ id: "x", date: new Date(Date.now() - d * DAY - 1000).toISOString(), canal: "email" as const, kind: "contact" as const }];
      expect(relanceInfo(list, null, 45).due).toBe(needsRelance(list, null, 45));
    }
  });
});

describe("libellés", () => {
  it("agoShort", () => {
    expect(agoShort(5)).toBe("5 j");
    expect(agoShort(29)).toBe("29 j");
    expect(agoShort(30)).toBe("1 mois");
    expect(agoShort(120)).toBe("4 mois");
    expect(agoShort(365)).toBe("1 an");
    expect(agoShort(800)).toBe("2 ans");
  });

  it("agoLabel", () => {
    expect(agoLabel(null)).toBe("Jamais contacté");
    expect(agoLabel(0)).toBe("Aujourd'hui");
    expect(agoLabel(1)).toBe("Hier");
    expect(agoLabel(22)).toBe("Il y a 22 j");
    expect(agoLabel(125)).toBe("Il y a 4 mois");
  });

  it("relanceCountdown", () => {
    expect(relanceCountdown(null)).toBe("");
    expect(relanceCountdown(0)).toBe("maintenant");
    expect(relanceCountdown(1)).toBe("demain");
    expect(relanceCountdown(23)).toBe("dans 23 jours");
  });
});
