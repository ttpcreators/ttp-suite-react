import { describe, expect, it } from "vitest";
import { ciblesEchange, requeteEchange, texteEchanges } from "./dejaEchange.ts";

describe("dejaEchange", () => {
  it("domaine de la société, adresse exacte pour une messagerie grand public", () => {
    expect(ciblesEchange("Ilona <ilona@agence-exemple.fr>, contact@gmail.com")).toEqual(["agence-exemple.fr", "contact@gmail.com"]);
    expect(ciblesEchange("a@marque.com, b@marque.com")).toEqual(["marque.com"]);
    expect(ciblesEchange("pas une adresse")).toEqual([]);
  });

  it("requête Gmail sur les deux sens", () => {
    expect(requeteEchange(["marque.com"])).toBe("{from:marque.com to:marque.com cc:marque.com} newer_than:60d");
    expect(requeteEchange([])).toBe("");
  });

  it("bloc d'alerte seulement s'il y a des échanges", () => {
    expect(texteEchanges(["marque.com"], [])).toBe("");
    const t = texteEchanges(["marque.com"], [{ box: "createur@gmail.com", date: "4 nov.", from: "Ilona", subject: "Facture", messages: 3, snippet: "Bien reçu la facture", threadId: "abc" }]);
    expect(t).toContain("DÉJÀ DES ÉCHANGES");
    expect(t).toContain("createur@gmail.com");
    expect(t).toContain("supprimer_brouillon");
  });
});
