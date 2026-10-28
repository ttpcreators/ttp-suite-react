import { describe, expect, it } from "vitest";
import { addressList, blockedSetting, euro2, invoiceParty, invoiceTotals, mailHtml, nextInvoiceRef, pct, readableRow, writableFields } from "./mcpAdmin.ts";

describe("accès complet de Claude", () => {
  it("champs modifiables : jamais l'id, la synchro Google ni un secret", () => {
    expect(writableFields("contacts", { email: "a@b.fr", id: "x", created_at: "y", api_token: "z" })).toEqual({ ok: { email: "a@b.fr" }, refused: ["id", "created_at", "api_token"] });
    expect(writableFields("events", { title: "Call", google_event_id: "g" }).refused).toEqual(["google_event_id"]);
    // Factures : seulement statut, échéance, créateur, collab (le reste passe par preparer_facture).
    expect(writableFields("invoices", { status: "payee", amount: "1 €" })).toEqual({ ok: { status: "payee" }, refused: ["amount"] });
  });
  it("lecture sans secret, valeurs longues raccourcies", () => {
    const r = readableRow({ name: "Léa", access_token: "t", stats_history: "x".repeat(2000) }, 10);
    expect(r.access_token).toBeUndefined();
    expect(String(r.stats_history)).toMatch(/^x{10}… \(2000 caractères\)$/);
  });
  it("réglages interdits", () => {
    expect(blockedSetting("credVault")).toBe(true);
    expect(blockedSetting("trashBin")).toBe(true);
    expect(blockedSetting("pricingRates")).toBe(false);
  });
  it("facture : mêmes calculs que Facturation", () => {
    expect(invoiceTotals([{ id: "1", label: "Reel", qty: 2, unit: 750 }], false, 20, 25)).toEqual({ ht: 1500, tva: 300, ttc: 1800, commission: 375, reversal: 1125 });
    expect(invoiceTotals([{ id: "1", label: "Story", qty: 1, unit: 80 }], true, 20, 25).commission).toBe(0);
    expect(nextInvoiceRef(["2026-190", "2026-191", "brouillon"], 2026)).toBe("2026-192");
    expect(nextInvoiceRef([], 2026)).toBe("2026-181");
    expect(euro2(1273)).toBe("1 273,00 €");
    expect(invoiceParty("Aroma Zone", "ana milanovic")).toBe("Aroma Zone × Ana");
    expect(pct("25,5 %")).toBe(25.5);
  });
  it("mail : texte échappé, liens, signature", () => {
    const h = mailHtml("Bonjour <3\nhttps://ttpcreators.pro/mediakit/ana/", "<b>Marc</b>");
    expect(h).toContain("&lt;3");
    expect(h).toContain('<a href="https://ttpcreators.pro/mediakit/ana/">');
    expect(h).toContain('<div class="ttp-signature"><b>Marc</b></div>');
    expect(addressList("A@b.fr, c@d.com")).toEqual(["a@b.fr", "c@d.com"]);
    expect(addressList("pas une adresse")).toBeNull();
  });
});
