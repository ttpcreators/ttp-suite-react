import { describe, it, expect } from "vitest";
import {
  parseFollowers, parseEr, engMult, roundNice,
  infItemRange, computeInfluence, nicheMult,
  computeUgc, ugcLevelMult, campaignCosts, quoteTotals,
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
    // Lignes affichées : 720 + 2 550 (2 530 arrondi) ; 1 450 + 5 300. Le total est la
    // SOMME des lignes affichées (avant : 3 250, qui ne tombait pas juste avec 720 + 2 550).
    expect(r.itemsPriced.map((x) => x.min)).toEqual([720, 2550]);
    expect(r.min).toBe(3270);
    expect(r.max).toBe(6750);
    expect(r.itemsPriced).toHaveLength(2);
  });
  it("options exclusivité + droits appliquées au package entier", () => {
    const items: InfItem[] = [{ platform: "instagram", format: "reel", qty: 1, followers: 50_000, er: 3 }];
    const r = computeInfluence(items, 1, { exclusivite: true, droitsUsage: true, remisePct: 0 });
    expect(r.addon).toBeCloseTo(1.55, 5); // 1 + .25 + .30
    // 800 € + 55 % (440 €) = 1 240 € exact (avant : arrondi à 1 250, sans ligne pour l'expliquer)
    expect(r.min).toBe(800 + 440);
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
    // 100 000 abonnés TikTok : habituel 30 000 vues, plafond 45 000.
    const base = { platform: "tiktok" as const, format: "video", qty: 1, followers: 100_000, er: 5, erBase: "views" as const };
    const low = infItemRange({ ...base, views: 10_000 }, 1);
    const high = infItemRange({ ...base, views: 40_000 }, 1);
    expect(high.min).toBeGreaterThan(low.min * 3.5);
    expect(high.capped).toBe(false);
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

describe("lecture des abonnés : un seul analyseur (F3)", () => {
  it("séparateurs de milliers et approximations (avant : 12, 12, 1 et 0)", () => {
    expect(parseFollowers("12.000")).toBe(12000);
    expect(parseFollowers("12,000")).toBe(12000);
    expect(parseFollowers("1,200,000")).toBe(1_200_000);
    expect(parseFollowers("~12k")).toBe(12000);
  });
  it("garde les formes déjà lues", () => {
    expect(parseFollowers("12,5k")).toBe(12500);
    expect(parseFollowers("1.2M")).toBe(1_200_000);
    expect(parseFollowers("12 000")).toBe(12000);
    expect(parseFollowers("45K abonnés")).toBe(45000);
    expect(parseFollowers("")).toBe(0);
    expect(parseFollowers(null)).toBe(0);
  });
});

describe("engagement inconnu = neutre (F4)", () => {
  it("engMult(0) et négatif → 1 (avant : 0,7)", () => {
    expect(engMult(0)).toBe(1);
    expect(engMult(-3)).toBe(1);
    expect(engMult(Number.NaN)).toBe(1);
    expect(engMult(0.5)).toBe(0.7); // un vrai taux < 1 % reste pénalisé
  });
  it("un livrable sans engagement saisi n'est plus baissé de 30 %", () => {
    // 50 000 ab, reel : 800 à 1 600 € (avant : 560 à 1 120 €)
    const r = infItemRange({ platform: "instagram", format: "reel", qty: 1, followers: 50_000, er: 0 }, 1);
    expect(r.min).toBe(800);
    expect(r.max).toBe(1600);
    expect(r.engM).toBe(1);
  });
});

describe("vues réelles plafonnées (R2)", () => {
  const tk = { platform: "tiktok" as const, format: "video", qty: 1, followers: 50_000, er: 0, erBase: "views" as const };
  it("une moyenne virale ne dépasse pas 1,5 × les vues habituelles", () => {
    // 50 000 abonnés × 30 % = 15 000 vues habituelles → plafond 22 500.
    // Avant : 600 000 vues → 22 000 à 46 000 € ; après : prix à 22 500 vues (830 à 1 750 €).
    const viral = infItemRange({ ...tk, views: 600_000 }, 1);
    const atCap = infItemRange({ ...tk, views: 22_500 }, 1);
    expect(viral.capped).toBe(true);
    expect(viral.views).toBe(22_500);
    expect(viral.min).toBe(atCap.min);
    expect(viral.max).toBe(atCap.max);
    expect(viral.min).toBe(830);
    expect(viral.max).toBe(1750);
    expect(viral.explain).toContain("vues plafonnées");
    expect(viral.explain).toContain("600K mesurées");
  });
  it("sous le plafond, ou sans abonnés connus : vues réelles telles quelles", () => {
    expect(infItemRange({ ...tk, views: 20_000 }, 1).capped).toBe(false);
    const noFol = infItemRange({ ...tk, followers: 0, views: 600_000 }, 1);
    expect(noFol.capped).toBe(false);
    expect(noFol.views).toBe(600_000);
  });
});

describe("proposition cohérente : lignes + options − remise = total (F6)", () => {
  const reel: InfItem = { platform: "instagram", format: "reel", qty: 1, followers: 50_000, er: 3 };
  it("options et remise en euros, total exact à l'euro", () => {
    // 800 € + 95 % (760 €) = 1 560 € ; remise 10 % (156 €) → 1 404 €
    const r = computeInfluence([reel], 1, { exclusivite: "3m", droitsUsage: "ads6", whitelisting: true, remisePct: 10 });
    expect(r.sub.min).toBe(800);
    expect(r.optionsPct).toBe(95);
    expect(r.options.min).toBe(760);
    expect(r.discountPct).toBe(10);
    expect(r.discount.min).toBe(156);
    expect(r.min).toBe(1404);
    for (const k of ["min", "max", "mid"] as const) expect(r[k]).toBe(r.sub[k] + r.options[k] - r.discount[k]);
  });
  it("le total est la somme des lignes affichées, lignes à 0 € comprises pour rien", () => {
    const items: InfItem[] = [reel, { platform: "tiktok", format: "video", qty: 2, followers: 0, er: 0 }, { platform: "youtube", format: "short", qty: 3, followers: 33_333, er: 4.2 }];
    const r = computeInfluence(items, 1.1, { exclusivite: "none", droitsUsage: "none", remisePct: 0 });
    expect(r.itemsPriced[1].max).toBe(0);
    expect(r.min).toBe(r.itemsPriced.reduce((s, x) => s + x.min, 0));
    expect(r.max).toBe(r.itemsPriced.reduce((s, x) => s + x.max, 0));
  });
  it("quoteTotals : sans option ni remise, rien n'est ajouté", () => {
    const q = quoteTotals([{ min: 100, max: 200, mid: 150 }], 1, 0);
    expect(q).toMatchObject({ min: 100, max: 200, mid: 150, optionsPct: 0, discountPct: 0 });
    expect(q.options.max).toBe(0);
    expect(q.discount.max).toBe(0);
  });
  it("UGC : le niveau est dans chaque ligne, le total tombe juste", () => {
    // Photo 50 à 130 € × expert 1,35 = 67,5 → 70 € ; 175,5 → 180 €
    const r = computeUgc([{ type: "photo", qty: 1 }], ugcLevelMult("expert"), { usage: "ads3", exclusivite: false, rushes: false, montage: false, express: false });
    expect(r.itemsPriced[0].min).toBe(70);
    expect(r.itemsPriced[0].max).toBe(180);
    expect(r.options.min).toBe(21); // +30 %
    expect(r.min).toBe(91);
    for (const k of ["min", "max", "mid"] as const) expect(r[k]).toBe(r.sub[k] + r.options[k] - r.discount[k]);
  });
});

describe("coûts du bilan seulement sur des chiffres complets (F7)", () => {
  const t = { views: 100_000, reach: 80_000, interactions: 5000 };
  it("un contenu sans vues → pas de coût pour 1000 vues", () => {
    const c = campaignCosts(2000, t, [{ views: 100_000, reach: 50_000 }, { views: 0, reach: 30_000 }]);
    expect(c.cpm).toBeNull();
    expect(c.cpmReach).toBe(25);
  });
  it("un contenu sans couverture (TikTok) → pas de coût pour 1000 personnes touchées", () => {
    const c = campaignCosts(2000, t, [{ views: 60_000, reach: 80_000 }, { views: 40_000, reach: 0 }]);
    expect(c.cpm).toBe(20);
    expect(c.cpmReach).toBeNull();
  });
  it("budget ambigu (null) → aucun coût", () => {
    const c = campaignCosts(null, t, [{ views: 100_000, reach: 80_000 }]);
    expect(c).toEqual({ cpm: null, cpmReach: null, cpe: null });
  });
});
