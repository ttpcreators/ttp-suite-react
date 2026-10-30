import { describe, expect, it } from "vitest";
import { amountOf, contractEnd, contractList, reversementRows } from "./reversements.ts";

describe("reversements (serveur, mêmes règles que l'app)", () => {
  it("lit les montants enregistrés", () => {
    expect(amountOf("1 440,00 €")).toBe(1440);
    expect(amountOf("1.440,50")).toBe(1440.5);
    expect(amountOf("600")).toBe(600);
    expect(amountOf(null)).toBe(0);
  });

  it("dû = part créateur des factures payées, moins les versements", () => {
    const rows = reversementRows({
      invoices: [
        { id: "a", amount: "1 000,00 €", status: "payee", creator: "ZOÉ TEST" },
        { id: "b", amount: "500", status: "attente", creator: "Zoé Test" },
        { id: "c", amount: "800", status: "payee", creator: "Zoé Test", collab_id: "k" },
      ],
      details: {},
      payouts: { "zoé test": [{ date: "2026-10-01", amount: 300 }] },
      rosterRates: { "ZOÉ TEST": 20 },
      savedRates: {},
      collabModes: { k: "createur" },
      contractHistory: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ creator: "ZOÉ TEST", du: 800, reverse: 300, reste: 500, rate: 20, lastPayout: "2026-10-01" });
  });

  it("fin de contrat bornée à la fin du mois, et contrat renouvelé repéré", () => {
    expect(contractEnd("2026-01-31", 1)).toBe("2026-02-28");
    const list = contractList([
      { creator: "Zoé", type: "representation", start: "2025-01-03", months: 12 },
      { creator: "Zoé", type: "representation", start: "2026-01-03", months: 12 },
    ]);
    expect(list.map((d) => [d.end, d.renewed])).toEqual([["2026-01-03", true], ["2027-01-03", false]]);
  });
});
