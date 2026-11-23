import { describe, expect, it } from "vitest";
import { colKey, filled, sortByAction } from "./briefStatus";

describe("colKey", () => {
  it("range les statuts stockés dans leur colonne", () => {
    expect(colKey("Terminé")).toBe("terminé");
    expect(colKey("termine")).toBe("terminé");
    expect(colKey("En cours")).toBe("cours");
    expect(colKey("À valider")).toBe("valider");
    expect(colKey("attente")).toBe("attente");
    expect(colKey("")).toBe("attente");
    expect(colKey(null)).toBe("attente");
  });
});

describe("sortByAction", () => {
  it("met À valider en premier et les terminés à la fin, en gardant l'ordre manuel", () => {
    const rows = [
      { id: "a", status: "terminé" },
      { id: "b", status: "attente" },
      { id: "c", status: "valider" },
      { id: "d", status: "cours" },
      { id: "e", status: "terminé" },
      { id: "f", status: "valider" },
    ];
    expect(sortByAction(rows).map((r) => r.id)).toEqual(["c", "f", "d", "b", "a", "e"]);
  });

  it("ne modifie pas la liste d'origine", () => {
    const rows = [{ status: "terminé" }, { status: "valider" }];
    sortByAction(rows);
    expect(rows[0].status).toBe("terminé");
  });
});

describe("filled", () => {
  it("traite les tirets et les blancs comme un champ vide", () => {
    expect(filled("—")).toBe("");
    expect(filled(" - ")).toBe("");
    expect(filled("")).toBe("");
    expect(filled(null)).toBe("");
    expect(filled(undefined)).toBe("");
    expect(filled(" 1 500 € ")).toBe("1 500 €");
  });
});
