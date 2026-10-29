import { describe, expect, it } from "vitest";
import { owesMoney, overpaid, reversementRows, type RevInvoice } from "./reversements";
import { realGains } from "./creatorGains";
import { invoiceTotals, totalsOf } from "./invoice";
import { rateFor } from "./commission";

// Noms et montants fictifs.
const inv = (id: string, creator: string, amount: string, status = "payee"): RevInvoice => ({ id, creator, amount, status });

describe("reversements au centime", () => {
  it("dû = part créateur des factures payées, brouillons et attentes exclus", () => {
    const rows = reversementRows({
      invoices: [inv("a", "Léna Test", "1 200,50 €"), inv("b", "Léna Test", "800", "attente"), inv("c", "Léna Test", "300", "brouillon")],
      details: {},
      payouts: {},
      rosterRates: { "Léna Test": 20 },
      savedRates: {},
      defaultRate: 20,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].du).toBe(960.4); // 1200,50 − 20 %
    expect(rows[0].commission).toBe(240.1);
    expect(rows[0].reste).toBe(960.4);
  });
  it("factures sans reversement (marque qui paie le créateur, commission) ignorées", () => {
    const rows = reversementRows({
      invoices: [inv("a", "Léna Test", "1 000"), inv("b", "Léna Test", "500")],
      details: {},
      payouts: {},
      rosterRates: { "Léna Test": 20 },
      savedRates: {},
      defaultRate: 20,
      skip: new Set(["b"]),
    });
    expect(rows[0].du).toBe(800);
  });

  it("une seule ligne par créateur, quelle que soit la casse ; taux de la fiche retrouvé", () => {
    const rows = reversementRows({
      invoices: [inv("a", "léna test", "1000"), inv("b", "LÉNA TEST ", "500")],
      details: {},
      payouts: { "Léna test": [{ id: "p1", date: "2026-09-01", amount: 400 }] },
      rosterRates: { "Léna Test": 10 },
      savedRates: {},
      defaultRate: 20,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].creator).toBe("Léna Test");
    expect(rows[0].rate).toBe(10);
    expect(rows[0].du).toBe(1350);
    expect(rows[0].reverse).toBe(400);
    expect(rows[0].reste).toBe(950);
    expect(rows[0].writeKey).toBe("Léna test"); // le nouveau versement rejoint la clé existante
  });

  it("facture détaillée : commission sur le HT et au taux de la facture ; lignes vides = montant", () => {
    const details = {
      a: { items: [{ id: "1", label: "Reel", qty: 1, unit: 1000 }], franchise: false, vatRate: 20, commissionRate: 15 },
      b: { items: [], franchise: false, vatRate: 20, commissionRate: 15 },
    };
    const rows = reversementRows({
      invoices: [inv("a", "Alex Test", "1 200,00 €"), inv("b", "Alex Test", "500")],
      details,
      payouts: {},
      rosterRates: {},
      savedRates: {},
      defaultRate: 20,
    });
    expect(rows[0].encaisse).toBe(1700); // 1200 TTC + 500
    expect(rows[0].du).toBe(850 + 400);
  });

  it("détail ancien incomplet : jamais de NaN", () => {
    const t = invoiceTotals(0, { items: [{ id: "1", label: "", qty: 2, unit: 150 }] }, 20);
    expect(t).toMatchObject({ ht: 300, tva: 0, ttc: 300, commission: 60, reversal: 240, rate: 20 });
  });

  it("reste sous 0,50 € = à jour ; versé de trop signalé", () => {
    expect(owesMoney({ reste: 0.4 })).toBe(false);
    expect(owesMoney({ reste: 0.51 })).toBe(true);
    expect(overpaid({ reste: -12 })).toBe(true);
    expect(overpaid({ reste: -0.2 })).toBe(false);
  });
});

describe("cohérence croisée agence ↔ créateur", () => {
  // Une même série de factures : Facturation (invoiceTotals), Reversements et les gains
  // du créateur (creator-report → realGains) doivent dire le même dû, au centime.
  const invoices = [
    { id: "a", ref: "F-1", party: "Marque A × Léna", amount: "1 440,60 €", date: "2026-09-01", status: "payee", creator: "Léna Test" },
    { id: "b", ref: "F-2", party: "Marque B × Léna", amount: "99,99 €", date: "2026-09-02", status: "payee", creator: "Léna Test" },
    { id: "c", ref: "F-3", party: "Marque C × Léna", amount: "333,33", date: "2026-09-03", status: "payee", creator: "Léna Test" },
    { id: "d", ref: "F-4", party: "Marque D × Léna", amount: "2 000", date: "2026-12-01", status: "attente", creator: "Léna Test" },
  ];
  const details = {
    a: { items: [{ id: "1", label: "Reel", qty: 3, unit: 400.17 }], franchise: false, vatRate: 20, commissionRate: 25 },
  };
  const payouts = [{ id: "p1", date: "2026-09-10", amount: 500.5 }];

  it("même dû, même reste", () => {
    const rows = reversementRows({ invoices, details, payouts: { "Léna Test": payouts }, rosterRates: { "Léna Test": 20 }, savedRates: {}, defaultRate: 20 });
    const real = realGains(invoices, details, payouts, 20, new Date(2026, 9, 1));
    // a : HT 1200,51, commission 25 % = 300,13 → 900,38 ; b : sous le seuil → 99,99 ; c : 266,66
    expect(rows[0].du).toBe(1267.03);
    expect(real.owed).toBe(rows[0].reste);
    expect(real.paid).toBe(rows[0].reverse);
    // La facture détaillée : HT + TVA = TTC pile, et c'est le montant enregistré.
    const t = totalsOf(details.a.items, false, 20, 25);
    expect(t.ht + t.tva).toBeCloseTo(t.ttc, 10);
    expect(t.ttc).toBe(1440.61);
  });

  it("taux de la fiche retrouvé sans tenir compte des majuscules", () => {
    expect(rateFor("LÉNA TEST", { "Léna Test": 15 }, {})).toBe(15);
    expect(rateFor("Inconnu", { "Léna Test": 15 }, { inconnu: 30 })).toBe(30);
    expect(rateFor("", { "Léna Test": 15 }, {})).toBe(20);
  });
});
