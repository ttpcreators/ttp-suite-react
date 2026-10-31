import { describe, expect, it } from "vitest";
import { gainsSummary, invoiceNet, invoiceTone, partyBrand, realGains, type GainInvoice } from "./creatorGains";

const NOW = new Date(2026, 9, 20, 9, 30);
const inv = (over: Partial<GainInvoice>): GainInvoice => ({ ref: "F1", party: "JNPR", amount: "100", date: null, status: "attente", ...over });

describe("gains du créateur", () => {
  it("pastilles : payé, en attente, en retard (argent seulement), en préparation", () => {
    expect(invoiceTone(inv({ status: "payee" }), NOW)).toEqual({ tone: "ok", label: "Payée" });
    expect(invoiceTone(inv({ status: "attente", date: "2026-11-01" }), NOW)).toEqual({ tone: "wait", label: "En attente" });
    expect(invoiceTone(inv({ status: "attente", date: "2026-10-01" }), NOW)).toEqual({ tone: "late", label: "En retard" });
    expect(invoiceTone(inv({ status: "retard" }), NOW).tone).toBe("late");
    expect(invoiceTone(inv({ status: "brouillon" }), NOW)).toEqual({ tone: "closed", label: "En préparation" });
    expect(invoiceTone(inv({ status: "annulee" }), NOW)).toEqual({ tone: "closed", label: "Annulée" });
  });

  it("totaux : encaissé, à recevoir, en préparation, facturé hors brouillons", () => {
    const s = gainsSummary(
      [
        inv({ status: "payee", amount: "680" }),
        inv({ status: "attente", amount: "200", date: "2026-11-01" }),
        inv({ status: "attente", amount: "480", date: "17/09/2026" }),
        inv({ status: "retard", amount: "50", party: "JNPR" }),
        inv({ status: "brouillon", amount: "300", party: "Seoni" }),
        inv({ status: "annulee", amount: "999", party: "Annulée" }),
      ],
      NOW,
    );
    expect(s.cashed).toBe(680);
    expect(s.pending).toBe(200);
    expect(s.late).toBe(530);
    expect(s.toReceive).toBe(730);
    expect(s.upcoming).toBe(300);
    expect(s.billed).toBe(1410);
    expect(s.lateParties).toEqual(["JNPR"]);
  });

  it("aucune facture : tout à zéro", () => {
    expect(gainsSummary([], NOW)).toEqual({ cashed: 0, pending: 0, late: 0, toReceive: 0, upcoming: 0, billed: 0, lateParties: [] });
  });
});

describe("gains nets du créateur", () => {
  it("part nette = brut moins la commission, rien sous le seuil", async () => {
    const { netShare } = await import("./creatorGains");
    expect(netShare(1000, 20)).toBe(800);
    expect(netShare(80, 20)).toBe(80);
  });
  it("statuts en mots simples et totaux nets", async () => {
    const { netGains, payoutStatus } = await import("./creatorGains");
    expect(payoutStatus({ status: "payee" }).label).toBe("Versé");
    expect(payoutStatus({ status: "retard" }).label).toBe("En cours");
    expect(payoutStatus({ status: "brouillon" }).label).toBe("À venir");
    const g = netGains(
      [
        inv({ status: "brouillon", amount: "500", party: "Seoni" }),
        inv({ status: "payee", amount: "1000", party: "Nike" }),
        inv({ status: "payee", amount: "200", party: "Asics" }),
        inv({ status: "retard", amount: "300", party: "JNPR" }),
      ],
      20,
      NOW,
    );
    expect(g).toEqual({ coming: 400 + 240, paid: 800 + 160, late: 240, last: { amount: 800, party: "Nike" } });
  });
});

describe("vrais versements (creator-report)", () => {
  const NOW = new Date(2026, 9, 22);
  const invs = [
    { id: "a", ref: "1", party: "Nike", amount: "1000", date: "2026-10-30", status: "attente" },
    { id: "b", ref: "2", party: "Asics", amount: "500", date: "2026-09-01", status: "payee" },
    { id: "c", ref: "3", party: "Hoka", amount: "1210", date: "2026-08-01", status: "payee" },
  ];
  it("net exact pour une facture détaillée (commission sur le HT, taux de la facture)", () => {
    const details = { c: { items: [{ id: "x", label: "", qty: 1, unit: 1000 }], franchise: false, vatRate: 21, commissionRate: 10 } };
    expect(invoiceNet(invs[2], details, 20)).toBe(900);
    expect(invoiceNet(invs[1], details, 20)).toBe(400);
  });
  it("en cours = dû moins versé, à venir = factures pas encore payées", () => {
    const details = { c: { items: [{ id: "x", label: "", qty: 1, unit: 1000 }], franchise: false, vatRate: 21, commissionRate: 10 } };
    const g = realGains(invs, details, [{ id: "p1", date: "2026-09-10", amount: 600, note: "Virement Hoka" }], 20, NOW);
    expect(g.paid).toBe(600);
    expect(g.owed).toBe(700); // 900 + 400 dû, 600 versé
    expect(g.coming).toBe(700 + 800);
    expect(g.last).toEqual({ amount: 600, party: "Virement Hoka" });
    expect(g.lines.map((l) => [l.status, l.amount])).toEqual([["encours", 700], ["avenir", 800], ["verse", 600]]);
  });
});

describe("marque seule d'une facture", () => {
  it("retire son prénom, accents et casse compris", () => {
    expect(partyBrand("Gymshark x Lea", "lea martin")).toBe("Gymshark");
    expect(partyBrand("Hoka x Léa", "lea martin")).toBe("Hoka");
    expect(partyBrand("Hoka X LÉA MARTIN", "Léa Martin")).toBe("Hoka");
    expect(partyBrand("Alo×Léa", "lea")).toBe("Alo");
  });
  it("ne coupe jamais une marque qui contient « x » ni le prénom d'un autre", () => {
    expect(partyBrand("Max Lea", "lea martin")).toBe("Max Lea");
    expect(partyBrand("Nike x Leane", "lea martin")).toBe("Nike x Leane");
    expect(partyBrand("x Lea", "lea")).toBe("x Lea");
    expect(partyBrand(null, "lea")).toBe("");
  });
});
