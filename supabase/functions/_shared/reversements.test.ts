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
    expect(list.map((d) => [d.end, d.renewed])).toEqual([["2026-01-02", true], ["2027-01-02", false]]);
  });
});

describe("seuil de commission en devise (audit 2026-11-11, même règle que src/lib/invoice.ts)", () => {
  it("jugé sur le HT en euros", async () => {
    const { invoiceTotals } = await import("./reversements.ts");
    const it1 = [{ qty: 1, unit: 105 }];
    expect(invoiceTotals(0, { items: it1, franchise: true, commissionRate: 20, currency: "USD", fxRate: 0.9 }, 20)).toMatchObject({ ht: 94.5, commission: 0 });
    expect(invoiceTotals(0, { items: [{ qty: 1, unit: 95 }], franchise: true, commissionRate: 20, currency: "GBP", fxRate: 1.17 }, 20)).toMatchObject({ ht: 111.15, commission: 22.23 });
  });
});

describe("amountOf : même lecture que l'app (audit 2026-11-22)", () => {
  it("point des milliers, virgule décimale", () => {
    expect(amountOf("1.500 €")).toBe(1500);
    expect(amountOf("1.440,00 €")).toBe(1440);
    expect(amountOf("12,5")).toBe(12.5);
    expect(amountOf("1234.5")).toBe(1234.5);
    expect(amountOf("0.500")).toBe(0.5);
    expect(amountOf("")).toBe(0);
  });
});

describe("une seule règle pour la page Reversements et Alfred (24 nov. 2026)", () => {
  // Noms et montants fictifs : une créatrice active, une ancienne sortie du roster.
  const input = {
    invoices: [
      { id: "a1", amount: "1 000,00 €", status: "payee", creator: "ZOÉ TEST", party: "Marque A", paid_at: "2026-10-02" },
      { id: "a2", amount: "1 000,00 €", status: "payee", creator: "Zoé Test", party: "Marque B", paid_at: "2026-11-02" },
      { id: "b1", amount: "400", status: "payee", creator: "Ancienne Test", party: "Marque C", paid_at: "2026-09-10" },
      { id: "b2", amount: "900", status: "attente", creator: "Ancienne Test" },
    ],
    details: {},
    payouts: { "zoé test": [{ id: "p1", date: "2026-10-20", amount: 900 }] },
    rosterRates: { "ZOÉ TEST": 20, "ANCIENNE TEST": 25 },
    savedRates: {},
    collabModes: {},
    contractHistory: [],
    activeNames: ["Zoé Test"],
  };

  it("l'argent dû à une ancienne créatrice reste compté", async () => {
    const { reversementRows, reversementTotals } = await import("./reversements.ts");
    const rows = reversementRows(input);
    const ancienne = rows.find((r) => r.creator === "ANCIENNE TEST")!;
    expect(ancienne).toMatchObject({ du: 300, reste: 300, horsRoster: true, rate: 25 });
    expect(rows.find((r) => r.creator === "ZOÉ TEST")).toMatchObject({ du: 1600, reverse: 900, reste: 700, horsRoster: false });
    expect(reversementTotals(rows)).toEqual({ reste: 1000, createurs: 2, horsRoster: 1, du: 1900, reverse: 900 });
  });

  it("sans activeNames, personne n'est marqué sorti, et le total ne change pas", async () => {
    const { reversementRows, reversementTotals } = await import("./reversements.ts");
    const rows = reversementRows({ ...input, activeNames: undefined });
    expect(rows.every((r) => !r.horsRoster)).toBe(true);
    expect(reversementTotals(rows).reste).toBe(1000);
  });

  it("détail des factures : les virements couvrent les plus anciennes d'abord", async () => {
    const { reversementRows } = await import("./reversements.ts");
    const zoe = reversementRows(input).find((r) => r.creator === "ZOÉ TEST")!;
    expect(zoe.lines.map((l) => [l.id, l.state, l.covered])).toEqual([["a2", "partiel", 100], ["a1", "reverse", 800]]);
    expect(zoe.lignes.map((l) => [l.id, l.party, l.du])).toEqual([["a2", "Marque B", 800], ["a1", "Marque A", 800]]);
    expect(zoe).toMatchObject({ writeKey: "zoé test", keys: ["zoé test"], lastPayout: "2026-10-20" });
  });

  it("outil reversements filtré sur un créateur : l'en-tête garde le total de l'agence", async () => {
    const { reversementRows, reversementsTexte } = await import("./reversements.ts");
    const txt = reversementsTexte(reversementRows(input), { createur: "zoé", tous: true }, (d) => d);
    expect(txt.split("\n")[0].replace(/[\u202f\u00a0]/g, " ")).toBe("# Reversements · reste à verser 1 000,00 € à 2 créateur(s), dont 1 sorti du roster (total de l'agence, comme la page Reversements)");
    expect(txt.replace(/[\u202f\u00a0]/g, " ")).toContain("Zoé Test · reste 700,00 €");
    expect(txt).not.toContain("Ancienne Test");
    const tout = reversementsTexte(reversementRows(input), {}, (d) => d);
    expect(tout).toContain("Ancienne Test (sorti du roster, l'argent reste dû) · reste 300,00 €");
  });

  it("noms encore au roster : statut autre que « inactif »", async () => {
    const { activeRosterNames } = await import("./reversements.ts");
    expect(activeRosterNames([{ name: "A", status: "actif" }, { name: "B", status: "Inactif" }, { name: "C", status: null }, { name: "", status: "actif" }])).toEqual(["A", "C"]);
  });
});
