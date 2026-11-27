import { describe, expect, it } from "vitest";
import { addDaysISO, collabAProposer, collabDepuisDevis, lireCollabPrefill, nextQuoteRef, quoteShownStatus } from "./quotes";

describe("nextQuoteRef", () => {
  it("démarre à 001 et suit les devis de l'année", () => {
    expect(nextQuoteRef([], 2026)).toBe("D-2026-001");
    expect(nextQuoteRef(["D-2026-001", "D-2026-007", "D-2025-120"], 2026)).toBe("D-2026-008");
  });

  it("ignore les numéros de facture", () => {
    expect(nextQuoteRef(["2026-214", "D-2026-002"], 2026)).toBe("D-2026-003");
  });
});

describe("quoteShownStatus", () => {
  it("passe en expiré un devis envoyé ou brouillon dont la validité est passée", () => {
    expect(quoteShownStatus({ status: "envoye", validUntil: "2026-10-31" }, "2026-11-02")).toBe("expire");
    expect(quoteShownStatus({ status: "brouillon", validUntil: "2026-11-01" }, "2026-11-02")).toBe("expire");
  });

  it("garde les autres statuts", () => {
    expect(quoteShownStatus({ status: "envoye", validUntil: "2026-11-02" }, "2026-11-02")).toBe("envoye");
    expect(quoteShownStatus({ status: "accepte", validUntil: "2026-10-01" }, "2026-11-02")).toBe("accepte");
    expect(quoteShownStatus({ status: "refuse", validUntil: "" }, "2026-11-02")).toBe("refuse");
    expect(quoteShownStatus({ status: "inconnu" }, "2026-11-02")).toBe("brouillon");
  });
});

describe("addDaysISO", () => {
  it("ajoute des jours en changeant de mois", () => {
    expect(addDaysISO("2026-11-02", 30)).toBe("2026-12-02");
    expect(addDaysISO("2026-12-15", 30)).toBe("2027-01-14");
  });
});

describe("devis accepté → « Créer la collab » (constat WC1)", () => {
  const devis = { status: "accepte", brand: "Marque X", creator: "CRÉATRICE A" };
  it("proposé seulement pour un devis accepté sans collab en cours pour la marque et le créateur", () => {
    expect(collabAProposer(devis, [])).toBe(true);
    expect(collabAProposer({ ...devis, status: "envoye" }, [])).toBe(false);
    expect(collabAProposer({ ...devis, collabId: "c1" }, [])).toBe(false);
    expect(collabAProposer(devis, null)).toBe(false);
    expect(collabAProposer(devis, [{ brand: "marque x", creator: "Créatrice A", status: "active", step: 2 }])).toBe(false);
    // Collab de la même marque mais bouclée, perdue, ou d'un autre créateur : on propose.
    expect(collabAProposer(devis, [{ brand: "Marque X", creator: "Créatrice A", status: "gagnee", step: 11 }])).toBe(true);
    expect(collabAProposer(devis, [{ brand: "Marque X", creator: "Créatrice A", status: "perdue", step: 3 }])).toBe(true);
    expect(collabAProposer(devis, [{ brand: "Marque X", creator: "Créatrice B", status: "active", step: 3 }])).toBe(true);
  });
  it("préremplissage : marque, créateur, livrables, cachet HT ; relu par Collabs", () => {
    const p = collabDepuisDevis({ ...devis, items: [{ label: "1 vidéo" }, { label: " " }, { label: "3 stories" }] }, 1500);
    expect(p.brand).toBe("Marque X");
    expect(p.creator).toBe("CRÉATRICE A");
    expect(p.deliverables).toBe("1 vidéo, 3 stories");
    expect(p.cachet.replace(/\s/g, " ")).toBe("1 500 € HT");
    expect(lireCollabPrefill(JSON.stringify(p))).toEqual(p);
    expect(lireCollabPrefill(undefined)).toBe(null);
    expect(lireCollabPrefill("pas du json")).toBe(null);
    expect(lireCollabPrefill(JSON.stringify({ brand: "" }))).toBe(null);
  });
});
