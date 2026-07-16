import { describe, it, expect } from "vitest";
import { totalsOf, COMMISSION_FLOOR_EUR, type LineItem } from "./invoice";

const item = (unit: number, qty = 1): LineItem => ({ id: "x", label: "", qty, unit });

describe("totalsOf", () => {
  it("franchise (sans TVA) : commission sur le HT", () => {
    const t = totalsOf([item(1000)], true, 20, 20);
    expect(t.ht).toBe(1000);
    expect(t.tva).toBe(0);
    expect(t.ttc).toBe(1000);
    expect(t.commission).toBe(200);
    expect(t.reversal).toBe(800);
  });

  it("avec TVA 20% : commission calculée sur le HT, PAS sur le TTC", () => {
    const t = totalsOf([item(1000)], false, 20, 20);
    expect(t.ht).toBe(1000);
    expect(t.tva).toBe(200);
    expect(t.ttc).toBe(1200);
    // Le point clé du fix : 20% de 1000 (HT), pas de 1200 (TTC).
    expect(t.commission).toBe(200);
    expect(t.reversal).toBe(800);
  });

  it("seuil : aucune commission sous 100 € de HT", () => {
    const t = totalsOf([item(80)], true, 0, 20);
    expect(t.commission).toBe(0);
    expect(t.reversal).toBe(80);
  });

  it("seuil : à 100 € pile, la commission s'applique (borne stricte)", () => {
    expect(COMMISSION_FLOOR_EUR).toBe(100);
    const t = totalsOf([item(100)], true, 0, 20);
    expect(t.commission).toBe(20);
    expect(t.reversal).toBe(80);
  });

  it("plusieurs lignes : HT = somme des qty × unit", () => {
    const t = totalsOf([item(500, 2), item(250)], true, 0, 10);
    expect(t.ht).toBe(1250);
    expect(t.commission).toBe(125);
    expect(t.reversal).toBe(1125);
  });

  it("liste vide → 0 partout", () => {
    const t = totalsOf([], true, 0, 20);
    expect(t.ht).toBe(0);
    expect(t.commission).toBe(0);
    expect(t.reversal).toBe(0);
  });
});
