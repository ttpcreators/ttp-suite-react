import { describe, expect, it } from "vitest";
import { agencyHint } from "./signals.ts";

// Aucune moitié d'emoji seule (encodeURIComponent refuse un texte qui en a une).
const bienForme = (s: string) => {
  try {
    encodeURIComponent(s);
    return true;
  } catch {
    return false;
  }
};

describe("agencyHint (indice « déjà en agence »)", () => {
  it("passage coupé des deux côtés sans jamais casser d'emoji", () => {
    // Les coupes (25 caractères avant le mot, 25 après) tombent tour à tour entre deux emoji
    // et au milieu d'un emoji : les espaces avant le mot (k) déplacent la coupe du début,
    // ceux d'après (j) la coupe de fin.
    for (let k = 0; k < 4; k++) {
      for (let j = 0; j < 4; j++) {
        const bio = `${"🔥".repeat(15)}${" ".repeat(1 + k)}management${" ".repeat(1 + j)}${"💪".repeat(15)}`;
        const h = agencyHint(bio, "") ?? "";
        expect(h).toContain("management");
        expect(bienForme(h)).toBe(true);
      }
    }
  });
  it("retire le caractère nul (texte d'une page web)", () => {
    expect(agencyHint("géré par\u0000 Studio Nova", "")).toBe("géré par Studio Nova");
  });
  it("sans mot d'agence : l'adresse d'une agence, sinon rien", () => {
    expect(agencyHint("Créatrice lifestyle", "zoe@talents-agency.fr")).toBe("zoe@talents-agency.fr");
    expect(agencyHint("Créatrice lifestyle", "zoe@gmail.com")).toBeNull();
  });
});
