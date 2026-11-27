import { describe, expect, it } from "vitest";
import { ENTETE_ACTEUR, entetesActeur, valeurActeur } from "./acteurConnecteur.ts";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("en-tête d'acteur du connecteur", () => {
  it("a un nom en minuscules (PostgREST range les en-têtes ainsi)", () => {
    expect(ENTETE_ACTEUR).toBe("x-ttp-acteur");
    expect(ENTETE_ACTEUR).toBe(ENTETE_ACTEUR.toLowerCase());
  });
  it("dit Alfred pour une connexion d'agent autonome", () => {
    expect(valeurActeur({ agent: true, userId: ID })).toBe(`alfred:${ID}`);
  });
  it("dit Claude pour la connexion d'un membre de l'équipe", () => {
    expect(valeurActeur({ agent: false, userId: ID.toUpperCase() })).toBe(`claude:${ID}`);
  });
  it("laisse tomber un id illisible, jamais de texte libre dans l'en-tête", () => {
    expect(valeurActeur({ agent: false, userId: "Créatrice A" })).toBe("claude");
    expect(valeurActeur({ agent: true, userId: "" })).toBe("alfred");
  });
  it("donne l'objet d'en-têtes du client Supabase, en ASCII", () => {
    const h = entetesActeur({ agent: false, userId: ID });
    expect(h).toEqual({ "x-ttp-acteur": `claude:${ID}` });
    expect(/^[\x20-\x7e]+$/.test(h[ENTETE_ACTEUR])).toBe(true);
  });
});
