import { describe, expect, it } from "vitest";
import { ligneMarqueChaude, lireMarqueChaude, texteMarquesChaudes } from "./marquesChaudes.ts";

describe("lireMarqueChaude", () => {
  it("relit une ligne de la fonction SQL", () => {
    const m = lireMarqueChaude({ marque: "teveo", payes: 16, createurs: ["a", "b", ""], roster: ["a"], dernier: "2026-11-19T11:56:06+00:00" });
    expect(m).toEqual({ marque: "teveo", payes: 16, createurs: ["a", "b"], roster: ["a"], dernier: "2026-11-19T11:56:06+00:00" });
  });
  it("refuse une ligne abîmée", () => {
    expect(lireMarqueChaude(null)).toBe(null);
    expect(lireMarqueChaude({ marque: " " })).toBe(null);
    expect(lireMarqueChaude({ marque: "x", payes: "3", createurs: "a" })).toEqual({ marque: "x", payes: 0, createurs: [], roster: [], dernier: null });
  });
});

describe("texte", () => {
  it("une ligne lisible", () => {
    const l = ligneMarqueChaude({ marque: "mango", payes: 3, createurs: ["c1", "c2"], roster: [], dernier: "2026-11-24T16:25:14+00:00" });
    expect(l).toBe("- @mango · 3 partenariats payés · 2 créateurs : @c1 @c2 · dernier 24 nov.");
  });
  it("signale le roster", () => {
    const l = ligneMarqueChaude({ marque: "teveo", payes: 1, createurs: ["lena"], roster: ["lena"], dernier: null });
    expect(l).toBe("- @teveo · 1 partenariat payé · 1 créateur : @lena · dont du roster : @lena (collab de l'agence ? vérifier avant d'écrire)");
  });
  it("liste vide", () => {
    expect(texteMarquesChaudes([], 30)).toContain("aucune");
  });
});
