import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_TARIF_GRID, creatorFloor, creatorTarifText, formatOfLabel, gridDiff, gridText, methodText, pastRates, pastRatesText, readTarifGrid } from "./tarif.ts";

describe("méthode TARIF (partagée app et Claude)", () => {
  it("valeurs de départ de la méthode", () => {
    const g = DEFAULT_TARIF_GRID;
    expect([g.cpm["instagram.reel"], g.cpm["tiktok.video"], g.cpm["instagram.story"], g.cpm["instagram.carrousel"]]).toEqual([25, 18, 12, 20]);
    expect(g.production).toEqual({ simple: 150, moyen: 400, elabore: 900 });
    expect([g.floor, g.rightsPct, g.paidPct, g.exclRestrictedPct, g.exclWidePct, g.rushPct, g.linkPct, g.extraRetouch, g.packPct, g.partnerPct, g.anchorPct, g.minCpm])
      .toEqual([200, 20, 25, 10, 20, 20, 10, 80, 10, 15, 20, 10]);
  });
  it("barème enregistré : seulement ce qui change, illisible = valeur de départ", () => {
    const g = readTarifGrid({ cpm: { "instagram.reel": 28 }, production: { moyen: "450" }, minCpm: -1 });
    expect(gridDiff(g)).toEqual({ cpm: { "instagram.reel": 28 }, production: { moyen: 450 } });
    expect(readTarifGrid(null)).toEqual(DEFAULT_TARIF_GRID);
    expect(gridDiff(DEFAULT_TARIF_GRID)).toEqual({});
  });
  it("plancher par créateur", () => {
    expect(creatorFloor({ c1: 350 }, "c1", DEFAULT_TARIF_GRID)).toEqual({ value: 350, own: true });
    expect(creatorFloor({ c1: 0 }, "c1", DEFAULT_TARIF_GRID)).toEqual({ value: 200, own: false });
    expect(creatorFloor(undefined, null, DEFAULT_TARIF_GRID)).toEqual({ value: 200, own: false });
  });
  it("format d'une ligne de facture, jamais deviné", () => {
    expect(formatOfLabel("Instagram · Reel × 2")).toEqual({ key: "instagram.reel", count: 2 });
    expect(formatOfLabel("2 reels")).toEqual({ key: "instagram.reel", count: 2 });
    expect(formatOfLabel("Vidéo TikTok")).toEqual({ key: "tiktok.video", count: 1 });
    expect(formatOfLabel("TikTok · Story × 1")).toEqual({ key: "tiktok.story", count: 1 });
    expect(formatOfLabel("Story")).toBeNull();
    expect(formatOfLabel("Majorations +30 %")).toBeNull();
  });
  it("texte de la méthode : barème en vigueur et garde-fous", () => {
    const t = methodText(readTarifGrid({ cpm: { "instagram.reel": 31 } }));
    expect(t).toContain("- Reel Instagram : 31 €");
    expect(t).toContain("Aucun prix transmis à une marque sans validation de Marc.");
    expect(gridText(DEFAULT_TARIF_GRID)).toContain("Ancrage = cible +20 %");
  });
  it("docs/methode-tarif.md reprend la méthode avec les valeurs de départ", () => {
    const doc = readFileSync(new URL("../../../docs/methode-tarif.md", import.meta.url), "utf8");
    expect(doc).toContain(methodText(DEFAULT_TARIF_GRID).trim());
  });
});

describe("outil Claude methode_tarif : textes", () => {
  it("chiffres du créateur : manques et moyennes signalés, rien d'estimé", () => {
    const t = creatorTarifText(
      {
        name: "Léna Test", niche: "fitness", platform: "Instagram", followers: "40 000", er: "", commission: "",
        mediakit: { platforms: [{ key: "instagram", followers: "40000", er: "4,2", avgViews: "12000" }], audience: { pays: [{ name: "France", pct: "78" }], gender: { femmes: "81" } } },
      },
      { value: 200, own: false },
    );
    expect(t).toContain("engagement MANQUANT");
    expect(t).toContain("Commission de l'agence : 20 % (défaut, pas sur la fiche)");
    expect(t).toContain("vues 12000 (moyenne, pas médiane : à vérifier) · vues story MANQUANT");
    expect(t).toContain("Audience : France 78 % · femmes 81 % · âges MANQUANT");
  });
  it("tarifs déjà facturés", () => {
    const p = pastRates(
      [{ id: "a", ref: "F-1", party: "Marque Test", amount: "1 440 €", date: "2026-08-01", creator: "Léna Test", status: "payee" }],
      { a: [{ label: "Instagram · Reel × 2", qty: 1, unit: 1200 }] },
      "Léna Test",
      "Marque Test",
      (s) => parseFloat(String(s).replace(/\s/g, "")) || 0,
    );
    const t = pastRatesText(p, "Marque Test");
    expect(t).toContain("- Reel Instagram : 600 € · Marque Test · facture F-1 · échéance 2026-08-01");
    expect(t).toContain("Dernier total facturé à Marque Test : 1 200 € HT");
    expect(pastRatesText({ formats: {}, brand: null }, "Inconnue")).toContain("Aucune facture retrouvée pour la marque « Inconnue »");
  });
});
