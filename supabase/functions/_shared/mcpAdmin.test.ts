import { describe, expect, it } from "vitest";
import { addressList, blockedSetting, euro2, invoiceParty, invoiceTotals, mailHtml, nextInvoiceRef, nextQuoteRef, pct, sparkLink, readableRow, writableFields } from "./mcpAdmin.ts";

describe("accès complet de Claude", () => {
  it("champs modifiables : jamais l'id, la synchro Google ni un secret", () => {
    expect(writableFields("contacts", { email: "a@b.fr", id: "x", created_at: "y", api_token: "z" })).toEqual({ ok: { email: "a@b.fr" }, refused: ["id", "created_at", "api_token"] });
    expect(writableFields("events", { title: "Call", google_event_id: "g" }).refused).toEqual(["google_event_id"]);
    // Factures : seulement statut, échéance, créateur, collab (le reste passe par preparer_facture).
    expect(writableFields("invoices", { status: "payee", amount: "1 €" })).toEqual({ ok: { status: "payee" }, refused: ["amount"] });
  });
  it("colonnes JSON : un objet envoyé en texte est enregistré en objet", () => {
    // Bug du 20/11/2026 : un media kit créé par Claude (creer_element) avait été envoyé en texte. La
    // colonne jsonb gardait une chaîne, que le générateur des media kits du site ne savait pas lire.
    const kit = { slug: "zoe", bio: "Bio fictive", platforms: [{ key: "instagram", followers: "1000" }] };
    expect(writableFields("creators", { name: "Zoé Test", mediakit: JSON.stringify(kit) })).toEqual({ ok: { name: "Zoé Test", mediakit: kit }, refused: [] });
    expect(writableFields("todos", { subtasks: ' [{"text":"Appeler"}]' }).ok.subtasks).toEqual([{ text: "Appeler" }]);
    // Déjà un objet : inchangé. Une colonne texte garde son texte, même entre accolades.
    expect(writableFields("creators", { mediakit: kit }).ok.mediakit).toBe(kit);
    expect(writableFields("todos", { text: "{à trier}" }).ok.text).toBe("{à trier}");
    // La proposition d'un prospect est du texte rangé dans une colonne JSON : elle reste du texte.
    expect(writableFields("prospects", { proposal: "Deux Reels en janvier" }).ok.proposal).toBe("Deux Reels en janvier");
    // Du texte qui n'est pas un objet JSON (ex. recopié d'une lecture raccourcie) : refusé, jamais enregistré.
    expect(writableFields("creators", { mediakit: '{"bio":"Coach… (1588 caractères)' })).toEqual({ ok: {}, refused: ["mediakit (objet JSON attendu)"] });
    expect(writableFields("creators", { stats: "12 000 abonnés" }).refused).toEqual(["stats (objet JSON attendu)"]);
  });
  it("lecture sans secret, valeurs longues raccourcies", () => {
    const r = readableRow({ name: "Léa", access_token: "t", stats_history: "x".repeat(2000) }, 10);
    expect(r.access_token).toBeUndefined();
    expect(String(r.stats_history)).toMatch(/^x{10}… \(2000 caractères\)$/);
    // Un objet raccourci le dit, pour que Claude ne le prenne pas pour du texte à recopier tel quel.
    expect(readableRow({ mediakit: { bio: "x".repeat(50) } }, 10).mediakit).toBe('{"bio":"xx… (objet JSON de 60 caractères, raccourci)');
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
    // Devis : suite de l'année en cours, à partir de 001, sans compter les autres années.
    expect(nextQuoteRef(["D-2026-004", "D-2025-120", "D-2026-011"], 2026)).toBe("D-2026-012");
    expect(nextQuoteRef(["D-2025-120"], 2026)).toBe("D-2026-001");
    expect(euro2(1273)).toBe("1 273,00 €");
    expect(invoiceParty("Kora", "zoé morel")).toBe("Kora × Zoé");
    expect(pct("25,5 %")).toBe(25.5);
  });
  it("mail : texte échappé, liens, signature", () => {
    const h = mailHtml("Bonjour <3\nhttps://ttpcreators.pro/mediakit/zoe/", "<b>Marc</b>");
    expect(h).toContain("&lt;3");
    expect(h).toContain('<a href="https://ttpcreators.pro/mediakit/zoe/">');
    expect(h).toContain('<div class="ttp-signature"><b>Marc</b></div>');
    // Sauts de ligne en <br> (Gmail et Spark ignorent white-space:pre-line), lignes vides gardées.
    const p = mailHtml("Hello Inès,\r\n\r\nTop, merci !\nÀ très vite");
    expect(p).toContain("Hello Inès,<br><br>Top, merci !<br>À très vite");
    expect(p).not.toContain("pre-line");
    // Lien Spark : même jeton que celui que Spark ouvre (vérifié sur un vrai brouillon).
    expect(sparkLink("partnerships@ttpcreators.pro", "<CAJx0e2ZtGOFUs=ZjaN-gnguRAsHy9OyhsR+bRDh6xwLY02UJxg@mail.gmail.com>", "1a1ae2f80e638772"))
      .toBe("https://sparkmailapp.com/dpl/bl?token=QTpwYXJ0bmVyc2hpcHNAdHRwY3JlYXRvcnMucHJvO0lEOkNBSngwZTJadEdPRlVzPVpqYU4tZ25ndVJBc0h5OU95aHNSK2JSRGg2eHdMWTAyVUp4Z0BtYWlsLmdtYWlsLmNvbTtnSUQ6MTg4MTA2NTM0OTQwMTc3MzkzOA%3D%3D");
    expect(sparkLink("", "x@y", "1a1a")).toBe("");
    expect(addressList("A@b.fr, c@d.com")).toEqual(["a@b.fr", "c@d.com"]);
    expect(addressList("pas une adresse")).toBeNull();
  });
});

