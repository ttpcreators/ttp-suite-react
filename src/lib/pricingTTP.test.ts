import { describe, expect, it } from "vitest";
import { formatEuro, parseAmount } from "./money";
import {
  DEFAULT_TARIF_GRID, EMPTY_DEAL, francePctOf, mainAgeOf, pastRates, preChecks, priceTarif, readTarifGrid,
  splitHT, suggestedCoef, tarifAlerts, tarifCopyText, tarifGaps, tarifQuoteLines, tarifViews, type TarifDeal,
} from "./pricingTTP";

const g = DEFAULT_TARIF_GRID;
const deal = (p: Partial<TarifDeal>): TarifDeal => ({ ...EMPTY_DEAL, ...p });
const reel = (qty: number, views: number) => ({ key: "instagram.reel", label: "Reel Instagram", qty, views });
const story = (views: number) => ({ key: "instagram.story", label: "Story Instagram", qty: 1, views });

describe("méthode TARIF : calcul", () => {
  it("prix média × coefficient + production, majorations et remises en % de la base", () => {
    // Exemple du rapport : 2 reels à 20 000 vues + 1 séquence de stories à 3 000 vues,
    // production moyenne, coef 1,15, droits 3 mois, lien en bio, publication dans 10 jours.
    const r = priceTarif(deal({ lines: [reel(2, 20000), story(3000)], production: "moyen", coef: 1.15, rightsBlocks: 1, linkOrCode: true, delayDays: 10 }), g, 200);
    expect(r.lines.map((l) => [l.media, l.unitBase, l.base, l.majorations, l.remises, l.total])).toEqual([
      [500, 975, 1950, 585, 195, 2340],
      [36, 441, 441, 132, 44, 529],
    ]);
    expect([r.majPct, r.remPct]).toEqual([30, 10]); // droits +20, lien +10 ; package 3 contenus −10
    expect([r.target, r.anchor, r.floor]).toEqual([2869, 3440, 2152]);
    expect(r.effectiveCpm).toBe(66.7);
    expect(r.steps.map((s) => [s.label, s.amount, s.after])).toEqual([
      ["Ancrage → cible", 571, 2869],
      ["Sans droits organiques 3 mois", 478, 2391],
      ["Sans lien en bio ou code promo", 239, 2152],
    ]);
  });
  it("jamais sous le plancher du créateur", () => {
    const r = priceTarif(deal({ lines: [story(1000)] }), g, 200); // 12 € + 150 € < 200 €
    expect(r.lines[0]).toMatchObject({ unitBase: 200, floored: true });
    const strong = priceTarif(deal({ lines: [story(1000)], partnership: true, volumeWritten: true }), g, 200);
    expect(strong.target).toBe(200); // −15 % ramené au plancher
    expect(strong.targetFloored).toBe(true);
  });
  it("paid media sur sa ligne, urgence sous 7 jours, exclusivité par mois", () => {
    const r = priceTarif(deal({ lines: [reel(1, 10000)], paidMonths: 2, delayDays: 5, exclusivity: "large", exclusivityMonths: 2 }), g, 200);
    expect(r.base).toBe(400); // 250 + 150
    expect(r.paid.amount).toBe(200); // 25 % × 2 mois
    expect(r.majorations.map((m) => [m.id, m.pct])).toEqual([["exclusivity", 40], ["rush", 20]]);
    expect(r.target).toBe(400 + 240 + 200);
    expect(r.effectiveCpm).toBe(64); // hors paid media
  });
  it("remise partenariat seulement avec le volume garanti par écrit", () => {
    const sans = priceTarif(deal({ lines: [reel(1, 10000)], partnership: true }), g, 200);
    expect(sans.remises).toEqual([]);
    expect(sans.notes[0]).toMatch(/pas garanti par écrit/);
    const avec = priceTarif(deal({ lines: [reel(1, 10000)], partnership: true, volumeWritten: true }), g, 200);
    expect(avec.remPct).toBe(15);
  });
  it("sans vues : pas de prix, rien d'estimé", () => {
    const r = priceTarif(deal({ lines: [reel(1, 0), story(2000)] }), g, 200);
    expect(r.lines[0]).toMatchObject({ priced: false, total: 0 });
    expect([r.priced, r.complete]).toEqual([true, false]);
    expect(priceTarif(deal({ lines: [reel(1, 0)] }), g, 200).target).toBe(0);
  });
  it("retouches en plus au forfait, coefficient borné", () => {
    const r = priceTarif(deal({ lines: [reel(1, 10000)], extraRetouches: 2, coef: 3 }), g, 200);
    expect(r.lines[0].coef).toBe(1.5);
    expect(r.retouches.amount).toBe(160);
    expect(suggestedCoef(0)).toBe(1);
    expect(suggestedCoef(3)).toBe(1.45);
    expect(suggestedCoef(9)).toBe(1.5);
  });
});

