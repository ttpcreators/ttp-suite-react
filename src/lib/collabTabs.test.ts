import { describe, expect, it } from "vitest";
import { collabTabRedirect, discussionStage, negotiationCounts, normalizeCollabTab, normalizeMissionTab, sortDiscussions } from "./collabTabs";

describe("onglets de Collabs et de Missions", () => {
  it("les anciennes pages Gifting et Pipeline ouvrent Collabs sur le bon onglet", () => {
    expect(collabTabRedirect("gifting")).toEqual({ view: "collabs", tab: "gifting" });
    expect(collabTabRedirect("prospection")).toEqual({ view: "collabs", tab: "negociations" });
    expect(collabTabRedirect("collabs")).toBe(null);
  });
  it("valeurs inconnues ramenées au premier onglet", () => {
    expect(normalizeCollabTab("gifting")).toBe("gifting");
    expect(normalizeCollabTab("x")).toBe("payees");
    expect(normalizeMissionTab("discussions")).toBe("discussions");
    expect(normalizeMissionTab(null)).toBe("missions");
  });
  it("étapes en mots de créatrice, la plus avancée d'abord", () => {
    expect(["Prospection", "Contact", "Négociation", "Signé", null].map(discussionStage)).toEqual([
      "Premier contact", "Premier contact", "En discussion", "Signée bientôt", "En discussion",
    ]);
    const l = sortDiscussions([
      { id: "a", brand: "A", deliverables: null, stage: "Contact", created_at: "2026-10-01" },
      { id: "b", brand: "B", deliverables: null, stage: "Signé", created_at: "2026-09-01" },
      { id: "c", brand: "C", deliverables: null, stage: "Contact", created_at: "2026-10-05" },
    ]);
    expect(l.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
  it("compteurs des négociations : signées à part, valeur proposée des non signées", () => {
    expect(negotiationCounts([
      { stage: "Négociation", proposal: { target: 900 } },
      { stage: "Contact", proposal: null, value: "—" },
      { stage: "Signé", proposal: { target: 5000 } },
    ])).toEqual({ open: 2, negotiating: 1, signed: 1, proposed: 900 });
  });
});
