import { describe, it, expect } from "vitest";
import {
  parseFollowers, parseEr, engMult, roundNice,
  infItemRange, computeInfluence, nicheMult,
  computeUgc, ugcLevelMult,
  type InfItem,
} from "./pricing";

describe("parseurs", () => {
  it("lit abonnés K/M/espaces", () => {
    expect(parseFollowers("45K")).toBe(45000);
    expect(parseFollowers("1,2M")).toBe(1_200_000);
    expect(parseFollowers("45 000")).toBe(45000);
    expect(parseFollowers("")).toBe(0);
    expect(parseFollowers("abc")).toBe(0);
  });
  it("lit le taux d'engagement", () => {
    expect(parseEr("3,5 %")).toBe(3.5);
    expect(parseEr("nul")).toBe(0);
  });
  it("engMult est monotone par palier", () => {
    expect(engMult(0.5)).toBe(0.7);
    expect(engMult(3)).toBe(1.0);
    expect(engMult(9)).toBe(1.35);
  });
  it("roundNice arrondit sans jamais renvoyer NaN", () => {
    expect(roundNice(123)).toBe(120);
    expect(roundNice(1234)).toBe(1250);
    expect(roundNice(-5)).toBe(0);
    expect(roundNice(Number.NaN)).toBe(0);
  });
});

describe("influence — un livrable", () => {
  it("applique (abonnés/1000)×CPM×niche×engagement", () => {
    // 50 000 ab, IG reel CPM 16–32, niche ×1, ER 3 % (×1.0)
    // min = 50 × 16 = 800 ; max = 50 × 32 = 1600
    const item: InfItem = { platform: "instagram", format: "reel", qty: 1, followers: 50_000, er: 3 };
    const r = infItemRange(item, 1);
    expect(r.min).toBe(800);
    expect(r.max).toBe(1600);
  });
  it("la quantité multiplie", () => {
    const item: InfItem = { platform: "instagram", format: "reel", qty: 3, followers: 50_000, er: 3 };
    expect(infItemRange(item, 1).min).toBe(2400); // 800 × 3
  });
  it("audience nulle ou format inconnu → 0 (pas de prix inventé)", () => {
    expect(infItemRange({ platform: "instagram", format: "reel", qty: 1, followers: 0, er: 3 }, 1).min).toBe(0);
    expect(infItemRange({ platform: "instagram", format: "zzz", qty: 1, followers: 50_000, er: 3 }, 1).min).toBe(0);
  });
});

describe("influence — package cross-plateforme", () => {
  it("somme des livrables avec l'audience PROPRE à chaque plateforme", () => {
    // IG reel 45K @3% : 45×16=720 … 45×32=1440
    // TikTok vidéo 200K @5% (×1.15) : 200×11×1.15=2530 … 200×23×1.15=5290
    const items: InfItem[] = [
      { platform: "instagram", format: "reel", qty: 1, followers: 45_000, er: 3 },
      { platform: "tiktok", format: "video", qty: 1, followers: 200_000, er: 5 },
    ];
    const r = computeInfluence(items, 1, { exclusivite: false, droitsUsage: false, remisePct: 0 });
    // sumMin ≈ 720 + 2530 = 3250 (arrondi 50) ; sumMax ≈ 1440 + 5290 = 6750
    expect(r.min).toBe(3250);
    expect(r.max).toBe(6750);
    expect(r.itemsPriced).toHaveLength(2);
  });
  it("options exclusivité + droits appliquées au package entier", () => {
    const items: InfItem[] = [{ platform: "instagram", format: "reel", qty: 1, followers: 50_000, er: 3 }];
    const r = computeInfluence(items, 1, { exclusivite: true, droitsUsage: true, remisePct: 0 });
    expect(r.addon).toBeCloseTo(1.55, 5); // 1 + .25 + .30
    expect(r.min).toBe(roundNice(800 * 1.55)); // 1240
  });
  it("la remise de package s'applique et est bornée à 50 %", () => {
    const items: InfItem[] = [{ platform: "instagram", format: "reel", qty: 1, followers: 50_000, er: 3 }];
    expect(computeInfluence(items, 1, { exclusivite: false, droitsUsage: false, remisePct: 10 }).min).toBe(roundNice(800 * 0.9));
    expect(computeInfluence(items, 1, { exclusivite: false, droitsUsage: false, remisePct: 999 }).min).toBe(roundNice(800 * 0.5));
  });
  it("le multiplicateur de niche pousse le prix", () => {
    const items: InfItem[] = [{ platform: "instagram", format: "reel", qty: 1, followers: 50_000, er: 3 }];
    const base = computeInfluence(items, 1, { exclusivite: false, droitsUsage: false, remisePct: 0 }).min;
    const luxe = computeInfluence(items, nicheMult("finance"), { exclusivite: false, droitsUsage: false, remisePct: 0 }).min;
    expect(luxe).toBeGreaterThan(base);
  });
});

describe("UGC — forfait, indépendant de l'audience", () => {
  it("somme des forfaits × niveau", () => {
    // 2 vidéos courtes (120–280) : 240–560 ; niveau confirmé ×1 ; aucun droit
    const r = computeUgc([{ type: "video_court", qty: 2 }], 1, { usage: "none", exclusivite: false, rushes: false, montage: false, express: false });
    expect(r.min).toBe(240);
    expect(r.max).toBe(560);
  });
  it("les droits d'usage (ads) sont le cœur du prix UGC", () => {
    const org = computeUgc([{ type: "video_court", qty: 1 }], 1, { usage: "none", exclusivite: false, rushes: false, montage: false, express: false });
    const ads = computeUgc([{ type: "video_court", qty: 1 }], 1, { usage: "ads6", exclusivite: false, rushes: false, montage: false, express: false });
    expect(ads.addon).toBeCloseTo(1.5, 5); // +50 %
    expect(ads.min).toBeGreaterThan(org.min);
  });
  it("le niveau d'expérience multiplie", () => {
    const conf = computeUgc([{ type: "photo", qty: 1 }], ugcLevelMult("confirme"), { usage: "none", exclusivite: false, rushes: false, montage: false, express: false });
    const exp = computeUgc([{ type: "photo", qty: 1 }], ugcLevelMult("expert"), { usage: "none", exclusivite: false, rushes: false, montage: false, express: false });
    expect(exp.min).toBeGreaterThan(conf.min);
  });
  it("options cumulées", () => {
    const r = computeUgc([{ type: "video_long", qty: 1 }], 1, { usage: "ads3", exclusivite: true, rushes: true, montage: true, express: true });
    // 1 + .30 + .25 + .15 + .20 + .20 = 2.10
    expect(r.addon).toBeCloseTo(2.1, 5);
  });
});
