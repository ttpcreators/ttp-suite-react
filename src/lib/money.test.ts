import { describe, it, expect } from "vitest";
import { parseAmount, formatEuro } from "./money";

describe("parseAmount", () => {
  it("lit les montants FR (espace = milliers, virgule = décimale)", () => {
    expect(parseAmount("3 000 €")).toBe(3000);
    expect(parseAmount("1 200,50 €")).toBe(1200.5);
    expect(parseAmount("2000 €")).toBe(2000);
    expect(parseAmount("500")).toBe(500);
    expect(parseAmount("42 000 €")).toBe(42000);
  });

  it("NE multiplie PAS par 100 les décimales à zéro (bug historique)", () => {
    expect(parseAmount("3 000,00 €")).toBe(3000);
    expect(parseAmount("1 500,00")).toBe(1500);
    expect(parseAmount("2 000,00 €")).toBe(2000);
  });

  it("vide / tiret / non numérique → 0", () => {
    expect(parseAmount("")).toBe(0);
    expect(parseAmount("—")).toBe(0);
    expect(parseAmount(null)).toBe(0);
    expect(parseAmount(undefined)).toBe(0);
    expect(parseAmount("N/A")).toBe(0);
  });

  it("gère les négatifs (avoirs)", () => {
    expect(parseAmount("-500 €")).toBe(-500);
  });

  it("accepte déjà un nombre", () => {
    expect(parseAmount(1234.5)).toBe(1234.5);
    expect(parseAmount(0)).toBe(0);
  });
});

describe("formatEuro", () => {
  it("se termine par l'euro", () => {
    expect(formatEuro(3000).endsWith("€")).toBe(true);
    expect(formatEuro(0).endsWith("€")).toBe(true);
  });

  it("round-trip parseAmount(formatEuro(n)) === n (invariant clé)", () => {
    for (const n of [0, 500, 3000, 1200.5, 42000, 1_500_000]) {
      expect(parseAmount(formatEuro(n))).toBe(n);
    }
  });
});
