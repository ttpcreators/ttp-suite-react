import { describe, it, expect } from "vitest";
import { parseAmount, parseAmountStrict, formatEuro } from "./money";

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

describe("parseAmount séparateurs mixtes", () => {
  it("point = milliers, virgule = décimale", () => {
    expect(parseAmount("1.234,50")).toBe(1234.5);
    expect(parseAmount("5.000 €")).toBe(5000);
    expect(parseAmount("1.234.567")).toBe(1234567);
  });

  it("espace = milliers, virgule = décimale", () => {
    expect(parseAmount("1 234,50")).toBe(1234.5);
    expect(parseAmount("12,5")).toBe(12.5);
  });

  it("point décimal seul (format anglais)", () => {
    expect(parseAmount("1234.5")).toBe(1234.5);
    expect(parseAmount("0.500")).toBe(0.5);
    expect(parseAmount("1,234.50")).toBe(1234.5);
  });
});

describe("formatEuro", () => {
  it("se termine par l'euro", () => {
    expect(formatEuro(3000).endsWith("€")).toBe(true);
    expect(formatEuro(1615.2).replace(/\s/g, " ")).toBe("1 615,20 €");
    expect(formatEuro(600).replace(/\s/g, " ")).toBe("600 €");
    expect(formatEuro(0).endsWith("€")).toBe(true);
  });

  it("round-trip parseAmount(formatEuro(n)) === n (invariant clé)", () => {
    for (const n of [0, 500, 3000, 1200.5, 42000, 1_500_000]) {
      expect(parseAmount(formatEuro(n))).toBe(n);
    }
  });
});

describe("suffixes k / M (F2)", () => {
  it("k ou K = ×1000, M = ×1 000 000 (avant : « 3k » lu 3)", () => {
    expect(parseAmount("3k")).toBe(3000);
    expect(parseAmount("3K")).toBe(3000);
    expect(parseAmount("1,5k€")).toBe(1500);
    expect(parseAmount("3 K€")).toBe(3000);
    expect(parseAmount("2M")).toBe(2_000_000);
    expect(parseAmount("1,5 M€")).toBe(1_500_000);
  });
  it("un mot qui commence par m/k n'est pas un suffixe", () => {
    expect(parseAmount("3 mois")).toBe(3);
    expect(parseAmount("1 500 € HT")).toBe(1500);
  });
});

describe("parseAmountStrict : une saisie ambiguë ne donne jamais un nombre faux (F2)", () => {
  it("plusieurs nombres → null (avant : « 800 € x 2 » lu 8002, « 2 x 500 € » lu 2500)", () => {
    expect(parseAmountStrict("800 € x 2")).toBeNull();
    expect(parseAmountStrict("2 x 500 €")).toBeNull();
    expect(parseAmountStrict("1 000 + 500")).toBeNull();
    expect(parseAmountStrict("800 / 1 000 €")).toBeNull();
    expect(parseAmountStrict("500 et 300")).toBeNull();
    expect(parseAmountStrict("800-1000 €")).toBeNull();
  });
  it("vide ou illisible → null", () => {
    expect(parseAmountStrict("")).toBeNull();
    expect(parseAmountStrict(null)).toBeNull();
    expect(parseAmountStrict("N/A")).toBeNull();
    expect(parseAmountStrict(Number.NaN)).toBeNull();
  });
  it("un seul montant → le nombre, comme parseAmount", () => {
    expect(parseAmountStrict("3 000 €")).toBe(3000);
    expect(parseAmountStrict("1 200,50 €")).toBe(1200.5);
    expect(parseAmountStrict("1.234,50")).toBe(1234.5);
    expect(parseAmountStrict("12 000 000 €")).toBe(12_000_000);
    expect(parseAmountStrict("-500 €")).toBe(-500);
    expect(parseAmountStrict("1,5k€")).toBe(1500);
    expect(parseAmountStrict(formatEuro(42000))).toBe(42000);
    expect(parseAmountStrict(1234.5)).toBe(1234.5);
  });
});

describe("formatEuro : arrondi et valeurs limites", () => {
  const f = (n: number) => formatEuro(n).replace(/\s/g, " ");
  it("arrondit au centime avant de choisir le format", () => {
    expect(f(1200.004)).toBe("1 200 €");
    expect(f(999.995)).toBe("1 000 €");
    expect(f(0.1 + 0.2)).toBe("0,30 €");
    expect(f(-12.5)).toBe("-12,50 €");
  });
  it("jamais « -0 € » ni « NaN € »", () => {
    expect(f(-0.004)).toBe("0 €");
    expect(f(NaN)).toBe("— €");
    expect(f(Infinity)).toBe("— €");
  });
});
