import { describe, it, expect } from "vitest";
import { engagementBarPct, engagementTone, nextScoutStep, sortScouting, stepState, type SortKeys } from "./scouting";

describe("engagementTone", () => {
  it("bon à partir de 3 %, moyen de 1 à 3 %, faible sous 1 %", () => {
    expect(engagementTone(3.89)).toBe("ok");
    expect(engagementTone(3)).toBe("ok");
    expect(engagementTone(2.99)).toBe("wait");
    expect(engagementTone(1)).toBe("wait");
    expect(engagementTone(0.99)).toBe("closed");
    expect(engagementTone(0)).toBe("closed");
  });
  it("inconnu : rien", () => {
    expect(engagementTone(null)).toBeNull();
    expect(engagementTone(undefined)).toBeNull();
    expect(engagementTone(Number.NaN)).toBeNull();
  });
});

describe("engagementBarPct", () => {
  it("proportionnelle, pleine à 6 %", () => {
    expect(engagementBarPct(3)).toBe(50);
    expect(engagementBarPct(6)).toBe(100);
    expect(engagementBarPct(12)).toBe(100);
  });
  it("jamais invisible quand il y a un chiffre, vide sinon", () => {
    expect(engagementBarPct(0.05)).toBe(4);
    expect(engagementBarPct(0)).toBe(0);
    expect(engagementBarPct(null)).toBe(0);
  });
});

describe("étapes du parcours", () => {
  it("étape suivante", () => {
    expect(nextScoutStep("observation")).toBe("contacter");
    expect(nextScoutStep("contacter")).toBe("discussion");
    expect(nextScoutStep("discussion")).toBe("signe");
    expect(nextScoutStep("signe")).toBeNull();
    expect(nextScoutStep("ecarte")).toBe("observation");
  });
  it("faite, en cours, à venir", () => {
    expect(stepState("observation", "discussion")).toBe("done");
    expect(stepState("discussion", "discussion")).toBe("current");
    expect(stepState("signe", "discussion")).toBe("todo");
    expect(stepState("observation", "ecarte")).toBe("todo");
  });
});

describe("sortScouting", () => {
  type R = { id: string } & SortKeys;
  const rows: R[] = [
    { id: "a", name: "Zoé", followers: 1200, er: 2.1, growth: 10 },
    { id: "b", name: "élodie", followers: null, er: null, growth: null },
    { id: "c", name: "Bastien", followers: 98000, er: 4.5, growth: -300 },
    { id: "d", name: "Amel", followers: 1200, er: 0.8, growth: 50 },
  ];
  const ids = (list: R[]) => list.map((r) => r.id).join("");
  const keys = (r: R) => r;

  it("abonnés : du plus grand au plus petit, inconnus en bas, égalité = ordre reçu", () => {
    expect(ids(sortScouting(rows, "abonnes", keys))).toBe("cadb");
  });
  it("engagement et évolution", () => {
    expect(ids(sortScouting(rows, "engagement", keys))).toBe("cadb");
    expect(ids(sortScouting(rows, "evolution", keys))).toBe("dacb");
  });
  it("nom : ordre alphabétique français, sans tenir compte des accents ni des majuscules", () => {
    expect(ids(sortScouting(rows, "nom", keys))).toBe("dcba");
  });
  it("ajout : ordre de la base, sans modifier la liste d'origine", () => {
    const out = sortScouting(rows, "ajout", keys);
    expect(ids(out)).toBe("abcd");
    expect(out).not.toBe(rows);
  });
});
