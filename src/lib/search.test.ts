import { describe, expect, it } from "vitest";
import { matchWords } from "./search";

describe("matchWords (recherche d'une page)", () => {
  it("ignore accents, majuscules et @, tous les mots doivent se trouver", () => {
    expect(matchWords("", "x")).toBe(true);
    expect(matchWords("helene", "Hélène")).toBe(true);
    expect(matchWords("@HLNMODE", "Hélène", "hlnmode")).toBe(true);
    expect(matchWords("julie mode", "Julie Fontaine", "Mode")).toBe(true);
    expect(matchWords("julie sport", "Julie Fontaine", "Mode")).toBe(false);
  });
});
