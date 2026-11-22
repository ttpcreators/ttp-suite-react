import { describe, expect, it } from "vitest";
import { DEFAULT_TARIF_GRID } from "./tarif.ts";
import { priceTarif, EMPTY_DEAL } from "../../../src/lib/pricingTTP";
import {
  bornesMois, disposDuMois, disposTexte, indispoTexte, indisposDe, mediane, moisCourant, moisDecale, moisLabel, nombre, prixContenu, reseauxDe,
  slugDispos, statutDispo, titreDispos, type DisposCreatorRow,
} from "./disposDuMois.ts";
import { readExclusivites } from "./exclusivites.ts";

const NOW = new Date("2026-11-22T10:00:00Z");
const vids = (views: number[]) => views.map((v, i) => ({ at: `2026-11-${String(20 - i).padStart(2, "0")}T10:00:00Z`, views: v }));

// Données fictives (aucun vrai créateur).
const ZOE: DisposCreatorRow = {
  id: "c-zoe", name: "ZOÉ TESTEUSE", status: "actif", niche: "Sport", photo_url: "https://exemple.test/zoe.jpg", instagram: "@zoe.test", sort_order: 1,
  ig: { username: "zoe.test", followers: 22900, er: 5.33, feed: [{ at: "2026-11-20", product: "REELS", likes: 90 }] },
  kit: [{ key: "instagram", followers: "22900", er: "5,66%", avgViews: "210000" }],
};
const TOM: DisposCreatorRow = {
  id: "c-tom", name: "Tom Fictif", status: "live", niche: "Fitness", tiktok: "@tom.fictif", sort_order: 2,
  tt: { username: "tom.fictif", followers: 122544, er: 3.81, avgViews: 689, recent: vids([347, 595, 337, 516, 551, 604, 623, 2138, 574, 519, 370, 1092]) },
};
const SORTI: DisposCreatorRow = { id: "c-x", name: "Ancien Créateur", status: "inactif", sort_order: 3, ig: { followers: 99000 } };
const PAUSE: DisposCreatorRow = { id: "c-p", name: "En Pause", status: "pause", sort_order: 4, ig: { followers: 5000 } };
const EXCLUS = [
  { id: "e1", creator: "Zoé Testeuse", brand: "MarqueSecrète", scope: "nutrition sportive", competitors: ["Concurrent A"], start: "2026-10-01", end: "2026-12-31", points: [], source: "manuel", createdAt: 1 },
  { id: "e2", creator: "Zoé Testeuse", brand: "AutreMarque", scope: "même catégorie de produits", competitors: [], start: "2026-12-10", end: "2027-02-05", points: [], source: "contrat", createdAt: 2 },
  { id: "e3", creator: "Zoé Testeuse", brand: "Finie", scope: "boissons", competitors: [], start: "2026-01-01", end: "2026-11-30", points: [], source: "manuel", createdAt: 3 },
  { id: "e4", creator: "Tom Fictif", brand: "Parfums X", scope: "parfum", competitors: [], start: "2026-11-11", end: "2027-02-11", points: [], source: "mail", pending: true, createdAt: 4 },
];

