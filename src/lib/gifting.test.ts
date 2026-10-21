import { describe, expect, it } from "vitest";
import { giftGroup, giftKpis, giftSearchFields, giftTabCounts, giftYearMonth, inGiftTab, type Gift } from "./gifting";

let seq = 0;
const gift = (over: Partial<Gift>): Gift => ({
  id: `g${(seq += 1)}`,
  creator: "Zoé Test",
  brand: "Marque Fictive",
  product: "Sac",
  value: null,
  contact_name: null,
  contact_email: null,
  received_on: null,
  content_expected: false,
  deliverables: null,
  status: "recu",
  mentions: null,
  note: null,
  source: "agency",
  sort_order: 0,
  ...over,
});

describe("Gifting : groupes du classeur", () => {
  it("range chaque statut dans un seul onglet", () => {
    expect(giftGroup({ status: "attente", content_expected: false })).toBe("attente");
    expect(giftGroup({ status: "recu", content_expected: true })).toBe("attente");
    expect(giftGroup({ status: "recu", content_expected: false })).toBe("recus");
    expect(giftGroup({ status: "publie", content_expected: true })).toBe("publies");
    expect(giftGroup({ status: "clos", content_expected: true })).toBe("clos");
    expect(giftGroup({ status: "refuse", content_expected: true })).toBe("clos");
  });

  it("statut vide ou inconnu = reçu", () => {
    expect(giftGroup({ status: null, content_expected: null })).toBe("recus");
    expect(giftGroup({ status: "bizarre", content_expected: true })).toBe("attente");
  });

  it("« Tous » contient tout, les compteurs s'additionnent", () => {
    const list = [
      gift({ status: "recu" }),
      gift({ status: "recu", content_expected: true }),
      gift({ status: "attente" }),
      gift({ status: "publie" }),
      gift({ status: "clos" }),
      gift({ status: "refuse" }),
    ];
    const c = giftTabCounts(list);
    expect(c).toEqual({ tous: 6, attente: 2, recus: 1, publies: 1, clos: 2 });
    expect(c.attente + c.recus + c.publies + c.clos).toBe(c.tous);
    expect(list.every((g) => inGiftTab(g, "tous"))).toBe(true);
    expect(list.filter((g) => inGiftTab(g, "clos"))).toHaveLength(2);
  });
});

describe("Gifting : bandeau de chiffres", () => {
  it("compte attendus, publiés, clôturés et reçus du mois", () => {
    const all = [
      gift({ status: "attente", received_on: "2026-10-02" }),
      gift({ status: "recu", content_expected: true, received_on: "2026-10-15" }),
      gift({ status: "publie", received_on: "2026-09-20" }),
      gift({ status: "refuse", received_on: "15/10/2026" }),
      gift({ status: "clos", received_on: null }),
    ];
    const k = giftKpis(all, all, "2026-10");
    expect(k.attente).toBe(2);
    expect(k.publies).toBe(1);
    expect(k.publiesPct).toBe(33);
    expect(k.clos).toBe(2);
    expect(k.refuses).toBe(1);
    expect(k.recusMois).toBe(3);
  });

  it("« Reçus ce mois » lit toute la liste, pas la période", () => {
    const all = [gift({ received_on: "2026-10-01" }), gift({ received_on: "2026-08-01" })];
    expect(giftKpis([all[1]], all, "2026-10").recusMois).toBe(1);
  });

  it("aucun contenu attendu : pas de pourcentage", () => {
    expect(giftKpis([gift({})], [gift({})], "2026-10").publiesPct).toBeNull();
  });

  it("lit les dates ISO et françaises", () => {
    expect(giftYearMonth("2026-07-31")).toBe("2026-07");
    expect(giftYearMonth("31/7/26")).toBe("2026-07");
    expect(giftYearMonth("")).toBe("");
    expect(giftYearMonth(null)).toBe("");
  });

  it("la recherche fouille la marque, le créateur, le contact et le statut", () => {
    const f = giftSearchFields(gift({ contact_email: "rp@marque.test", status: "publie" })).join(" ");
    expect(f).toContain("Marque Fictive");
    expect(f).toContain("Zoé Test");
    expect(f).toContain("rp@marque.test");
    expect(f).toContain("Contenu publié");
  });
});
