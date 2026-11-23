import { describe, expect, it } from "vitest";
import { owedByCollab, owedTotal, type OwedInvoice } from "./creatorOwed";

const inv = (id: string, over: Partial<OwedInvoice>): OwedInvoice => ({ id, ref: id, party: "Marque Test", amount: "1000", date: "2026-11-30", status: "attente", ...over });
const collabs = [
  { id: "c1", brand: "Alpha" },
  { id: "c2", brand: "Bravo" },
];

describe("ce qu'on doit au créateur, collab par collab", () => {
  it("la marque n'a pas payé : montant net et échéance", () => {
    const l = owedByCollab({ invoices: [inv("f1", { collab_id: "c1" })], details: {}, payouts: [], ratePct: 20, collabs });
    expect(l).toEqual([{ key: "c1:marque", collabId: "c1", brand: "Alpha", amount: 800, status: "marque", date: "2026-11-30" }]);
    expect(owedTotal(l)).toBe(800);
  });

  it("payée par la marque sans virement : le versement arrive", () => {
    const l = owedByCollab({ invoices: [inv("f1", { collab_id: "c1", status: "payee", paid_at: "2026-11-10T09:00:00Z" })], details: {}, payouts: [], ratePct: 20, collabs });
    expect(l.map((x) => [x.status, x.amount])).toEqual([["arrive", 800]]);
  });

  it("les virements soldent les factures les plus anciennes d'abord, avec leur date", () => {
    const l = owedByCollab({
      invoices: [
        inv("f2", { collab_id: "c2", status: "payee", paid_at: "2026-11-05T09:00:00Z" }),
        inv("f1", { collab_id: "c1", status: "payee", paid_at: "2026-10-01T09:00:00Z" }),
      ],
      details: {},
      payouts: [
        { date: "2026-10-20", amount: 500 },
        { date: "2026-11-02", amount: 500 },
      ],
      ratePct: 20,
      collabs,
    });
    // f1 (800) soldée par 500 + 300 du 2 nov. ; f2 : 200 versés, 600 arrivent.
    expect(l).toEqual([
      { key: "c2:arrive", collabId: "c2", brand: "Bravo", amount: 600, status: "arrive", date: null },
      { key: "c1:verse", collabId: "c1", brand: "Alpha", amount: 800, status: "verse", date: "2026-11-02" },
      { key: "c2:verse", collabId: "c2", brand: "Bravo", amount: 200, status: "verse", date: "2026-11-02" },
    ]);
    expect(owedTotal(l)).toBe(600);
  });

  it("sans date de paiement (ancienne fonction), l'échéance sert d'ordre", () => {
    const l = owedByCollab({
      invoices: [
        inv("f2", { collab_id: "c2", status: "payee", date: "2026-11-01" }),
        inv("f1", { collab_id: "c1", status: "payee", date: "2026-09-01" }),
      ],
      details: {},
      payouts: [{ date: "2026-09-15", amount: 800 }],
      ratePct: 20,
      collabs,
    });
    expect(l.find((x) => x.status === "verse")?.collabId).toBe("c1");
    expect(l.find((x) => x.status === "arrive")?.collabId).toBe("c2");
  });

  it("ignore les factures annulées et sans reversement ; sans collab, une ligne par facture au nom du client", () => {
    const l = owedByCollab({
      invoices: [inv("f1", { status: "annulee", collab_id: "c1" }), inv("f2", { collab_id: "c2" }), inv("f3", { party: "Charlie" }), inv("f4", { party: "Delta" })],
      details: {},
      payouts: [],
      ratePct: 20,
      collabs,
      skip: new Set(["f2"]),
    });
    expect(l.map((x) => x.brand)).toEqual(["Charlie", "Delta"]);
  });

  it("additionne deux factures d'une même collab, échéance la plus proche", () => {
    const l = owedByCollab({
      invoices: [inv("f1", { collab_id: "c1", date: "2026-12-15" }), inv("f2", { collab_id: "c1", amount: "500", date: "2026-12-01" })],
      details: {},
      payouts: [],
      ratePct: 20,
      collabs,
    });
    expect(l).toHaveLength(1);
    expect(l[0].amount).toBe(1200);
    expect(l[0].date).toBe("2026-12-01");
  });
});
