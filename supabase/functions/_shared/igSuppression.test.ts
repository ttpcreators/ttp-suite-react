import { describe, expect, it } from "vitest";
import {
  CODE_CONFIRMATION,
  codeConfirmation,
  collabIgSansStatsPrivees,
  igSansDonneesPrivees,
  igSansLien,
  mesuresAutoInstagram,
  urlStatutSuppression,
} from "./igSuppression.ts";

describe("codeConfirmation", () => {
  it("donne un code lisible, au bon format", () => {
    for (let i = 0; i < 50; i++) expect(codeConfirmation()).toMatch(CODE_CONFIRMATION);
  });
  it("dépend du hasard fourni", () => {
    expect(codeConfirmation(() => new Uint8Array(10))).toBe("IG-AAAAAAAAAA");
  });
  it("page de statut avec le code", () => {
    expect(urlStatutSuppression("IG-ABCDEFGHJK")).toBe("https://app.ttpcreators.pro/instagram-donnees/?code=IG-ABCDEFGHJK");
  });
});

const IG = {
  username: "demo", followers: 1200, er: 3.1,
  link: { username: "demo", at: "2026-11-01T00:00:00Z", expires: "2026-12-31T00:00:00Z" },
  insights: { reach: 10, views: 20 }, insightsWhy: null,
  feed: [{ id: "1", likes: 5, comments: 1, caption: "x", views: 100, reach: 80, saves: 2, shares: 1, thumb: "feed/a/1.jpg" }],
};

describe("igSansLien (annulation)", () => {
  it("retire le lien et garde tout le reste", () => {
    expect(igSansLien(IG)).toEqual({ ...IG, link: null });
  });
  it("supporte une fiche sans ig", () => {
    expect(igSansLien(null)).toEqual({ link: null });
  });
});

describe("igSansDonneesPrivees (suppression)", () => {
  it("retire lien, insights et chiffres privés du feed, garde les chiffres publics", () => {
    expect(igSansDonneesPrivees(IG)).toEqual({
      username: "demo", followers: 1200, er: 3.1, link: null, insights: null, insightsWhy: null,
      feed: [{ id: "1", likes: 5, comments: 1, caption: "x", thumb: "feed/a/1.jpg" }],
    });
  });
  it("n'ajoute pas de feed s'il n'y en avait pas", () => {
    expect(igSansDonneesPrivees({ followers: 3 })).toEqual({ followers: 3, link: null, insights: null, insightsWhy: null });
  });
});

describe("collabIgSansStatsPrivees", () => {
  it("retire reach, saves, shares, views et insAt des posts", () => {
    const ig = { at: "x", posts: [{ id: "1", likes: 3, reach: 9, saves: 1, shares: 2, views: 50, insAt: "y" }, { id: "2", likes: 1 }] };
    expect(collabIgSansStatsPrivees(ig)).toEqual({ at: "x", posts: [{ id: "1", likes: 3 }, { id: "2", likes: 1 }] });
  });
  it("rend null quand il n'y a rien à changer", () => {
    expect(collabIgSansStatsPrivees({ posts: [{ id: "1", likes: 3 }] })).toBeNull();
    expect(collabIgSansStatsPrivees(null)).toBeNull();
    expect(collabIgSansStatsPrivees({ at: "x" })).toBeNull();
  });
});

describe("mesuresAutoInstagram", () => {
  const C = "11111111-1111-1111-1111-111111111111";
  const hist = [
    { id: "a", auto: true, platform: "instagram", creatorId: C, detail: "Relevé automatique Instagram : interactions ÷ vues (statistiques du compte connecté)" },
    { id: "b", auto: false, platform: "instagram", creatorId: C, detail: "saisie" },
    { id: "c", auto: true, platform: "tiktok", creatorId: C, detail: "compte connecté" },
    { id: "d", auto: true, platform: "instagram", creatorId: "autre", detail: "compte connecté" },
  ];
  it("ne garde que les relevés Instagram automatiques de cette créatrice", () => {
    expect(mesuresAutoInstagram(hist, C)).toEqual(["a"]);
  });
  it("rend une liste vide sur un historique illisible", () => {
    expect(mesuresAutoInstagram(undefined, C)).toEqual([]);
  });
});
