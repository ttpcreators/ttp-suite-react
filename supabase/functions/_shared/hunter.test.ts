import { describe, expect, it } from "vitest";
import { CLE_MANQUANTE, cibles, limiteDeLOffre, domaineDe, erreurHunter, lignePersonne, lireEmailTrouve, lireRecherche, paramsRecherche, pertinence, statutEmail } from "./hunter.ts";

// Marque et personnes fictives (dépôt public : aucune vraie personne).
const reponse = {
  data: {
    domain: "marque-fictive.fr", organization: "Marque Fictive", pattern: "{first}.{last}", accept_all: false,
    emails: [
      { value: "Lea.Martin@marque-fictive.fr", first_name: "Léa", last_name: "Martin", position: "Head of Influence", department: "marketing", confidence: 96, linkedin: "lea-martin-fictive", verification: { status: "valid" } },
      { value: "paul.durand@marque-fictive.fr", first_name: "Paul", last_name: "Durand", position: "Comptable", department: "finance", confidence: 90 },
      { value: "nina.roux@marque-fictive.fr", first_name: "Nina", last_name: "Roux", position: "Chargée de relations presse", department: "communication", confidence: 80, linkedin: "https://www.linkedin.com/in/nina-roux-fictive", verification: { status: "accept_all" } },
      { value: "", first_name: "Sans", last_name: "Email" },
    ],
  },
  meta: { results: 14 },
};

describe("Hunter", () => {
  it("domaine depuis un site, un lien ou une adresse", () => {
    expect(domaineDe("https://www.Marque-Fictive.fr/fr/boutique")).toBe("marque-fictive.fr");
    expect(domaineDe("contact@marque-fictive.fr")).toBe("marque-fictive.fr");
    expect(domaineDe("Marque Fictive")).toBe("");
  });

  it("paramètres : domaine ou nom de marque, départements marketing et communication", () => {
    expect(paramsRecherche({ domaine: "marque-fictive.fr" })).toBe("domain=marque-fictive.fr&type=personal&department=marketing%2Ccommunication&limit=10");
    expect(paramsRecherche({ marque: "Marque Fictive", limite: 500, departements: false })).toBe("company=Marque+Fictive&type=personal&limit=100");
  });

  it("lit les personnes et garde les postes utiles (influence d'abord)", () => {
    const r = lireRecherche(reponse);
    expect(r).toMatchObject({ domaine: "marque-fictive.fr", organisation: "Marque Fictive", total: 14 });
    expect(r.personnes).toHaveLength(3);
    expect(r.personnes[0]).toEqual({ prenom: "Léa", nom: "Martin", poste: "Head of Influence", departement: "marketing", seniorite: "", email: "lea.martin@marque-fictive.fr", confiance: 96, statut: "valid", linkedin: "https://www.linkedin.com/in/lea-martin-fictive" });
    expect(cibles(r.personnes).map((p) => p.nom)).toEqual(["Martin", "Roux"]);
    expect(pertinence({ poste: "Brand Partnerships Manager", departement: "" })).toBe(4);
    expect(pertinence({ poste: "", departement: "marketing" })).toBe(1);
  });

  it("statut de vérification et ligne lisible", () => {
    expect(statutEmail("valid", 96)).toBe("vérifiée, confiance 96 %");
    expect(statutEmail("", null, true)).toBe("non vérifiée, le domaine accepte toutes les adresses");
    expect(lignePersonne(lireRecherche(reponse).personnes[2])).toBe("- Nina Roux · Chargée de relations presse · nina.roux@marque-fictive.fr (non garantie : le domaine accepte toutes les adresses, confiance 80 %) · https://www.linkedin.com/in/nina-roux-fictive");
  });

  it("e-mail d'une personne et erreurs", () => {
    expect(lireEmailTrouve({ data: { email: "Lea.Martin@marque-fictive.fr", score: 91, verification: { status: "valid" }, position: "Head of Influence" } }))
      .toEqual({ email: "lea.martin@marque-fictive.fr", confiance: 91, statut: "valid", poste: "Head of Influence", linkedin: "", acceptAll: false });
    expect(erreurHunter(401, {})).toContain("HUNTER_API_KEY");
    expect(erreurHunter(429, { errors: [{ id: "too_many_requests", details: "You have reached your monthly usage limit" }] })).toContain("Quota Hunter épuisé");
    expect(erreurHunter(400, { errors: [{ details: "You are limited to 10 email addresses" }] })).toContain("Demande refusée");
    expect(limiteDeLOffre(400, { errors: [{ details: "You are limited to 10 email addresses" }] })).toBe(true);
    expect(limiteDeLOffre(401, {})).toBe(false);
    expect(CLE_MANQUANTE).toContain("Clé Hunter manquante : Marc doit créer un compte Hunter et enregistrer HUNTER_API_KEY");
  });
});
