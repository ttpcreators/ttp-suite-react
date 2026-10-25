import { describe, expect, it } from "vitest";
import { creatorAudience, audienceForAll, NO_AUD } from "./creatorAudience";
import { kitRatesFromPrices, mergeRates, ratesForItems, ratesFromPricing, sameLabel, unitRatePrice } from "./mediakitRates";
import { infItemRange } from "./pricing";

describe("tarifs → media kit", () => {
  const ig = { ...NO_AUD, followers: "50000", er: "4", erBase: "followers" as const };

  it("prix d'un contenu = prix cible du calculateur (quantité 1), en chiffres comme dans l'éditeur", () => {
    const mid = infItemRange({ platform: "instagram", format: "reel", qty: 1, followers: 50000, er: 4, views: 0, erBase: "followers" }, 1).mid;
    expect(unitRatePrice("instagram", "reel", ig, "lifestyle")).toBe(String(mid));
    expect(unitRatePrice("instagram", "reel", NO_AUD, "lifestyle")).toBe("");
  });

  it("libellés du kit (traduits par le site) et précision des lots de stories", () => {
    const rows = ratesForItems([{ platform: "instagram", format: "reel", aud: ig }, { platform: "instagram", format: "story", aud: ig }, { platform: "instagram", format: "reel", aud: ig }], "lifestyle");
    expect(rows.map((r) => r.label)).toEqual(["Réel Instagram", "Story Instagram"]);
    expect(rows[1]).toMatchObject({ detail: "Lot de 3 stories", detailEn: "Set of 3 stories" });
  });

  it("grille complète : plateformes avec abonnés, et ce qui manque, sans inventer", () => {
    const a = creatorAudience({ followers: "", er: "", platform: "TikTok", niche: "Beauté", ig: { followers: 50000, er: 4 }, mediakit: { platforms: [{ key: "youtube" }] } });
    const { rows, missing } = ratesFromPricing(a);
    expect(rows.map((r) => r.label)).toEqual(["Réel Instagram", "Carrousel Instagram", "Story Instagram"]);
    expect(missing).toEqual(["TikTok", "YouTube"]);
    expect(a.niche).toBe("beaute");
    expect(audienceForAll(a).tiktok).toBe(a.fallback);
  });

  it("fusion : remplace au même intitulé (accents, casse), garde le reste, ajoute le nouveau", () => {
    const existing = [{ label: "reel instagram", price: "900", detail: "+ 2 repartages" }, { label: "Pack sur mesure", price: "Sur devis" }];
    const m = mergeRates(existing, [{ label: "Réel Instagram", price: "1200" }, { label: "Vidéo TikTok", price: "800" }]);
    expect(m.rates).toEqual([
      { label: "reel instagram", price: "1200", detail: "+ 2 repartages" },
      { label: "Pack sur mesure", price: "Sur devis" },
      { label: "Vidéo TikTok", price: "800" },
    ]);
    expect(m.replaced).toEqual([{ label: "reel instagram", price: "1200", detail: "+ 2 repartages", from: "900" }]);
    expect(m.added.map((r) => r.label)).toEqual(["Vidéo TikTok"]);
    expect(mergeRates(m.rates, [{ label: "Vidéo TikTok", price: "800" }]).replaced).toEqual([]);
    expect(sameLabel("Réel  Instagram", "reel-instagram")).toBe(true);
  });
});

describe("tarifs → media kit, méthode TARIF", () => {
  it("prix d'un contenu par format, sans doublon ni prix nul", () => {
    expect(kitRatesFromPrices([
      { platform: "instagram", format: "reel", price: 975 },
      { platform: "instagram", format: "reel", price: 990 },
      { platform: "instagram", format: "story", price: 441.4 },
      { platform: "tiktok", format: "video", price: 0 },
    ])).toEqual([
      { label: "Réel Instagram", price: "975" },
      { label: "Story Instagram", price: "441", detail: "Lot de 3 stories", detailEn: "Set of 3 stories" },
    ]);
  });
});
