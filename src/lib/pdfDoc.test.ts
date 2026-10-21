import { describe, expect, it } from "vitest";
import { pdfFileTitle } from "./pdfDoc";

describe("pdfFileTitle", () => {
  it("assemble les morceaux non vides avec un tiret simple", () => {
    expect(pdfFileTitle("Facture TTP-2026-004", "Nike x Sarah")).toBe("Facture TTP-2026-004 - Nike x Sarah");
    expect(pdfFileTitle("Brief", "", null, undefined)).toBe("Brief");
  });
  it("retire les caractères interdits et les tirets longs", () => {
    expect(pdfFileTitle("Contrat A/B : test?", "Marque — Créateur")).toBe("Contrat A B test - Marque - Créateur");
  });
  it("reste court", () => {
    expect(pdfFileTitle("x".repeat(300)).length).toBeLessThanOrEqual(120);
  });
});