describe("factures préparées par Claude (audit 2026-11-11)", () => {
  it("TVA : suit le régime réglé dans Compta, franchise par défaut", async () => {
    const { defaultFranchise } = await import("./mcpAdmin.ts");
    expect(defaultFranchise(undefined, undefined, undefined, undefined)).toBe(true);
    expect(defaultFranchise(undefined, undefined, undefined, { vatRegime: "franchise" })).toBe(true);
    expect(defaultFranchise(undefined, undefined, undefined, { vatRegime: "assujetti" })).toBe(false);
    expect(defaultFranchise(undefined, undefined, false, { vatRegime: "franchise" })).toBe(false); // facture existante
    expect(defaultFranchise(undefined, 20, undefined, { vatRegime: "franchise" })).toBe(false); // taux demandé
    expect(defaultFranchise(true, 20, false, { vatRegime: "assujetti" })).toBe(true); // demandé noir sur blanc
  });
  it("facture émise : lignes, TVA et commission ne se modifient plus ici", async () => {
    const { lockedInvoiceChange, INVOICE_STATUSES } = await import("./mcpAdmin.ts");
    expect(lockedInvoiceChange("brouillon", { lignes: [] })).toBe(false);
    expect(lockedInvoiceChange("payee", { statut: "payee", notes: "ok" })).toBe(false);
    expect(lockedInvoiceChange("attente", { lignes: [] })).toBe(true);
    expect(lockedInvoiceChange("payee", { commission: 10 })).toBe(true);
    expect(INVOICE_STATUSES).toContain("annulee");
  });
});

describe("réglages jamais lus ni écrits par Claude (audit 2026-11-11)", () => {
  it("comptes bancaires, émetteur des factures, destinataires de la sauvegarde", () => {
    for (const k of ["invoiceBankAccounts", "invoiceIssuer", "backupRecipients", "credVault", "trashBin"]) expect(blockedSetting(k)).toBe(true);
    expect(blockedSetting("pricingRates")).toBe(false);
  });
});
