import { describe, expect, it } from "vitest";
import { brandRecord, mergeMailHistory, partyBrand, sameBrand } from "./brandRecord";

describe("fiche marque", () => {
  it("reconnaît la marque malgré accents, casse et espaces", () => {
    expect(sameBrand("Décathlon", "decathlon")).toBe(true);
    expect(sameBrand("Alo Yoga", "aloyoga")).toBe(true);
    expect(sameBrand("Nike", "Nikon")).toBe(false);
    expect(sameBrand("", "Nike")).toBe(false);
    expect(partyBrand("Nike x Léna")).toBe("Nike");
    expect(partyBrand("Alo Yoga × Camille")).toBe("Alo Yoga");
    expect(partyBrand("Asics")).toBe("Asics");
  });

  it("collabs, chiffre d'affaires et gifts de la marque", () => {
    const r = brandRecord("Nike", {
      collabs: [
        { id: "c1", brand: "NIKE", creator: "Léna", step: 11, status: "gagnee", created_at: "2026-01-01" },
        { id: "c2", brand: "Nike", creator: "Sarah", step: 3, status: "active", created_at: "2026-09-01" },
        { id: "c3", brand: "Asics", creator: "Léna", step: 3, status: "active" },
      ],
      invoices: [
        { id: "i1", party: "Nike x Léna", amount: "1 200 €", status: "payee" },
        { id: "i2", party: "Campagne été", amount: "800", status: "payee", collab_id: "c2" },
        { id: "i3", party: "Nike x Sarah", amount: "500", status: "attente" },
        { id: "i4", party: "Asics x Léna", amount: "900", status: "payee" },
      ],
      gifting: [
        { id: "g1", brand: "nike", creator: "Léna", product: "Air Max", value: "150" },
        { id: "g2", brand: "Hoka", creator: "Léna", product: "Clifton", value: "140" },
      ],
    });
    expect(r.collabs.map((c) => c.id)).toEqual(["c2", "c1"]); // en cours d'abord
    expect(r.revenue).toBe(2000);
    expect(r.paidCount).toBe(2);
    expect(r.gifts.map((g) => g.id)).toEqual(["g1"]);
  });

  it("CA inconnu quand les factures sont illisibles (membre)", () => {
    expect(brandRecord("Nike", { collabs: [], invoices: null, gifting: [] }).revenue).toBeNull();
  });

  it("fusionne l'historique Gmail et email_activity sans doublon", () => {
    const gmail = [{ id: "m1", subject: "Proposition Léna", date: "2026-10-01T10:00:00Z", snippet: "", direction: "out" as const }];
    const act = [
      { id: "a1", gmail_message_id: "m1", subject: "Proposition Léna", direction: "out", created_at: "2026-10-01T10:00:00Z" },
      { id: "a2", subject: "Re: Proposition Léna", direction: "out", created_at: "2026-10-01T18:00:00Z" },
      { id: "a3", subject: "Media kit", direction: "out", created_at: "2026-09-01T09:00:00Z" },
    ];
    expect(mergeMailHistory(gmail, act).map((m) => m.id)).toEqual(["m1", "act:a3"]);
  });
});
