import { describe, expect, it } from "vitest";
import { firstNameOf, giftCounts, giftObjet } from "./gifting";

describe("gifting : onglet de Collabs", () => {
  it("prénom lisible et compteurs", () => {
    expect(firstNameOf("LÉNA PASQUALE")).toBe("Léna");
    expect(giftCounts([
      { status: "recu", content_expected: true },
      { status: "publie", content_expected: true },
      { status: "refuse", content_expected: true },
      { status: "recu", content_expected: false },
    ])).toEqual({ total: 4, expected: 3, waiting: 1, published: 1 });
  });
});

describe("gifting : notification au créateur", () => {
  it("objet « Marque · produit », sans morceau vide", () => {
    expect(giftObjet({ brand: "Marque X", product: "Sérum" })).toBe("Marque X · Sérum");
    expect(giftObjet({ brand: " Marque X ", product: null })).toBe("Marque X");
    expect(giftObjet({ brand: null, product: "" })).toBe("");
  });
});
