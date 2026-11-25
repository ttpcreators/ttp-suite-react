import { describe, expect, it } from "vitest";
import { ligneActionEquipe } from "./equipeClaude.ts";

describe("ce que l'équipe fait par son Claude", () => {
  it("résume un brouillon de mail", () => {
    const s = JSON.stringify({ a: "adele@exemple.fr", boite: "partnerships", message: "Hello Adèle,\n\nJ'espère que tu vas bien." });
    expect(ligneActionEquipe("creer_brouillon_mail", s)).toBe("brouillon (partnerships) à adele@exemple.fr · Hello Adèle, J'espère que tu vas bien.…");
  });
  it("lit un résumé coupé en plein milieu", () => {
    const s = '{"a":"mandy@exemple.fr","boite":"talent","message":"Hello Mandy, C\'est Marc, de TTP Cre';
    expect(ligneActionEquipe("creer_brouillon_mail", s)).toContain("brouillon (talent) à mandy@exemple.fr");
  });
  it("résume un contact et une tâche", () => {
    expect(ligneActionEquipe("ajouter_contact", JSON.stringify({ nom: "Louna Test", marque: "Agence Test" }))).toBe("contact ajouté : Louna Test, Agence Test");
    expect(ligneActionEquipe("creer_tache", JSON.stringify({ texte: "Relancer Nova" }))).toBe("tâche créée : Relancer Nova");
  });
});
