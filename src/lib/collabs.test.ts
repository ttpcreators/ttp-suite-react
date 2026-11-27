import { describe, it, expect } from "vitest";
import { isInProgress, payoutNotedSince, STEP_COUNT } from "./collabs";

describe("collab en cours", () => {
  it("en cours ou gagnée, tant que la dernière étape n'est pas atteinte", () => {
    expect(isInProgress("active", 3)).toBe(true);
    expect(isInProgress("gagnee", 5)).toBe(true);
    expect(isInProgress("active", STEP_COUNT)).toBe(false);
    expect(isInProgress("gagnee", STEP_COUNT)).toBe(false);
    expect(isInProgress("perdue", 2)).toBe(false);
    expect(isInProgress("archivee", 2)).toBe(false);
  });
});

describe("versement noté pour le créateur (étape « Créateur payé »)", () => {
  const payouts = { "LÉNA MOREL": [{ id: "p1", date: "2026-10-20", amount: 800 }], Autre: [{ id: "p2", date: "2026-11-02", amount: 100 }] };
  it("cherche le créateur sans tenir compte des majuscules ni des accents", () => {
    expect(payoutNotedSince(payouts, "Léna Morel", "2026-10-01")).toBe(true);
    expect(payoutNotedSince(payouts, "lena morel", null)).toBe(true);
  });
  it("seulement les versements faits après la facture de la collab", () => {
    expect(payoutNotedSince(payouts, "Léna Morel", "2026-11-01")).toBe(false);
    expect(payoutNotedSince(payouts, "Inconnue", null)).toBe(false);
    expect(payoutNotedSince(undefined, "Léna Morel", null)).toBe(false);
    expect(payoutNotedSince({ Léna: [{ id: "x", date: "2026-11-05", amount: 0 }] }, "Léna", null)).toBe(false);
  });
});