describe("méthode TARIF : données et garde-fous", () => {
  it("pré-coche audience (France et femmes à 60 %) et expertise", () => {
    expect(preChecks({ francePct: 72, femalePct: 81, credibility: "lifestyle" })).toEqual({ audience: true, expertise: false });
    expect(preChecks({ francePct: 50, femalePct: 81, credibility: "coach" })).toEqual({ audience: false, expertise: true });
  });
  it("signale les manques et les moyennes", () => {
    const gaps = tarifGaps({
      lines: [{ label: "Reel Instagram", views: 12000, average: true }, { label: "Vidéo TikTok", views: 0, average: false }],
      platforms: [{ label: "Instagram", followers: 40000, erViews: 0 }],
      francePct: 70, femalePct: null, mainAge: "", credibility: "", delayDays: null,
    });
    expect(gaps.missing).toEqual(["Vues médianes : Vidéo TikTok", "Engagement sur les vues Instagram", "Audience : % femmes", "Audience : âge principal", "Crédibilité", "Délai brief → publication"]);
    expect(gaps.verify).toEqual(["Reel Instagram : moyenne, pas médiane"]);
  });
  it("lit l'audience du media kit", () => {
    expect(mainAgeOf([{ label: "18-24", pct: "31" }, { label: "25-34", pct: "44,5" }])).toBe("25-34");
    expect(francePctOf([{ name: "France", pct: "78" }, { name: "Belgique", pct: "6" }])).toBe(78);
    expect(francePctOf([{ name: "Belgique", pct: "6" }])).toBeNull();
  });
  it("précédent tarifaire cassé et deal trop bas", () => {
    const r = priceTarif(deal({ lines: [reel(1, 10000)] }), g, 200); // 400 € HT
    const alerts = tarifAlerts(
      r,
      { formats: { "instagram.reel": { amount: 600, date: "2026-09-01", ref: "F-1", party: "Marque Test", ht: true } }, brand: { amount: 900, date: "", ref: "F-2", party: "Marque Test", ht: true } },
      g, formatEuro, () => "1 sept.",
    );
    expect(alerts.map((a) => a.kind)).toEqual(["precedent", "precedent"]);
    expect(alerts[1].text).toContain("Reel Instagram facturé 600 € HT (échéance 1 sept.), ici 400 € HT");
    const low = priceTarif(deal({ lines: [story(100000)], partnership: true, volumeWritten: true }), { ...g, cpm: { ...g.cpm, "instagram.story": 5 } }, 200);
    expect(tarifAlerts(low, null, g, formatEuro, String).map((a) => a.kind)).toEqual(["trop-bas"]);
  });
  it("tarifs déjà facturés : prix d'un contenu par format, dernier total à la marque", () => {
    const inv = [
      { id: "a", ref: "F-1", party: "Marque Test", amount: "1 440,00 €", date: "2026-08-01", creator: "LÉNA TEST", status: "payee" },
      { id: "b", ref: "F-2", party: "Autre", amount: "500 €", date: "2026-09-01", creator: "Léna Test", status: "attente" },
      { id: "c", ref: "F-3", party: "Marque Test", amount: "2 000 €", date: "2026-10-01", creator: "Léna Test", status: "brouillon" },
    ];
    const items = { a: [{ label: "Instagram · Reel × 2", qty: 1, unit: 1200 }], b: [{ label: "Story", qty: 1, unit: 500 }] };
    const p = pastRates(inv, items, "Léna Test", "marque test", parseAmount);
    expect(p.formats).toEqual({ "instagram.reel": { amount: 600, date: "2026-08-01", ref: "F-1", party: "Marque Test", ht: true } });
    expect(p.brand).toMatchObject({ amount: 1200, ht: true, ref: "F-1" }); // brouillon ignoré
    expect(p.creatorInvoices).toBe(2);
  });
  it("répartition comme les factures : commission sur le HT, rien sous 100 €", () => {
    expect(splitHT(2869, 20)).toEqual({ agency: 574, creator: 2295 });
    expect(splitHT(90, 20)).toEqual({ agency: 0, creator: 90 });
  });
  it("barème : valeurs enregistrées par-dessus celles de départ", () => {
    const b = readTarifGrid({ cpm: { "instagram.reel": 30, "tiktok.video": -4 }, floor: "250", anchorPct: "x" });
    expect([b.cpm["instagram.reel"], b.cpm["tiktok.video"], b.floor, b.anchorPct]).toEqual([30, 18, 250, 20]);
  });
});

describe("méthode TARIF : devis et texte copié", () => {
  const r = priceTarif(deal({ lines: [reel(2, 20000), story(3000)], production: "moyen", coef: 1.15, rightsBlocks: 1, linkOrCode: true, delayDays: 10, extraRetouches: 1, paidMonths: 1 }), g, 200);
  it("lignes du devis : somme = cible", () => {
    const lines = tarifQuoteLines(r);
    expect(lines.reduce((s, l) => s + l.unit, 0)).toBe(r.target);
    expect(lines.map((l) => l.label)).toEqual([
      "Reel Instagram × 2", "Story Instagram × 1", "Majorations +30 % (droits organiques 3 mois, lien en bio ou code promo)",
      "Remises −10 % (package 3 contenus)", "Retouches en plus × 1", "Paid media 1 mois",
    ]);
    const floored = priceTarif(deal({ lines: [story(1000)], partnership: true, volumeWritten: true }), g, 200);
    expect(tarifQuoteLines(floored).reduce((s, l) => s + l.unit, 0)).toBe(200);
  });
  it("chaque montant copié porte À VÉRIFIER", () => {
    const t = tarifCopyText(r, "Léna", formatEuro, { missing: ["Crédibilité"], alerts: [], split: { ...splitHT(r.target, 20), pct: 20 } });
    expect(t).toContain("à valider par Marc avant tout envoi");
    expect(t).toContain("• Crédibilité");
    expect(t).toMatch(/Cible : [\d\s  ]+ € HT \(À VÉRIFIER\)/);
    expect(t).toContain("Paid media 1 mois (+25 %)");
  });
  it("vues du format, jamais celles d'un autre", () => {
    const a = { views: "20000", storyViews: "3000", shortViews: "", postViews: "" };
    expect([tarifViews("reel", a), tarifViews("story", a), tarifViews("short", a), tarifViews("carrousel", a)]).toEqual(["20000", "3000", "", ""]);
  });
});
