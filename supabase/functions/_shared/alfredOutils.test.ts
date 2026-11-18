import { describe, expect, it } from "vitest";
import { objectifsDuMois, problemeModele } from "./alfredOutils.ts";

describe("outils d'Alfred : objectifs et modèles", () => {
  it("lit les objectifs du mois, et l'ancien format pour le mois courant", () => {
    expect(objectifsDuMois({ "2026-11": [{ name: "CA" }] }, "2026-11", "2026-11")).toEqual([{ name: "CA" }]);
    expect(objectifsDuMois({ "0": [{ name: "Ancien" }] }, "2026-11", "2026-11")).toEqual([{ name: "Ancien" }]);
    expect(objectifsDuMois({ "0": [{ name: "Ancien" }] }, "2026-10", "2026-11")).toEqual([]);
    expect(objectifsDuMois(null, "2026-11", "2026-11")).toEqual([]);
  });

  it("refuse un modèle avec une donnée personnelle", () => {
    const texte = "Bonjour {contact}, je reviens vers vous au sujet de la collaboration avec {créateur}, avez-vous pu en parler en interne ?";
    expect(problemeModele("Relance J+4", texte)).toBeNull();
    expect(problemeModele("Relance", `${texte} lorna@exemple.fr`)).toContain("adresse mail");
    expect(problemeModele("Relance", `${texte} 06 12 34 56 78`)).toContain("téléphone");
    expect(problemeModele("Relance", `${texte} https://exemple.fr`)).toContain("lien");
    expect(problemeModele("R", texte)).toContain("Titre");
  });
});
