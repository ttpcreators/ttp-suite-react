import { describe, expect, it } from "vitest";
import { adresseDe, destinataireReponse, erreurBoite, nomDe, type BoxMessage } from "./creatorBoxMail";

const msg = (from: string, to: string): BoxMessage => ({ id: "m", from, to, cc: "", date: "", ts: 0, text: "", files: [], sent: false });

describe("Boîtes des créateurs dans Mails", () => {
  it("lit l'adresse et le nom d'un en-tête", () => {
    expect(adresseDe('"Paul Nova" <Paul@Nova.fr>')).toBe("paul@nova.fr");
    expect(nomDe('"Paul Nova" <paul@nova.fr>')).toBe("Paul Nova");
    expect(nomDe("paul@nova.fr")).toBe("paul@nova.fr");
  });
  it("répond à l'auteur du dernier message reçu", () => {
    expect(destinataireReponse([msg("Paul <paul@nova.fr>", "lea@gmail.com")], "lea@gmail.com")).toBe("paul@nova.fr");
  });
  it("relance les destinataires quand le dernier message vient de la boîte", () => {
    expect(destinataireReponse([msg("Léa <lea@gmail.com>", "Paul <paul@nova.fr>, lea@gmail.com")], "lea@gmail.com")).toBe("paul@nova.fr");
    expect(destinataireReponse([], "lea@gmail.com")).toBe("");
  });
  it("donne une erreur lisible", () => {
    expect(erreurBoite("unauthorized")).toBe("Réservé aux fondateurs.");
    expect(erreurBoite("inconnu")).toMatch(/réessaie/);
  });
});
