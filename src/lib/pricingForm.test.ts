import { describe, expect, it } from "vitest";
import { deliverablesText, missingAudienceText, priceRange, quoteInvoiceLines, ugcDeliverablesText } from "./pricingForm";

describe("page Tarifs : textes du résultat", () => {
  it("fourchette « 800 – 1 100 € HT »", () => {
    const plain = (s: string) => s.replace(/\s/g, " ");
    expect(plain(priceRange(800, 1100))).toBe("800 – 1 100 € HT");
    expect(plain(priceRange(950, 950))).toBe("950 € HT");
    expect(plain(priceRange(100, 200, false))).toBe("100 – 200 €");
  });
  it("dit ce qui manque", () => {
    expect(missingAudienceText([])).toBeNull();
    expect(missingAudienceText(["Instagram"])).toBe("Il manque les abonnés Instagram");
    expect(missingAudienceText(["Instagram", "TikTok", "Instagram", "YouTube"])).toBe("Il manque les abonnés Instagram, TikTok et YouTube");
  });
  it("livrables d'une collab : lignes identiques additionnées, lisibles par la page Collabs", () => {
    expect(
      deliverablesText([
        { platform: "instagram", format: "reel", qty: 1 },
        { platform: "instagram", format: "reel", qty: 1 },
        { platform: "tiktok", format: "video", qty: 1 },
        { platform: "instagram", format: "story", qty: 2 },
      ]),
    ).toBe("2 reels Instagram, 1 vidéo TikTok, 2 séries de stories Instagram");
    expect(ugcDeliverablesText([{ label: "Photo", qty: 3 }])).toBe("UGC : 3 × Photo");
    expect(ugcDeliverablesText([])).toBe("");
  });
  it("lignes de facture : somme = prix cible", () => {
    const lines = quoteInvoiceLines(
      [{ label: "Instagram · Reel × 2", mid: 900 }, { label: "TikTok · Vidéo × 1", mid: 0 }],
      { pct: 20, mid: 180 },
      { pct: 10, mid: 108 },
    );
    expect(lines).toEqual([
      { label: "Instagram · Reel × 2", unit: 900 },
      { label: "Majorations +20 %", unit: 180 },
      { label: "Remise pack −10 %", unit: -108 },
    ]);
    expect(lines.reduce((s, l) => s + l.unit, 0)).toBe(972);
  });
});
