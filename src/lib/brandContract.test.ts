import { describe, expect, it } from "vitest";
import { SCENARIO_DEFAULT, brandContractDoc, brandTerms, ctDisplayName } from "./brandContract";

const fields = { ...SCENARIO_DEFAULT, ctType: "marque" as const, brand: "Nova", value: "400 € HT", commission: "20", duration: "3 mois", deliverables: "1 Reel", extra: [] };

describe("Moteur des contrats Marque × Créateur et UGC", () => {
  it("assemble les conditions particulières du formulaire", () => {
    const { parties, terms } = brandTerms({ ...fields, rights: "paid", rightsDuration: "3 mois" }, "Léa");
    expect(parties).toBe("ENTRE Nova (l'Annonceur) ET Léa, représenté(e) par TTP Creators (l'Agent).");
    expect(terms.find((t) => t.l === "Cession de droits")?.v).toBe("Paid media / whitelisting · 3 mois");
    expect(terms.find((t) => t.l === "Commission TTP")?.v).toBe("20% du montant");
  });

  it("fait le document complet, avec la mise en page des contrats et les polices de l'app en ligne", () => {
    const doc = brandContractDoc({ ...fields, extra: [{ l: "Whitelisting", v: "Limité à 30 jours." }] }, "léa martin");
    expect(doc.title).toBe("Contrat de partenariat commercial");
    expect(doc.html).toContain('class="wrap ct"');
    expect(doc.html).toContain("Léa Martin × Nova");
    expect(doc.html).toContain("Whitelisting</h2>");
    expect(doc.html).toMatch(/https:\/\/app\.ttpcreators\.pro\/fonts\/instrument-serif-normal\.woff2|fonts\/instrument-serif-normal\.woff2/);
  });

  it("ajoute la vigilance URSSAF à partir de 5 000 € HT", () => {
    expect(brandContractDoc({ ...fields, value: "6 000 €" }, "Léa").html).toContain("Vigilance sociale");
    expect(brandContractDoc(fields, "Léa").html).not.toContain("Vigilance sociale");
  });

  it("écrit le nom du créateur avec ses majuscules", () => {
    expect(ctDisplayName("inès roux-durand")).toBe("Inès Roux-Durand");
    expect(ctDisplayName("[Créateur]")).toBe("[Créateur]");
  });
});
