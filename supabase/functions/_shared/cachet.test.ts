import { describe, expect, it } from "vitest";
import { AFFILIATION_SEULE, ecrireCachet, lireCachet, normaliserCachet } from "./cachet.ts";

describe("ecrireCachet", () => {
  it("écrit le montant et le signe de la devise", () => {
    expect(ecrireCachet({ montant: 550, devise: "EUR", affiliation: false })).toBe("550 €");
    expect(ecrireCachet({ montant: 1500, devise: "USD", affiliation: false })).toBe("1 500 $");
    expect(ecrireCachet({ montant: 300, devise: "GBP", affiliation: false })).toBe("300 £");
    expect(ecrireCachet({ montant: 800, devise: "CHF", affiliation: false })).toBe("800 CHF");
    expect(ecrireCachet({ montant: 1250.5, devise: "EUR", affiliation: false })).toBe("1 250,50 €");
  });
  it("affiliation seule ou en plus", () => {
    expect(ecrireCachet({ montant: null, devise: "EUR", affiliation: true })).toBe(AFFILIATION_SEULE);
    expect(ecrireCachet({ montant: 550, devise: "EUR", affiliation: true })).toBe("550 € + affiliation");
  });
  it("rien de saisi : null ; 0 reste un montant (gifting)", () => {
    expect(ecrireCachet({ montant: null, devise: "EUR", affiliation: false })).toBeNull();
    expect(ecrireCachet({ montant: 0, devise: "EUR", affiliation: false })).toBe("0 €");
    expect(ecrireCachet({ montant: -5, devise: "EUR", affiliation: false })).toBeNull();
  });
});

describe("lireCachet", () => {
  it("relit ce que l'app écrit", () => {
    for (const c of [
      { montant: 550, devise: "EUR", affiliation: false },
      { montant: 12000, devise: "USD", affiliation: true },
      { montant: 300.25, devise: "GBP", affiliation: false },
      { montant: 800, devise: "CHF", affiliation: true },
      { montant: null, devise: "EUR", affiliation: true },
    ] as const) {
      expect(lireCachet(ecrireCachet(c))).toEqual({ ...c, lisible: true });
    }
  });
  it("lit les anciennes saisies propres", () => {
    expect(lireCachet("500€")).toMatchObject({ montant: 500, devise: "EUR", lisible: true });
    expect(lireCachet("$550")).toMatchObject({ montant: 550, devise: "USD", lisible: true });
    expect(lireCachet("550 usd")).toMatchObject({ montant: 550, devise: "USD", lisible: true });
    expect(lireCachet("1.500 €")).toMatchObject({ montant: 1500, devise: "EUR", lisible: true });
    expect(lireCachet("1 500,50 €")).toMatchObject({ montant: 1500.5, lisible: true });
    expect(lireCachet("1,5k €")).toMatchObject({ montant: 1500, lisible: true });
    expect(lireCachet("400 € HT")).toMatchObject({ montant: 400, lisible: true });
    expect(lireCachet("1200")).toMatchObject({ montant: 1200, devise: "EUR", lisible: true });
    expect(lireCachet("affiliation")).toMatchObject({ montant: null, affiliation: true, lisible: true });
    expect(lireCachet("500 € et affiliation")).toMatchObject({ montant: 500, affiliation: true, lisible: true });
  });
  it("ne devine pas : texte gardé tel quel", () => {
    for (const t of ["300 € + produits offerts", "Gifting", "2 x 500 €", "800 / 1 000 €", "Affiliation + Repas", "500 € ou 600 $", "Affiliation seule, 30 % sur l'abonnement"]) {
      expect(lireCachet(t).lisible).toBe(false);
    }
  });
  it("vide : lisible, rien à pré-remplir", () => {
    expect(lireCachet("")).toEqual({ montant: null, devise: "EUR", affiliation: false, lisible: true });
    expect(lireCachet(null).lisible).toBe(true);
    expect(lireCachet("—").montant).toBeNull();
  });
});

describe("normaliserCachet", () => {
  it("met à la forme de l'app ce qui se lit, garde le reste", () => {
    expect(normaliserCachet("1500 euros")).toBe("1 500 €");
    expect(normaliserCachet("550 usd + affiliation")).toBe("550 $ + affiliation");
    expect(normaliserCachet("affiliation seule")).toBe(AFFILIATION_SEULE);
    expect(normaliserCachet("Gifting")).toBe("Gifting");
    expect(normaliserCachet("  ")).toBeNull();
  });
});
