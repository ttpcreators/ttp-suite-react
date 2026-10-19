import { describe, expect, it } from "vitest";
import { buildRecap, publicationDate, readyForRecap, type CollabForRecap } from "./campaignRecap";

const collab: CollabForRecap = {
  id: "c1", brand: "Hoka", creator: "léa martin", deliverables: "1 Reel · 1 TikTok", cachet: "1 500 €", step: 6, created_at: "2026-09-01T10:00:00Z",
  ig: { posts: [{ id: "p1", at: "2026-10-01T18:00:00Z", product: "REELS", likes: 4200, comments: 180, reach: 52000, saves: 900, shares: 300, views: 81000 }] },
  tt: { posts: [{ id: "t1", at: "2026-10-02T18:00:00Z", views: 120000, likes: 9100, comments: 240, shares: 410 }] },
};

describe("bilan de campagne automatique", () => {
  it("prend la 1re arrivée à l'étape Publication, sinon le 1er post", () => {
    expect(publicationDate(collab, [{ collab_id: "c1", step: 6, reached_at: "2026-10-01T09:00:00Z" }])).toBe("2026-10-01T09:00:00Z");
    expect(publicationDate(collab, [])).toBe("2026-10-01T18:00:00Z");
  });

  it("n'est prêt qu'après 7 jours", () => {
    const pub = "2026-10-01T09:00:00Z";
    expect(readyForRecap(pub, Date.parse("2026-10-07T09:00:00Z"))).toBe(false);
    expect(readyForRecap(pub, Date.parse("2026-10-08T09:00:00Z"))).toBe(true);
    expect(readyForRecap(null)).toBe(false);
  });

  it("pré-remplit chiffres, synthèse, points forts et renouvellement", () => {
    const r = buildRecap(collab, "2026-10-01T09:00:00Z", { instagram: 60000 });
    expect(r.stats).toHaveLength(2);
    expect(r.budget).toBe("1 500 €");
    expect(r.reach).not.toBe("");
    expect(r.summary).toContain("2 contenus publiés par Léa Martin pour Hoka");
    expect(r.highlights[0]).toContain("Meilleur contenu : TikTok");
    expect(r.renewal).toContain("Léa Martin");
    expect(r.period).toContain("1 octobre 2026");
  });
});

describe("bilan automatique : taux d'engagement sur une base homogène (F1)", () => {
  const pub = "2026-10-01T09:00:00Z";
  const igOnly = (posts: NonNullable<NonNullable<CollabForRecap["ig"]>["posts"]>): CollabForRecap => ({ ...collab, tt: null, ig: { posts } });

  it("Instagram + TikTok : plus de taux sur les abonnés Instagram (avant : ~25 %), pas de proposition « forte »", () => {
    // Avant : (5 580 + 9 750) / 2 / 30 000 abonnés Instagram = 25,6 % → « dépassent les moyennes du secteur ».
    const r = buildRecap(collab, pub, { instagram: 30000, tiktok: 200000 });
    expect(r.engagement).toBe("");
    expect(r.summary).not.toContain("taux d'engagement");
    expect(r.renewal).toContain("seconde vague");
    expect(r.renewal).not.toContain("dépassent");
    expect(r.followers).toBe(0);
  });

  it("un seul réseau sans couverture : taux sur les abonnés DE CE réseau", () => {
    const tt: CollabForRecap = { ...collab, ig: null };
    // 9 750 interactions / 1 vidéo / 200 000 abonnés TikTok = 4,875 %
    const r = buildRecap(tt, pub, { instagram: 30000, tiktok: 200000 });
    expect(r.basis).toBe("followers");
    expect(r.followers).toBe(200000);
    expect(r.engagement).toBe("4,9 %");
    expect(r.summary).toContain("(sur les abonnés)");
    // Abonnés TikTok inconnus : pas de taux (les abonnés Instagram ne servent pas).
    expect(buildRecap(tt, pub, { instagram: 30000 }).engagement).toBe("");
  });

  it("couverture sur chaque contenu : taux sur la couverture", () => {
    // 5 580 / 52 000 = 10,7 %
    const r = buildRecap(igOnly(collab.ig!.posts!), pub, {});
    expect(r.basis).toBe("reach");
    expect(r.engagement).toBe("10,7 %");
    expect(r.summary).toContain("(sur la couverture)");
    expect(r.renewal).toContain("trois mois");
  });

  it("seuil « bon taux » partagé (4 % sur la couverture) au lieu de 5 % ici et 4 % ailleurs", () => {
    // 2 340 / 52 000 = 4,5 % : au-dessus du repère de l'app → proposition forte
    const ok = buildRecap(igOnly([{ id: "a", product: "REELS", likes: 2000, comments: 140, saves: 100, shares: 100, reach: 52000 }]), pub, {});
    expect(ok.renewal).toContain("trois mois");
    // 1 500 / 52 000 = 2,9 % : seconde vague
    const low = buildRecap(igOnly([{ id: "a", product: "REELS", likes: 1000, comments: 200, saves: 200, shares: 100, reach: 52000 }]), pub, {});
    expect(low.renewal).toContain("seconde vague");
  });

  it("couverture de plusieurs contenus : « couverture cumulée »", () => {
    const r = buildRecap(igOnly([
      { id: "a", product: "REELS", likes: 100, reach: 10000 },
      { id: "b", product: "REELS", likes: 100, reach: 12000 },
    ]), pub, {});
    expect(r.summary).toContain("22K de couverture cumulée");
    expect(r.summary).not.toContain("personnes touchées");
  });

  it("cachet ambigu : budget laissé vide, jamais un montant faux (F2)", () => {
    expect(buildRecap({ ...collab, cachet: "800 € x 2" }, pub, {}).budget).toBe("");
    expect(buildRecap({ ...collab, cachet: "2 x 500 €" }, pub, {}).budget).toBe("");
    expect(buildRecap({ ...collab, cachet: "1,5k€" }, pub, {}).budget).toBe("1,5k€");
  });
});
