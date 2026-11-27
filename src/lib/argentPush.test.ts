import { describe, expect, it } from "vitest";
import { factureDonneReversement, marquesDuVersement, objetMarques } from "./argentPush";

describe("factureDonneReversement", () => {
  it("facture de la marque encaissée par l'agence : oui", () => {
    expect(factureDonneReversement({ collabId: "c1" }, {})).toBe(true);
    expect(factureDonneReversement({ collabId: "c1" }, { c1: "agence" })).toBe(true);
    expect(factureDonneReversement({}, {})).toBe(true);
  });
  it("facture de commission, ou marque qui paie le créateur en direct : non", () => {
    expect(factureDonneReversement({ kind: "commission", collabId: "c1" }, {})).toBe(false);
    expect(factureDonneReversement({ collabId: "c1" }, { c1: "createur" })).toBe(false);
  });
});

describe("marquesDuVersement", () => {
  const lignes = [
    { id: "i2", brand: "Marque Beta × Créatrice", paidOn: "2026-11-10", du: 300 },
    { id: "i1", brand: "Marque Alpha × Créatrice", paidOn: "2026-10-01", du: 200 },
  ];
  it("le versement couvre d'abord la facture la plus ancienne", () => {
    expect(marquesDuVersement(lignes, 0, 200)).toEqual(["Marque Alpha"]);
    expect(marquesDuVersement(lignes, 0, 500)).toEqual(["Marque Alpha", "Marque Beta"]);
  });
  it("ce qui est déjà versé couvre les plus anciennes : le nouveau versement va aux suivantes", () => {
    expect(marquesDuVersement(lignes, 200, 100)).toEqual(["Marque Beta"]);
  });
  it("rien de dû (avance, trop versé) : aucune marque", () => {
    expect(marquesDuVersement(lignes, 500, 100)).toEqual([]);
    expect(marquesDuVersement([], 0, 100)).toEqual([]);
  });
  it("une même marque n'est citée qu'une fois", () => {
    expect(marquesDuVersement([...lignes, { id: "i3", brand: "MARQUE ALPHA", paidOn: "2026-11-20", du: 50 }], 0, 1000)).toEqual(["Marque Alpha", "Marque Beta"]);
  });
});

describe("objetMarques", () => {
  it("trois marques au plus", () => {
    expect(objetMarques(["A"])).toBe("A");
    expect(objetMarques(["A", "B"])).toBe("A, B");
    expect(objetMarques(["A", "B", "C", "D"])).toBe("A, B, C…");
    expect(objetMarques([])).toBe("");
  });
});
