import { describe, expect, it } from "vitest";
import { buildMonthlyReport, followersOver, monthLabel, shiftMonth, type ReportData } from "./monthlyReport";

const data: ReportData = {
  creator: {
    name: "lea martin",
    commission: "20 %",
    ig: { history: [{ d: "2026-09-28", f: 18000 }, { d: "2026-10-05", f: 18400 }, { d: "2026-10-30", f: 19500 }], insights: { at: "2026-10-29T05:20:00Z", reach: 240000, views: 610000 } },
    tt: { history: [{ d: "2026-11-02", f: 9000 }] },
  },
  invoices: [
    { id: "a", ref: "TTP-1", party: "Hoka", amount: "1 500 €", date: "2026-11-15", status: "payee" },
    { id: "b", ref: "TTP-2", party: "Nike", amount: "1 000 €", date: "15/10/2026", status: "attente" },
    { id: "c", ref: "TTP-3", party: "Asics", amount: "900 €", date: "2026-10-20", status: "brouillon" },
    { id: "d", ref: "TTP-0", party: "Alo", amount: "500 €", date: "2026-03-01", status: "payee" },
  ],
  details: { a: { items: [{ id: "1", label: "Reel", qty: 1, unit: 1500 }], franchise: true, vatRate: 0, commissionRate: 25, issueDate: "2026-10-02" } },
  payouts: [{ date: "2026-10-12", amount: 800 }, { date: "2026-09-12", amount: 300 }],
  collabs: [
    { id: "c1", brand: "Hoka", cachet: "1 500 €", step: 7, created_at: "2026-10-01T09:00:00Z" },
    { id: "c2", brand: "Nike", cachet: "1 000 €", step: 3, created_at: "2026-09-10T09:00:00Z" },
    { id: "c3", brand: "Old", cachet: "", step: 11, status: "archivee", created_at: "2026-10-03T09:00:00Z" },
  ],
  steps: [{ collab_id: "c1", step: 6, reached_at: "2026-10-18T09:00:00Z" }, { collab_id: "c1", step: 7, reached_at: "2026-10-25T09:00:00Z" }],
  gifting: [{ brand: "Hoka", value: "180 €", received_on: "2026-10-03" }],
  engagement: [
    { date: "20/09/2026", platform: "instagram", platformLabel: "Instagram", er: "3,10 %" },
    { date: "21/10/2026", platform: "instagram", platformLabel: "Instagram", er: "3,80 %" },
  ],
};

describe("rapport mensuel créateur", () => {
  it("libellés et navigation de mois", () => {
    expect(monthLabel("2026-10")).toBe("octobre 2026");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("abonnés : dernier relevé avant le mois, puis fin du mois", () => {
    expect(followersOver(data.creator.ig?.history, "2026-10")).toEqual({ start: 18000, end: 19500 });
    expect(followersOver(data.creator.tt?.history, "2026-10")).toBeNull();
  });

  it("gains : mois d'émission, commission de la facture, hors brouillons", () => {
    const r = buildMonthlyReport(data, "2026-10", new Date("2026-10-31T12:00:00Z"));
    // a (émise le 02/10, 25 %) : 1500 → part 1125 ; b (sans détails, 20 %) : 1000 → part 800
    expect(r.earnings.billed).toBe(2500);
    expect(r.earnings.share).toBe(1925);
    expect(r.earnings.cashed).toBe(1125);
    expect(r.earnings.pending).toBe(800);
    expect(r.earnings.paidOut).toBe(800);
    expect(r.earnings.yearShare).toBe(1925 + 400); // + facture de mars
    expect(r.invoices.map((i) => i.ref)).toEqual(["TTP-1", "TTP-2"]);
    expect(r.inProgress).toBe(true);
  });

  it("collabs, chiffres et apport de l'agence", () => {
    const r = buildMonthlyReport(data, "2026-10", new Date("2026-11-03T12:00:00Z"));
    expect(r.newCollabs).toEqual([{ brand: "Hoka", cachet: "1 500 €" }]);
    expect(r.published.map((p) => p.brand)).toEqual(["Hoka"]);
    expect(r.ongoing).toBe(2);
    expect(r.stats).toEqual([{ label: "Instagram", start: 18000, end: 19500, delta: 1500, pct: (1500 / 18000) * 100 }]);
    expect(r.reach).toEqual({ reach: 240000, views: 610000 });
    expect(r.engagement).toEqual({ er: "3,80 %", prev: "3,10 %", label: "Instagram" });
    expect(r.gifts).toEqual({ count: 1, value: 180, brands: ["Hoka"] });
    expect(r.agency[0]).toContain("1 nouvelle collab décrochée");
    expect(r.agency.some((a) => a.includes("abonnés sur Instagram"))).toBe(true);
    expect(r.inProgress).toBe(false);
    expect(r.empty).toBe(false);
  });

  it("mois vide", () => {
    expect(buildMonthlyReport(data, "2025-06").empty).toBe(true);
  });

  it("cachet ambigu ignoré dans le total, jamais additionné en chiffres collés (F2)", () => {
    // Avant : « 800 € x 2 » lu 8002 → « 9 502 € de cachets ».
    const d: ReportData = { ...data, collabs: [...data.collabs, { id: "c4", brand: "Asics", cachet: "800 € x 2", step: 2, created_at: "2026-10-05T09:00:00Z" }] };
    const r = buildMonthlyReport(d, "2026-10", new Date("2026-11-03T12:00:00Z"));
    expect(r.agency[0]).toMatch(/pour au moins 1\s500 € de cachets/);
    expect(r.agency[0]).not.toContain("9");
    // Cachet en « k » : 1,5k€ + 1 500 € = 3 000 €
    const k: ReportData = { ...data, collabs: [...data.collabs, { id: "c5", brand: "Asics", cachet: "1,5k€", step: 2, created_at: "2026-10-05T09:00:00Z" }] };
    expect(buildMonthlyReport(k, "2026-10").agency[0]).toMatch(/pour 3\s000 € de cachets/);
  });

  it("en anglais : mois et phrases de l'agence traduits, chiffres identiques", () => {
    expect(monthLabel("2026-10", "en")).toBe("October 2026");
    const fr = buildMonthlyReport(data, "2026-10", new Date("2026-11-03T12:00:00Z"));
    const en = buildMonthlyReport(data, "2026-10", new Date("2026-11-03T12:00:00Z"), "en");
    expect(en.label).toBe("October 2026");
    expect(en.earnings).toEqual(fr.earnings);
    expect(en.agency).toHaveLength(fr.agency.length);
    expect(en.agency[0]).toMatch(/^1 new collab landed and negotiated for you \(Hoka\), worth 1\s500 € in fees$/);
    expect(en.agency).toContain("1 campaign published and followed through to the campaign report sent to the brand");
    expect(en.agency.some((a) => a.startsWith("1 product delivery received (Hoka), worth 180"))).toBe(true);
    expect(en.agency.some((a) => /^Your audience grew: \+1[.,]5K followers on Instagram$/.test(a))).toBe(true);
    expect(en.agency.join(" ")).not.toMatch(/collab décrochée|abonnés|pour toi/);
  });
});
