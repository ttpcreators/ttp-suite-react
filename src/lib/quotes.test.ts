import { describe, expect, it } from "vitest";
import { addDaysISO, nextQuoteRef, quoteShownStatus } from "./quotes";

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
