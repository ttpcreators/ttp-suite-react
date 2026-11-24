import { describe, expect, it } from "vitest";
import { bestContact, classerPersonnes, coutRecherche, enrichContact, lignePersonneFE, parsePeople, poidsPoste, searchBody, type Person } from "./fullenrich.ts";

describe("FullEnrich", () => {
  it("recherche par site ou par nom de marque", () => {
    const b = searchBody({ company: "https://www.Sephora.fr/fr", titles: ["influence"], country: "France" });
    expect(b.current_company_domains).toEqual([{ value: "sephora.fr", exact_match: true, exclude: false }]);
    expect(b.current_position_titles).toEqual([{ value: "influence", exact_match: false, exclude: false }]);
    expect(b.person_locations).toEqual([{ value: "France", exact_match: false, exclude: false }]);
    expect(searchBody({ company: "Aroma Zone" }).current_company_names).toEqual([{ value: "Aroma Zone", exact_match: false, exclude: false }]);
    expect(searchBody({ company: "x.fr", limit: 500 }).limit).toBe(25);
  });
  it("recherche sans filtre de poste quand on le demande", () => {
    expect(searchBody({ company: "x.fr" }).current_position_titles).toBeDefined();
    expect(searchBody({ company: "x.fr", allTitles: true }).current_position_titles).toBeUndefined();
    expect(searchBody({ company: "x.fr", titles: ["influence"], allTitles: true }).current_position_titles).toBeUndefined();
  });
  it("poids d'un poste pour une agence d'influence", () => {
    expect(poidsPoste("Responsable Influence & RP")).toBe(5);
    expect(poidsPoste("Créateur de contenu")).toBe(5);
    expect(poidsPoste("Chargée de partenariats")).toBe(4);
    expect(poidsPoste("Social Media Manager")).toBe(3);
    expect(poidsPoste("PR Manager")).toBe(3);
    expect(poidsPoste("Chef de produit marketing")).toBe(2);
    expect(poidsPoste("Co-fondatrice")).toBe(1);
    expect(poidsPoste("Comptable")).toBe(0);
    expect(poidsPoste("Développeur")).toBe(0);
    expect(poidsPoste("Talent Acquisition Manager")).toBe(0);
    expect(poidsPoste("Responsable marque employeur")).toBe(0);
    expect(poidsPoste("Talent Manager")).toBe(5);
    expect(poidsPoste("VP Marketing")).toBe(2);
  });
  it("classe les personnes : influence d'abord, sans doublon", () => {
    const p = (name: string, title: string, linkedin = ""): Person => ({ id: name, name, first: "", last: "", title, company: "Nova", domain: "nova.fr", linkedin, location: "Paris, France" });
    const r = classerPersonnes([
      p("Zoé Martin", "Comptable"),
      p("Léa Roux", "Chef de projet marketing", "https://www.linkedin.com/in/lea-roux/"),
      p("Inès Petit", "Influence Manager"),
      p("Léa Roux", "Marketing", "https://www.linkedin.com/in/lea-roux"),
      p("Tom Blanc", "CEO"),
    ]);
    expect(r.toutes.map((x) => x.name)).toEqual(["Inès Petit", "Léa Roux", "Tom Blanc", "Zoé Martin"]);
    expect(r.cibles.map((x) => x.name)).toEqual(["Inès Petit", "Léa Roux", "Tom Blanc"]);
    expect(lignePersonneFE(r.toutes[1])).toBe("- Léa Roux · Chef de projet marketing · Paris, France · https://www.linkedin.com/in/lea-roux/");
    expect(lignePersonneFE(p("Zoé  Martin", ""))).toBe("- Zoé Martin · Paris, France");
  });
  it("coût d'une recherche", () => {
    expect(coutRecherche(5, 0)).toBe(1.25);
    expect(coutRecherche(5, 2)).toBe(2);
    expect(coutRecherche(0, 0)).toBe(0);
  });
  it("lit les personnes trouvées", () => {
    const r = parsePeople({
      people: [{ id: "p1", full_name: "Netty Baciu", first_name: "Netty", last_name: "Baciu", location: { city: "Paris", country: "France" },
        social_profiles: { professional_network: { url: "https://www.linkedin.com/in/netty" } },
        employment: { current: { title: "Head of Paid Influence", company: { name: "Sephora", domain: "sephora.fr" } } } }],
      metadata: { total: 12, credits: 0.25 },
    });
    expect(r).toEqual({ people: [{ id: "p1", name: "Netty Baciu", first: "Netty", last: "Baciu", title: "Head of Paid Influence", company: "Sephora", domain: "sephora.fr", linkedin: "https://www.linkedin.com/in/netty", location: "Paris, France" }], total: 12, credits: 0.25 });
  });
  it("personne à enrichir : LinkedIn, ou nom + entreprise", () => {
    expect(enrichContact({ linkedin: "https://www.linkedin.com/in/netty", phone: true })).toEqual({ linkedin_url: "https://www.linkedin.com/in/netty", enrich_fields: ["contact.work_emails", "contact.phones"] });
    expect(enrichContact({ first: "Netty", last: "Baciu", company: "Sephora" })).toEqual({ first_name: "Netty", last_name: "Baciu", company_name: "Sephora", enrich_fields: ["contact.work_emails"] });
    expect(enrichContact({ first: "Netty", company: "Sephora" })).toBeNull();
  });
  it("meilleur email (jamais invalide) et téléphone", () => {
    expect(bestContact({ data: [{ contact_info: { most_probable_work_email: { email: "NBaciu@sephora.fr", status: "DELIVERABLE" }, most_probable_phone: { number: "+33 6 00" } } }] }))
      .toEqual({ email: "nbaciu@sephora.fr", emailStatus: "DELIVERABLE", phone: "+33 6 00" });
    expect(bestContact({ data: [{ contact_info: { most_probable_work_email: { email: "x@y.fr", status: "INVALID" } } }] }).email).toBe("");
  });
});
