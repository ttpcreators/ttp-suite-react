import { describe, expect, it } from "vitest";
import { partsDuBudget, sansCitation } from "./mailFil.ts";

describe("mailFil", () => {
  it("retire la citation française et anglaise", () => {
    expect(sansCitation("Bien reçu la facture, merci !\n\nLe mar. 4 nov. 2026 à 10:02, Marc <m@x.fr> a écrit :\n> Voici la facture")).toBe("Bien reçu la facture, merci !\n[citation des messages précédents retirée]");
    expect(sansCitation("Thanks\nOn Tue, Nov 4, 2026 at 10:02 AM Marc <m@x.fr> wrote:\n> hi")).toContain("Thanks");
    expect(sansCitation("Ok\nDe : Marc\nEnvoyé : mardi\nObjet : x\nTexte ancien")).toBe("Ok\n[citation des messages précédents retirée]");
    expect(sansCitation("Bonjour\n> cité\nSuite")).toBe("Bonjour\nSuite");
  });

  it("garde un message qui commence par une citation", () => {
    expect(sansCitation("Le texte normal")).toBe("Le texte normal");
  });

  it("le dernier message est servi en entier, aucun ancien n'est sauté", () => {
    const parts = partsDuBudget([20_000, 20_000, 20_000, 20_000, 20_000, 20_000, 300], 40_000, 8_000, 400);
    expect(parts[6]).toBe(300);
    expect(parts[5]).toBe(8_000);
    expect(parts.every((p) => p >= 300)).toBe(true);
    expect(parts.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(40_000);
  });

  it("un fil court passe en entier", () => {
    expect(partsDuBudget([1_000, 2_000])).toEqual([1_000, 2_000]);
  });
});
