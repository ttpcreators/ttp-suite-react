import { describe, expect, it } from "vitest";
import { guessVille, slugFor } from "./BaseCreateurs";

describe("guessVille", () => {
  it("trouve la ville citée dans la bio, accents et emojis compris", () => {
    expect(guessVille("📍Lyon · running & food")).toBe("Lyon");
    expect(guessVille("Basée à saint etienne")).toBe("Saint-Étienne");
    expect(guessVille("Créatrice mode, Paris / Londres")).toBe("Paris");
  });
  it("ne devine pas une ville cachée dans un autre mot", () => {
    expect(guessVille("Je suis niçoise de coeur, parisienne de vie")).toBeNull();
  });
});

describe("slugFor", () => {
  it("fait une adresse lisible, valide et introuvable sans le lien", () => {
    const s = slugFor("Running Lyon pour Décathlon !");
    expect(s).toMatch(/^running-lyon-pour-decathlon-[a-z0-9]{1,4}$/);
    expect(s).toMatch(/^[a-z0-9-]{3,60}$/);
    expect(slugFor("é")).toMatch(/^[a-z0-9-]{3,60}$/);
  });
});
