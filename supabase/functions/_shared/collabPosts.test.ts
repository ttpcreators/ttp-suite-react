import { describe, expect, it } from "vitest";
import { brandMatcher } from "./collabPosts.ts";

describe("brandMatcher", () => {
  it("compte noté dans le carnet, nom collé, mot entier", () => {
    expect(brandMatcher("Nakd", ["nakdfashion"])("Merci nakdfashion pour la robe")).toBe(true);
    expect(brandMatcher("Prison Island", [])("Session chez prisonisland ce weekend")).toBe(true);
    expect(brandMatcher("Kosbiotic", [])("Ma routine avec Kosbiotic le matin")).toBe(true);
  });
  it("compte qui commence par le nom de la marque (sans fiche contact)", () => {
    expect(brandMatcher("Yade", [])("Nouvelle bague yade.paris, code LENA10")).toBe(true);
    expect(brandMatcher("Kosbiotic", [])("collaboration commerciale kosbioticfr")).toBe(true);
    expect(brandMatcher("Nutripure", [])("nutripure_officiel ma whey préférée")).toBe(true);
  });
  it("ne prend pas un autre mot qui commence pareil", () => {
    expect(brandMatcher("Yade", [])("yadelirium total ce soir")).toBe(false);
    expect(brandMatcher("Seoni", [])("seonimaginaire")).toBe(false);
  });
  it("marque trop courte : pas de règle de préfixe", () => {
    expect(brandMatcher("ESN", [])("esnfrance")).toBe(false);
    expect(brandMatcher("ESN", [])("ma whey esn préférée")).toBe(true);
  });
});
