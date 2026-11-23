import { describe, expect, it } from "vitest";
import { estExclusif, excluKey, hasExcluColumn } from "./creatorExclu";

describe("estExclusif", () => {
  it("la colonne fait foi, même contre la copie du blob", () => {
    expect(estExclusif({ exclu: true }, {}, "Léna Test")).toBe(true);
    expect(estExclusif({ exclu: false }, { "léna test": true }, "Léna Test")).toBe(false);
  });
  it("repli sur la copie du blob si la colonne manque", () => {
    expect(estExclusif({}, { "léna test": true }, "LÉNA TEST")).toBe(true);
    expect(estExclusif({ exclu: null }, { "léna test": true }, "Léna Test")).toBe(true);
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
