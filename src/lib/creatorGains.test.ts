import { describe, expect, it } from "vitest";
import { gainsSummary, invoiceTone, type GainInvoice } from "./creatorGains";

const NOW = new Date(2026, 9, 20, 9, 30);
const inv = (over: Partial<GainInvoice>): GainInvoice => ({ ref: "F1", party: "JNPR", amount: "100", date: null, status: "attente", ...over });

describe("gains du créateur", () => {
  it("pastilles : payé, en attente, en retard (argent seulement), en préparation", () => {
    expect(invoiceTone(inv({ status: "payee" }), NOW)).toEqual({ tone: "ok", label: "Payée" });
    expect(invoiceTone(inv({ status: "attente", date: "2026-11-01" }), NOW)).toEqual({ tone: "wait", label: "En attente" });
    expect(invoiceTone(inv({ status: "attente", date: "2026-10-01" }), NOW)).toEqual({ tone: "late", label: "En retard" });
    expect(invoiceTone(inv({ status: "retard" }), NOW).tone).toBe("late");
    expect(invoiceTone(inv({ status: "brouillon" }), NOW)).toEqual({ tone: "closed", label: "En préparation" });
  });

  it("totaux : encaissé, à recevoir, en préparation, facturé hors brouillons", () => {
    const s = gainsSummary(
      [
        inv({ status: "payee", amount: "680" }),
        inv({ status: "attente", amount: "200", date: "2026-11-01" }),
        inv({ status: "attente", amount: "480", date: "17/09/2026" }),
        inv({ status: "retard", amount: "50", party: "JNPR" }),
        inv({ status: "brouillon", amount: "300", party: "Seoni" }),
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
