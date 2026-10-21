import { describe, expect, it } from "vitest";
import { briefResumePrompt, cleanList, hasResume, parseResume, textToList } from "./briefResume";

describe("résumé de brief", () => {
  it("nettoie les listes : puces, tirets longs, vides, longueur", () => {
    expect(cleanList(["- Montrer le produit", "• 2 reels — 30 s", "  ", 3])).toEqual(["Montrer le produit", "2 reels, 30 s", "3"]);
    expect(cleanList("pas une liste")).toEqual([]);
    expect(cleanList(Array.from({ length: 20 }, (_, i) => `p${i}`))).toHaveLength(10);
  });
  it("lit la colonne avec tolérance", () => {
    expect(parseResume(null)).toBeNull();
    expect(parseResume({ faire: [], eviter: [] })).toBeNull();
    const r = parseResume({ faire: ["Montrer la gourde"], mentions: ["#ad"], par: "claude", maj_le: "2026-10-21T10:00:00Z" });
    expect(r?.faire).toEqual(["Montrer la gourde"]);
    expect(r?.eviter).toEqual([]);
    expect(r?.par).toBe("claude");
    expect(hasResume(r)).toBe(true);
  });
  it("une ligne = un point", () => {
    expect(textToList("1. Hook en 3 s\n\n2) Pas de concurrent")).toEqual(["Hook en 3 s", "Pas de concurrent"]);
  });
  it("la demande cite le brief et les deux outils", () => {
    const p = briefResumePrompt({ id: "abc", brand: "Nike", creator: "Sarah" });
    expect(p).toContain("lire_brief (brief abc)");
    expect(p).toContain("resumer_brief (brief abc)");
    expect(p).not.toMatch(/[—–]/);
  });
});
