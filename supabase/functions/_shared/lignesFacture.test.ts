import { describe, expect, it } from "vitest";
import { PRIX_MAX, QTE_MAX, lireLignes, problemeTaux, problemeTotalHt } from "./lignesFacture.ts";

const lib = (v: unknown) => String(v ?? "").trim();

describe("factures et devis du connecteur : bornes", () => {
  it("quantité absente = 1, quantité et prix gardés tels quels", () => {
    const r = lireLignes([{ libelle: "Reel", prix_ht: 800 }, { libelle: "Story", quantite: 3, prix_ht: "150" }], "l", lib);
    expect(r).toEqual({ items: [{ id: "l0", label: "Reel", qty: 1, unit: 800 }, { id: "l1", label: "Story", qty: 3, unit: 150 }] });
  });

  it("refuse une quantité négative, nulle, trop grande ou illisible", () => {
    for (const quantite of [-1, 0, QTE_MAX + 1, "abc", Infinity]) {
      const r = lireLignes([{ libelle: "Reel", quantite, prix_ht: 100 }], "l", lib);
      expect("error" in r && r.error).toMatch(/^Ligne 1 : quantité refusée/);
    }
  });

  it("refuse un prix illisible, garde une remise négative", () => {
    expect("error" in lireLignes([{ libelle: "X", prix_ht: "beaucoup" }], "l", lib)).toBe(true);
    expect("error" in lireLignes([{ libelle: "X" }], "l", lib)).toBe(true);
    expect(lireLignes([{ libelle: "Remise", prix_ht: -50 }], "l", lib)).toEqual({ items: [{ id: "l0", label: "Remise", qty: 1, unit: -50 }] });
    expect(lireLignes([{ libelle: "X", prix_ht: PRIX_MAX }], "l", lib)).toEqual({ items: [{ id: "l0", label: "X", qty: 1, unit: PRIX_MAX }] });
    for (const prix_ht of [PRIX_MAX + 1, -(PRIX_MAX + 1), 1e15]) {
      const r = lireLignes([{ libelle: "X", prix_ht }], "l", lib);
      expect("error" in r && r.error).toMatch(/^Ligne 1 : prix HT refusé/);
    }
  });

  it("commission entre 0 et 100, TVA parmi les taux français", () => {
    expect(problemeTaux({})).toBeNull();
    expect(problemeTaux({ commission: 20, tva: 5.5 })).toBeNull();
    expect(problemeTaux({ commission: 0, tva: 0 })).toBeNull();
    expect(problemeTaux({ commission: 150 })).toMatch(/Commission/);
    expect(problemeTaux({ commission: -50 })).toMatch(/Commission/);
    expect(problemeTaux({ tva: 7 })).toMatch(/TVA/);
    expect(problemeTaux({ tva: "20" })).toMatch(/TVA/);
  });

  it("total HT plus grand que 0", () => {
    expect(problemeTotalHt(500)).toBeNull();
    expect(problemeTotalHt(0)).toMatch(/avoir/);
    expect(problemeTotalHt(-800)).toMatch(/avoir/);
    expect(problemeTotalHt(NaN)).toMatch(/avoir/);
  });
});
