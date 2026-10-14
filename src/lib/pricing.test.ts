import { describe, it, expect } from "vitest";
import {
  parseFollowers, parseEr, engMult, roundNice,
  infItemRange, computeInfluence, nicheMult,
  computeUgc, ugcLevelMult, campaignCosts,
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

describe("influence — sur les vues réelles", () => {
  it("à vues habituelles, même prix qu'avec les abonnés", () => {
    // Reel IG : taux habituel 30 % → 50 000 ab ≈ 15 000 vues.
    const a = infItemRange({ platform: "instagram", format: "reel", qty: 1, followers: 50_000, er: 3 }, 1);
    const b = infItemRange({ platform: "instagram", format: "reel", qty: 1, followers: 50_000, er: 3, views: 15_000 }, 1);
    expect(b.min).toBe(a.min);
    expect(b.max).toBe(a.max);
    expect(a.estimated).toBe(true);
    expect(b.estimated).toBe(false);
  });
  it("plus de vues réelles = plus cher, moins de vues = moins cher", () => {
    const base = { platform: "tiktok" as const, format: "video", qty: 1, followers: 100_000, er: 5, erBase: "views" as const };
    const low = infItemRange({ ...base, views: 10_000 }, 1);
    const high = infItemRange({ ...base, views: 80_000 }, 1);
    expect(high.min).toBeGreaterThan(low.min * 7);
  });
  it("l'engagement sur les vues a son propre barème", () => {
    const it0 = { platform: "tiktok" as const, format: "video", qty: 1, followers: 100_000, views: 30_000 };
    expect(infItemRange({ ...it0, er: 12, erBase: "views" }, 1).engM).toBe(1.25);
    expect(infItemRange({ ...it0, er: 1, erBase: "views" }, 1).engM).toBe(0.85);
  });
  it("explique le calcul", () => {
    const r = infItemRange({ platform: "tiktok", format: "video", qty: 2, followers: 100_000, er: 5, erBase: "views", views: 31_800 }, 1.1);
    expect(r.explain).toContain("31,8K vues attendues × 2");
    expect(r.explain).toContain("€ / 1000 vues");
    expect(r.explain).toContain("niche 1,1");
  });
  it("le barème de l'agence remplace celui par défaut", () => {
    const a = infItemRange({ platform: "instagram", format: "reel", qty: 1, followers: 50_000, er: 3 }, 1, { "instagram.reel": { cpm: [32, 64] } });
    expect(a.min).toBe(1600);
  });
});

describe("options et bilan", () => {
  it("durées d'exclusivité, de droits et pub depuis le compte de la créatrice", () => {
    const items: InfItem[] = [{ platform: "instagram", format: "reel", qty: 1, followers: 50_000, er: 3 }];
    const r = computeInfluence(items, 1, { exclusivite: "3m", droitsUsage: "ads6", whitelisting: true, remisePct: 0 });
    expect(r.addon).toBeCloseTo(1 + 0.25 + 0.5 + 0.2, 5);
  });
  it("coûts réels d'une campagne", () => {
    const c = campaignCosts(2000, { views: 100_000, reach: 80_000, interactions: 5000 });
    expect(c.cpm).toBe(20);
    expect(c.cpmReach).toBe(25);
    expect(c.cpe).toBe(0.4);
    expect(campaignCosts(0, { views: 1, reach: 1, interactions: 1 }).cpm).toBeNull();
  });
});
