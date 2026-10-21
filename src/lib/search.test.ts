import { describe, expect, it } from "vitest";
import { matchWords } from "./search";

describe("matchWords (recherche d'une page)", () => {
  it("ignore accents, majuscules et @, tous les mots doivent se trouver", () => {
    expect(matchWords("", "x")).toBe(true);
    expect(matchWords("berenice", "Bérénice")).toBe(true);
    expect(matchWords("@BBCVL", "Bérénice", "bbcvl")).toBe(true);
    expect(matchWords("julie mode", "Julie Schneider", "Mode")).toBe(true);
    expect(matchWords("julie sport", "Julie Schneider", "Mode")).toBe(false);
  });
});
