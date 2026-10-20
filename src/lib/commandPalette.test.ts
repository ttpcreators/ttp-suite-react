import { describe, expect, it } from "vitest";
import { firstName, rankEntries, relanceActionLabel, scoreMatch, stepIndex } from "./commandPalette";

describe("palette ⌘K : classement", () => {
  it("début de libellé > début de mot > contient > mot-clé", () => {
    expect(scoreMatch("rel", "Relances")).toBe(100);
    expect(scoreMatch("lena", "Relancer JNPR × Léna")).toBe(80);
    expect(scoreMatch("ance", "Relances")).toBe(60);
    expect(scoreMatch("impaye", "Relances", ["impayé", "retard"])).toBe(50);
    expect(scoreMatch("zzz", "Relances")).toBe(0);
  });

  it("accents et casse ignorés, requête vide = tout", () => {
    expect(scoreMatch("ECHEANCES", "Échéances")).toBe(100);
    expect(scoreMatch("  ", "Planning")).toBe(1);
  });

  it("plusieurs mots : chaque mot doit se retrouver", () => {
    expect(scoreMatch("facture retard", "Relancer les 3 factures", ["en retard"])).toBe(30);
    expect(scoreMatch("facture paye", "Relancer les 3 factures", ["en retard"])).toBe(0);
  });

  it("rankEntries trie par score, garde l'ordre à égalité et coupe à la limite", () => {
    const pages = [{ label: "Facturation" }, { label: "Relances", keywords: ["relancer"] }, { label: "Échéances" }, { label: "Relances bis" }];
    expect(rankEntries(pages, "relan").map((p) => p.label)).toEqual(["Relances", "Relances bis"]);
    expect(rankEntries(pages, "ances", 1).map((p) => p.label)).toEqual(["Relances"]);
    expect(rankEntries(pages, "")).toHaveLength(4);
  });
});

describe("palette ⌘K : libellés et navigation", () => {
  it("relance courte : marque × prénom", () => {
    expect(firstName("LÉNA PASQUALE")).toBe("Léna");
    expect(relanceActionLabel({ party: "JNPR", creator: "LÉNA PASQUALE" })).toBe("Relancer JNPR × Léna");
    expect(relanceActionLabel({ party: "Sanytol", creator: null })).toBe("Relancer Sanytol");
  });

  it("flèches en boucle", () => {
    expect(stepIndex(0, -1, 3)).toBe(2);
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(0, 1, 0)).toBe(0);
  });
});
