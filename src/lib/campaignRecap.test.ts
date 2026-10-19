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
    const r = buildRecap(collab, "2026-10-01T09:00:00Z", 60000);
    expect(r.stats).toHaveLength(2);
    expect(r.budget).toBe("1 500 €");
    expect(r.reach).not.toBe("");
    expect(r.summary).toContain("2 contenus publiés par Léa Martin pour Hoka");
    expect(r.highlights[0]).toContain("Meilleur contenu : TikTok");
    expect(r.renewal).toContain("Léa Martin");
    expect(r.period).toContain("1 octobre 2026");
  });
});
