import { describe, expect, it } from "vitest";
import { bestContact, enrichContact, parsePeople, searchBody } from "./fullenrich.ts";

describe("FullEnrich", () => {
  it("recherche par site ou par nom de marque", () => {
    const b = searchBody({ company: "https://www.Sephora.fr/fr", titles: ["influence"], country: "France" });
    expect(b.current_company_domains).toEqual([{ value: "sephora.fr", exact_match: true, exclude: false }]);
    expect(b.current_position_titles).toEqual([{ value: "influence", exact_match: false, exclude: false }]);
    expect(b.person_locations).toEqual([{ value: "France", exact_match: false, exclude: false }]);
    expect(searchBody({ company: "Aroma Zone" }).current_company_names).toEqual([{ value: "Aroma Zone", exact_match: false, exclude: false }]);
    expect(searchBody({ company: "x.fr", limit: 500 }).limit).toBe(25);
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