describe("dispos du mois : outils", () => {
  it("mois en cours à Paris, décalage, libellés, bornes", () => {
    expect(moisCourant(new Date("2026-11-30T23:30:00Z"))).toBe("2026-12");
    expect(moisCourant(NOW)).toBe("2026-11");
    expect(moisDecale("2026-12", 1)).toBe("2027-01");
    expect(moisDecale("2026-01", -1)).toBe("2025-12");
    expect(moisLabel("2026-12")).toBe("décembre 2026");
    expect(titreDispos("2026-12")).toBe("Dispos de décembre 2026");
    expect(bornesMois("2027-02")).toEqual({ first: "2027-02-01", last: "2027-02-28" });
    expect(slugDispos("2026-12", "A7k2")).toBe("dispos-2026-12-a7k2");
    expect(slugDispos("2026-12", "")).toMatch(/^dispos-2026-12-[a-z0-9]{3,6}$/);
  });
  it("nombres saisis et médiane", () => {
    expect([nombre("244 287"), nombre("5,84%"), nombre("12,5 K"), nombre("1,2M"), nombre("abc"), nombre(null)]).toEqual([244287, 5.84, 12500, 1200000, null, null]);
    expect(mediane([3, 1, 2, 10, 4])).toBe(3);
    expect(mediane([1, 2, 3, 4, 5, 6])).toBe(4); // (3 + 4) / 2 arrondi
    expect(mediane([1, 2, 3])).toBeNull(); // trop peu de contenus : pas de médiane
  });
  it("statuts : actif, live et vide comptent ; inactif (sorti) et pause non", () => {
    expect([statutDispo("actif"), statutDispo("LIVE"), statutDispo(null), statutDispo("inactif"), statutDispo("pause")]).toEqual([true, true, true, false, false]);
  });
});

describe("dispos du mois : réseaux et prix", () => {
  it("TikTok : médiane des 10 dernières vidéos, pas la moyenne", () => {
    const tt = reseauxDe(TOM).find((r) => r.key === "tiktok")!;
    expect(tt).toMatchObject({ handle: "tom.fictif", followers: 122544, views: 563, viewsKind: "mediane", er: 3.81, erBase: "vues", source: "releve" });
  });
  it("Instagram sans vues mesurées : vues du media kit ignorées (saisies à la main)", () => {
    const ig = reseauxDe(ZOE).find((r) => r.key === "instagram")!;
    expect(ig).toMatchObject({ followers: 22900, views: null, viewsKind: null, er: 5.33, erBase: "abonnes", source: "releve" });
  });
  it("réseau du media kit quand il n'y a pas de relevé ; rien quand aucun abonné connu", () => {
    const r = reseauxDe({ name: "X", tiktok: "@x.y", kit: [{ key: "tiktok", followers: "45800", er: "7,80%" }] });
    expect(r).toEqual([{ key: "tiktok", handle: "x.y", url: "https://www.tiktok.com/@x.y", followers: 45800, views: null, viewsKind: null, er: 7.8, erBase: "vues", source: "kit" }]);
    expect(reseauxDe({ name: "Vide", instagram: "@vide" })).toEqual([]);
  });
  it("le prix d'un contenu est celui de la page Tarifs (coefficient 1, production simple, plancher)", () => {
    const g = DEFAULT_TARIF_GRID;
    for (const [views, key] of [[563, "tiktok.video"], [40000, "instagram.reel"], [9000, "tiktok.video"]] as const) {
      const ref = priceTarif({ ...EMPTY_DEAL, lines: [{ key, label: key, qty: 1, views }] }, g, g.floor);
      expect(prixContenu(views, g.cpm[key], g, g.floor)).toBe(ref.target);
    }
    expect(prixContenu(563, 18, g, 200)).toBe(200); // relevé au plancher
    expect(prixContenu(40000, 25, g, 200)).toBe(1150);
  });
});

describe("dispos du mois : exclusivités", () => {
  const list = readExclusivites(EXCLUS);
  it("catégorie et dates seulement, jamais la marque ; catégorie vague remplacée ; finies et à confirmer absentes", () => {
    const x = indisposDe(list, "ZOÉ TESTEUSE", "2026-12");
    expect(x).toEqual([
      { label: "nutrition sportive", from: null, until: "2026-12-31" },
      { label: "une catégorie de produits (nous consulter)", from: "2026-12-10", until: "2027-02-05" },
    ]);
    expect(JSON.stringify(x)).not.toMatch(/MarqueSecrète|AutreMarque|Concurrent/);
    expect(indisposDe(list, "Tom Fictif", "2026-12")).toEqual([]);
    expect(indispoTexte(x[0], "2026-12")).toBe("nutrition sportive jusqu'au 31/12");
    expect(indispoTexte(x[1], "2026-12")).toBe("une catégorie de produits (nous consulter) à partir du 10/12 jusqu'au 05/02/2027");
  });
});

