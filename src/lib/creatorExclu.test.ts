import { describe, expect, it } from "vitest";
import { estExclusif, excluAEcrire, excluKey, hasExcluColumn } from "./creatorExclu";

describe("estExclusif", () => {
  it("exclusif si la colonne OU le blob dit oui", () => {
    expect(estExclusif({ exclu: true }, {}, "Léna Test")).toBe(true);
    // Colonne à son défaut false, exclusivité notée seulement dans le blob : reste exclusif.
    expect(estExclusif({ exclu: false }, { "léna test": true }, "LÉNA TEST")).toBe(true);
    expect(estExclusif({}, { "léna test": true }, "Léna Test")).toBe(true);
    expect(estExclusif({ exclu: null }, { "léna test": true }, "Léna Test")).toBe(true);
  });
  it("non exclusif si aucun des deux", () => {
    expect(estExclusif({ exclu: false }, { "léna test": false }, "Léna Test")).toBe(false);
    expect(estExclusif(null, null, "Léna Test")).toBe(false);
  });
  it("clé et présence de la colonne", () => {
    expect(excluKey("  LÉNA Test ")).toBe("léna test");
    expect(hasExcluColumn({ exclu: false })).toBe(true);
    expect(hasExcluColumn({ exclu: null })).toBe(true);
    expect(hasExcluColumn({ name: "x" })).toBe(false);
    expect(hasExcluColumn(null)).toBe(false);
  });
});

describe("excluAEcrire", () => {
  it("interrupteur pas touché : rien n'est écrit (l'exclusivité du blob survit)", () => {
    expect(excluAEcrire(false, false, true)).toEqual({ column: null, blob: null });
  });
  it("interrupteur changé : la même valeur dans la colonne et le blob", () => {
    expect(excluAEcrire(true, false, true)).toEqual({ column: false, blob: false });
    expect(excluAEcrire(true, true, true)).toEqual({ column: true, blob: true });
  });
  it("sans la colonne : le blob seulement", () => {
    expect(excluAEcrire(true, true, false)).toEqual({ column: null, blob: true });
  });
});
