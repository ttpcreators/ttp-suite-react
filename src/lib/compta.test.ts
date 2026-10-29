import { describe, expect, it } from "vitest";
import {
  cashModeFor, collabTake, comptePro, DEFAULT_SETTINGS, invoiceLine, mandatesFrom, periodDeadline, periodOf, readSettings, socialRate, thresholdAlerts,
  type ComptaSettings,
} from "./compta";

const S: ComptaSettings = { ...DEFAULT_SETTINGS }; // BNC 25,6 % + CFP 0,2 %, franchise, trimestre, facture au nom de l'agence
const inv = (id: string, amount: string, status = "payee", extra: Record<string, unknown> = {}) => ({ id, amount, status, creator: "Léa Test", date: "2026-10-10", ...extra });

describe("compta : une facture", () => {
  it("marque encaissée par l'agence (facture au nom de l'agence) : tout le HT est du CA", () => {
    const l = invoiceLine(inv("a", "1 000 €"), { issueDate: "2026-10-05" }, 20, "agence", S);
    expect(l).toMatchObject({ kind: "marque", cashIn: 1000, agencyCA: 1000, commission: 200, owedCreator: 800, vatDue: 0, day: "2026-10-05" });
    expect(l.social).toBe(258); // 1000 × 25,8 %
  });
  it("au nom et pour le compte du créateur (mandat) : seule la commission est du CA", () => {
    const l = invoiceLine(inv("a", "1 000 €"), null, 20, "agence", { ...S, facturation: "mandat" });
    expect(l).toMatchObject({ agencyCA: 200, owedCreator: 800, social: 51.6 });
  });
  it("TVA de la facture : encaissée par l'agence, à reverser à l'État", () => {
    const detail = { items: [{ id: "x", label: "Reel", qty: 1, unit: 1000 }], franchise: false, vatRate: 20, commissionRate: 20 };
    const l = invoiceLine(inv("a", "1 200 €"), detail, 20, "agence", S);
    expect(l).toMatchObject({ ttc: 1200, cashIn: 1200, agencyCA: 1000, vatDue: 200, owedCreator: 800 });
  });
  it("marque qui paie le créateur : rien n'arrive sur le compte de l'agence", () => {
    expect(invoiceLine(inv("a", "1 000 €"), null, 20, "createur", S)).toMatchObject({ cashIn: 0, agencyCA: 0, owedCreator: 0, commission: 200 });
  });
  it("facture de commission au créateur, payée : tout son HT est du CA", () => {
    const l = invoiceLine(inv("c", "200 €", "payee", { creator: null }), { kind: "commission" }, 20, "createur", S);
    expect(l).toMatchObject({ kind: "commission", cashIn: 200, agencyCA: 200, commission: 200, owedCreator: 0 });
  });
  it("facture pas encore payée : rien d'encaissé", () => {
    expect(invoiceLine(inv("a", "1 000 €", "attente"), null, 20, "agence", S)).toMatchObject({ cashIn: 0, agencyCA: 0, social: 0 });
  });
});

describe("compta : compte pro", () => {
  it("solde, à mettre de côté et vraiment disponible", () => {
    const lines = [
      invoiceLine(inv("a", "1 000 €", "payee", { date: "2026-10-01" }), null, 20, "agence", S), // T4 : pas échu au 29 oct.
      invoiceLine(inv("b", "500 €", "payee", { date: "2026-05-01", creator: "Nora Test" }), null, 20, "agence", S), // T2 : échu fin juillet
    ];
    const r = comptePro(lines, { "LÉA TEST": [{ amount: 300 }], "Nora Test": [{ amount: 400 }] }, S, "2026-10-29");
    expect(r.encaisse).toBe(1500);
    expect(r.verse).toBe(700);
    expect(r.solde).toBe(800);
    expect(r.aside.createurs).toBe(500); // Léa : 800 − 300 ; Nora : 400 dû, 400 versé
    expect(r.aside.urssaf).toBe(258); // seul le T4 reste à payer
    expect(r.openPeriods).toEqual(["2026-T4"]);
    expect(r.dispo).toBe(42);
    expect(r.caYear).toBe(1500);
  });
  it("périodes de déclaration", () => {
    expect(periodOf("2026-10-05", "trimestre")).toBe("2026-T4");
    expect(periodOf("2026-10-05", "mois")).toBe("2026-10");
    expect(periodDeadline("2026-T4")).toBe("2027-01-31");
    expect(periodDeadline("2026-10")).toBe("2026-11-30");
    expect(periodDeadline("2026-T1")).toBe("2026-04-30");
  });
});

describe("compta : réglages, seuils, collabs", () => {
  it("réglages abîmés → défaut ; taux total prélevé", () => {
    const s = readSettings({ activity: "bic_services", urssafRate: "x", vl: true });
    expect(s).toMatchObject({ activity: "bic_services", urssafRate: 21.2, cfpRate: 0.1, vl: true, vlRate: 1.7, vatRegime: "franchise" });
    expect(socialRate(s)).toBeCloseTo(23);
  });
  it("alertes de seuils (franchise de TVA, plafond micro)", () => {
    expect(thresholdAlerts(10_000, S)).toEqual([]);
    expect(thresholdAlerts(31_000, S).map((a) => a.level)).toEqual(["info"]);
    expect(thresholdAlerts(39_000, S).map((a) => a.level)).toEqual(["wait"]);
    expect(thresholdAlerts(90_000, S).map((a) => a.level)).toEqual(["late", "wait"]);
    expect(thresholdAlerts(39_000, { ...S, vatRegime: "assujetti" })).toEqual([]);
  });
  it("ce que je prends sur une collab : estimé sur le cachet, puis réel", () => {
    const c = { id: "c1", brand: "Nike", creator: "Léa Test", cachet: "1 500 €" };
    expect(collabTake(c, [], 20, "agence", S)).toMatchObject({ commission: 300, estimated: true, social: 77.4, net: 222.6, received: false, commissionToBill: false });
    const paid = [invoiceLine(inv("a", "1 000 €", "payee", { collab_id: "c1" }), null, 20, "agence", S)];
    expect(collabTake(c, paid, 20, "agence", S)).toMatchObject({ commission: 200, estimated: false, received: true });
    const brandOnly = [invoiceLine(inv("a", "1 000 €", "payee", { collab_id: "c1" }), null, 20, "createur", S)];
    expect(collabTake(c, brandOnly, 20, "createur", S)).toMatchObject({ commission: 200, received: false, commissionToBill: true });
  });
  it("mode d'encaissement : collab, sinon contrat de représentation, sinon agence", () => {
    const mandates = mandatesFrom([
      { creator: "Léa Test", createdAt: "2026-01-01", config: { mandatEncaissement: "true" } },
      { creator: "LÉA TEST", createdAt: "2026-06-01", config: { mandatEncaissement: "false" } },
    ]);
    expect(mandates).toEqual({ "léa test": false });
    expect(cashModeFor("c1", "Léa Test", { c1: "agence" }, mandates)).toBe("agence");
    expect(cashModeFor("c2", "Léa Test", {}, mandates)).toBe("createur");
    expect(cashModeFor(null, "Inconnue", {}, mandates)).toBe("agence");
  });
});