describe("dispos du mois : la sélection", () => {
  const r = disposDuMois({ creators: [SORTI, TOM, ZOE, PAUSE], pricingRates: { ttp: { rightsPct: 25 } }, exclusivites: EXCLUS, mois: "2026-12", now: NOW });
  it("créateurs actifs seulement, dans l'ordre du roster", () => {
    expect(r.selection.creators.map((c) => c.name)).toEqual(["Zoé Testeuse", "Tom Fictif"]);
    expect(r.usernames).toEqual(["zoe.test"]);
    expect(r.selection).toMatchObject({ v: 1, mois: "2026-12", moisLabel: "décembre 2026", genereLe: NOW.toISOString() });
    expect(r.selection.conditions).toContain("+25 % par tranche de 3 mois");
  });
  it("prix seulement là où les vues sont mesurées ; pas de story ni de pack inventés", () => {
    const [zoe, tom] = r.selection.creators;
    expect(zoe.prix).toEqual({});
    expect(tom.prix).toEqual({ tiktok: 200 });
    expect(zoe.indispos).toHaveLength(2);
  });
  it("plancher propre au créateur", () => {
    const r2 = disposDuMois({ creators: [TOM], pricingRates: { ttpFloors: { "c-tom": 350 } }, exclusivites: [], mois: "2026-12", now: NOW });
    expect(r2.selection.creators[0].prix).toEqual({ tiktok: 350 });
  });
  it("le pack : un de chaque format, remise package, seulement si les trois sont chiffrés", () => {
    // Aucun relevé ne mesure les vues des stories aujourd'hui : jamais de pack.
    const both: DisposCreatorRow = { ...TOM, ig: { followers: 50000, link: { username: "t" }, insights: { reelViews: 40000 } } };
    const p = disposDuMois({ creators: [both], pricingRates: {}, exclusivites: [], mois: "2026-12", now: NOW }).selection.creators[0].prix;
    expect(p).toEqual({ reel: 1150, tiktok: 200 });
  });
  it("rien d'interne dans ce qui est publié ; les notes restent pour l'agence", () => {
    const pub = JSON.stringify(r.selection);
    expect(pub).not.toMatch(/MarqueSecrète|AutreMarque|Parfums X|Concurrent|c-zoe|210000/);
    expect(r.notes.join("\n")).toContain("Tom Fictif : exclusivité « parfum » à confirmer");
    expect(r.notes.join("\n")).toContain("Zoé Testeuse : pas de prix (vues des reels non mesurées, Instagram non connecté)");
    expect(r.notes.join("\n")).toContain("Zoé Testeuse : vues instagram du media kit (210000, saisies à la main) non utilisées pour le prix.");
    expect(r.notes.join("\n")).toContain("En Pause : en pause");
  });
  it("texte pour Alfred : lien, une ligne par créateur, points à vérifier", () => {
    const t = disposTexte(r, "https://ttpcreators.pro/selection/?l=dispos-2026-12-a7k2");
    expect(t).toContain("# Dispos de décembre 2026 · 2 créateur(s)");
    expect(t).toContain("Lien à envoyer aux agences : https://ttpcreators.pro/selection/?l=dispos-2026-12-a7k2");
    expect(t).toContain("- Tom Fictif (Fitness) · TikTok @tom.fictif : 122,5 K abonnés, 563 vues médianes, engagement 3,81 % · Vidéo TikTok 200 € HT");
    expect(t).toContain("pas dispo pour : nutrition sportive jusqu'au 31/12");
    expect(t).toContain("À vérifier avant l'envoi (jamais publié) :");
  });
});
