import { describe, expect, it } from "vitest";
import { ENTETE_ACTEUR, entetesActeur, valeurActeur } from "./acteurConnecteur.ts";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("en-tête d'acteur du connecteur", () => {
  it("a un nom en minuscules (PostgREST range les en-têtes ainsi)", () => {
    expect(ENTETE_ACTEUR).toBe("x-ttp-acteur");
    expect(ENTETE_ACTEUR).toBe(ENTETE_ACTEUR.toLowerCase());
  });
  it("dit Alfred seulement pour une connexion au libellé « Alfred »", () => {
    expect(valeurActeur({ libelle: "Alfred", userId: ID })).toBe(`alfred:${ID}`);
    expect(valeurActeur({ libelle: " alfred ", userId: ID })).toBe(`alfred:${ID}`);
  });
  it("une connexion d'agent qui n'est pas Alfred, ou sans libellé : Claude", () => {
    expect(valeurActeur({ libelle: "Tâches planifiées", userId: ID })).toBe(`claude:${ID}`);
    expect(valeurActeur({ libelle: "Alfred bis", userId: ID })).toBe(`claude:${ID}`);
    expect(valeurActeur({ userId: ID.toUpperCase() })).toBe(`claude:${ID}`);
  });
  it("laisse tomber un id illisible, jamais de texte libre dans l'en-tête", () => {
    expect(valeurActeur({ libelle: null, userId: "Créatrice A" })).toBe("claude");
    expect(valeurActeur({ libelle: "Alfred", userId: "" })).toBe("alfred");
  });
  it("donne l'objet d'en-têtes du client Supabase, en ASCII", () => {
    const h = entetesActeur({ userId: ID });
    expect(h).toEqual({ "x-ttp-acteur": `claude:${ID}` });
    expect(/^[\x20-\x7e]+$/.test(h[ENTETE_ACTEUR])).toBe(true);
  });
});
