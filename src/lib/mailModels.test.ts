import { describe, expect, it } from "vitest";
import { brandFromEmail, DEFAULT_TEMPLATES, fillModel, groupModels, insertModel } from "./mailModels";

describe("modèles de mails", () => {
  it("remplace les variables connues, garde les autres", () => {
    expect(fillModel("Bonjour {marque}, pour {créateur} et {prénom}", { marque: "Nike", createur: "Léna" })).toBe("Bonjour Nike, pour Léna et {prénom}");
  });
  it("devine la marque depuis l'adresse", () => {
    expect(brandFromEmail("anna@nike.com")).toBe("Nike");
    expect(brandFromEmail("anna@mail.lululemon.co.uk")).toBe("Lululemon");
    expect(brandFromEmail("julie@gmail.com")).toBe("");
    expect(brandFromEmail("")).toBe("");
  });
  it("range par catégorie dans l'ordre", () => {
    const g = groupModels([...DEFAULT_TEMPLATES, { category: "Perso", title: "x", body: "y" }]);
    expect(g[0].category).toBe("Prospection");
    expect(g[g.length - 1].category).toBe("Perso");
  });
  it("ajoute à la suite ou pose", () => {
    expect(insertModel("", "A")).toBe("A");
    expect(insertModel("Bonjour  \n", "A")).toBe("Bonjour\n\nA");
  });
});
