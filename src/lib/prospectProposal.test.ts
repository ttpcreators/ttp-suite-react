import { describe, expect, it } from "vitest";
import { cachetOf, collabFromProspect, contactForBrand, openProspectFor, proposalPatch, proposalValue, type Proposal } from "./prospectProposal";

const P: Proposal = { mode: "influence", creator: "LÉNA PASQUALE", deliverables: "2 reels Instagram", min: 800, max: 1100, target: 950, at: "2026-10-23" };
const amount = (s: string) => s.replace(/\s/g, " ");

describe("Tarifs → prospect → collab", () => {
  it("la valeur affichée est la fourchette HT", () => {
    expect(amount(proposalValue(P))).toBe("800 – 1 100 € HT");
    expect(amount(proposalValue({ min: 500, max: 500 }))).toBe("500 € HT");
  });
  it("avant le SQL : seulement marque, contact, valeur et étape", () => {
    expect(Object.keys(proposalPatch(P, { brand: " Nike ", contact: "", contactId: "k1" }, false)).sort()).toEqual(["brand", "contact", "stage", "value"]);
    const full = proposalPatch(P, { brand: "Nike", contact: "Tom", contactId: "k1" }, true);
    expect(full).toMatchObject({ brand: "Nike", contact: "Tom", stage: "Négociation", creator: "LÉNA PASQUALE", deliverables: "2 reels Instagram", contact_id: "k1" });
  });
  it("retrouve le contact et le prospect ouvert de la marque", () => {
    expect(contactForBrand([{ id: "a", brand: "Asics" }, { id: "b", brand: "NIKE" }], "Nike")?.id).toBe("b");
    const list = [
      { id: "p1", brand: "Nike", contact: null, value: null, stage: "Signé" },
      { id: "p2", brand: "nike", contact: null, value: null, stage: "Contact" },
    ];
    expect(openProspectFor(list, "Nike")?.id).toBe("p2");
    expect(openProspectFor([{ ...list[1], collab_id: "c1" }], "Nike")).toBeNull();
  });
  it("le cachet vient de la proposition, sinon du montant saisi", () => {
    expect(amount(cachetOf({ id: "p", brand: "Nike", contact: null, value: null, stage: null, proposal: P }))).toBe("950 €");
    expect(amount(cachetOf({ id: "p", brand: "Nike", contact: null, value: "800 – 1 200 €", stage: null }))).toBe("1 200 €");
    expect(cachetOf({ id: "p", brand: "Nike", contact: null, value: "—", stage: null })).toBe("");
  });
  it("la collab démarre à l'étape 1 avec tout rempli", () => {
    const c = collabFromProspect({ id: "p", brand: "Nike ", contact: "Tom", value: null, stage: null }, { creator: "LÉNA PASQUALE", deliverables: "2 reels", cachet: "950 €" }, 3);
    expect(c).toEqual({ brand: "Nike", creator: "LÉNA PASQUALE", contact: "Tom", deliverables: "2 reels", cachet: "950 €", step: 1, status: "active", sort_order: 3 });
  });
});
