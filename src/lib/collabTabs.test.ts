import { describe, expect, it } from "vitest";
import { collabTabRedirect, discussionStage, negotiationCounts, normalizeCollabTab, normalizeMissionTab, sortDiscussions, stageEnregistre } from "./collabTabs";

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
    ])).toEqual({ open: 2, spotted: 0, contacted: 1, negotiating: 1, signed: 1, proposed: 900 });
  });
  it("valeur proposée : le montant saisi à la main compte aussi", () => {
    expect(negotiationCounts([
      { stage: "Négociation", proposal: null, value: "1 000 €" },
      { stage: "Négociation", proposal: null, value: "400" },
      { stage: "Négociation", proposal: null, value: "800 – 1 100 € HT" },
    ]).proposed).toBe(2500);
  });
  it("étape écrite en valeur ou en libellé : ramenée à la valeur enregistrée", () => {
    expect(["Repérée", "contactée", "En négociation", " Signée ", "Perdue", "Perdu", "Prospection", "", null, "Autre"].map(stageEnregistre)).toEqual([
      "Prospection", "Contact", "Négociation", "Signé", "Perdu", "Perdu", "Prospection", null, null, null,
    ]);
  });
  it("le créateur ne voit ni une marque seulement repérée, ni une piste perdue (constats D2, W22)", () => {
    const l = sortDiscussions([
      { id: "a", brand: "A", deliverables: null, stage: "Repérée", created_at: "2026-11-01" },
      { id: "b", brand: "B", deliverables: null, stage: "Perdue", created_at: "2026-11-02" },
      { id: "c", brand: "C", deliverables: null, stage: "Prospection", created_at: "2026-11-03" },
      { id: "d", brand: "D", deliverables: null, stage: "Contactée", created_at: "2026-11-04" },
      { id: "e", brand: "E", deliverables: null, stage: "En négociation", created_at: "2026-11-05" },
      { id: "f", brand: "F", deliverables: null, stage: null, created_at: "2026-11-06" },
      { id: "g", brand: "G", deliverables: null, stage: "Étape inconnue", created_at: "2026-11-07" },
    ]);
    expect(l.map((x) => [x.id, x.stage])).toEqual([["e", "Négociation"], ["d", "Contact"]]);
    expect(l.map((x) => discussionStage(x.stage))).toEqual(["En discussion", "Premier contact"]);
  });
  it("une piste perdue ne compte nulle part, libellés compris", () => {
    expect(negotiationCounts([
      { stage: "Perdu", proposal: { target: 2000 } },
      { stage: "Perdue", proposal: null, value: "900 €" },
      { stage: "Repérée", proposal: null, value: "300" },
      { stage: "Contactée", proposal: null, value: "—" },
      { stage: "Signée", proposal: { target: 5000 } },
    ])).toEqual({ open: 2, spotted: 1, contacted: 1, negotiating: 0, signed: 1, proposed: 300 });
  });
});
