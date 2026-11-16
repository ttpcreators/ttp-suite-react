import { describe, expect, it } from "vitest";
import { construireBase, filtrerBase, guessVille, ligneBase, type BaseRow } from "./baseCreateurs.ts";

const NOW = Date.parse("2026-11-16T12:00:00Z");
const jours = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const rows: BaseRow[] = [
  { username: "lea.runs", data: { name: "Léa", followers: 48200, er: 4.8, bio: "Running & fitness 📍Lyon", lastPost: jours(3), deals: ["nike"] } },
  { username: "camille", data: { name: "Camille", followers: 126000, er: 2.9, bio: "Mode, Paris", lastPost: jours(60), agency: "Agence X" } },
  { username: "jade", data: { name: "Jade", followers: 9400, er: 7.2, bio: "Workout gym training", lastPost: jours(1) } },
  { username: "marque", data: { name: "Marque", followers: 90000, isBrand: true } },
  { username: "attente", data: { pending: true } },
  { username: "retiree", data: { name: "Retirée", followers: 50000, er: 3 } },
];
const meta = {
  jade: { username: "jade", niche: "Fitness", ville: "Lyon", note: "Super en vidéo", excluded: false },
  retiree: { username: "retiree", niche: null, ville: null, note: null, excluded: true },
};

describe("Base créateurs", () => {
  const base = construireBase(rows, meta, new Set(["jade"]), new Set());

  it("ne garde que les créateurs lus (pas les marques ni les profils en attente)", () => {
    expect(base.map((c) => c.username).sort()).toEqual(["camille", "jade", "lea.runs", "retiree"]);
  });

  it("devine niche et ville dans la bio, sauf si l'agence les a corrigées", () => {
    const lea = base.find((c) => c.username === "lea.runs")!;
    expect(lea.niche).toBe("Fitness");
    expect(lea.guessed).toBe(true);
    expect(lea.ville).toBe("Lyon");
    const jade = base.find((c) => c.username === "jade")!;
    expect(jade.guessed).toBe(false);
    expect(jade.tag).toBe("roster");
  });

  it("filtre comme la page : niche, ville, taille, engagement, actif, sans agence, hors TTP", () => {
    const u = (f: Parameters<typeof filtrerBase>[1]) => filtrerBase(base, f, NOW).map((c) => c.username);
    expect(u({ niche: "fitness", ville: "lyon" })).toEqual(["lea.runs", "jade"]);
    expect(u({ abonnesMin: 10000, abonnesMax: 100000 })).toEqual(["lea.runs"]);
    expect(u({ engagementMin: 4, tri: "engagement" })).toEqual(["jade", "lea.runs"]);
    expect(u({ actif30j: true, sansAgence: true, horsTtp: true })).toEqual(["lea.runs"]);
    expect(u({ avecPartenariats: true })).toEqual(["lea.runs"]);
    expect(u({ recherche: "nike" })).toEqual(["lea.runs"]);
  });

  it("ne montre jamais un créateur retiré (RGPD), sauf si on demande les retirés", () => {
    expect(filtrerBase(base, {}, NOW).some((c) => c.username === "retiree")).toBe(false);
    expect(filtrerBase(base, {}, NOW, true).map((c) => c.username)).toEqual(["retiree"]);
  });

  it("écrit une ligne lisible", () => {
    const l = ligneBase(base.find((c) => c.username === "jade")!, NOW);
    expect(l).toContain("@jade (Jade)");
    expect(l).toContain("9400 abonnés");
    expect(l).toContain("AU ROSTER");
    expect(l).toContain("note TTP : Super en vidéo");
  });

  it("devine la ville sans la confondre avec un autre mot", () => {
    expect(guessVille("📍Lyon · running")).toBe("Lyon");
    expect(guessVille("niçoise de coeur")).toBeNull();
  });
});
