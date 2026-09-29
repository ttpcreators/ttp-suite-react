import { describe, expect, it } from "vitest";
import { fullMonthOf, inRange, monthRange, presetRange, previousRange, rangeBounds, rangeDays, rangeLabel, toDayKey } from "./dateRange";

const TODAY = new Date(2026, 8, 29); // 29 septembre 2026

describe("dateRange", () => {
  it("raccourcis : bornes incluses et bonne durée", () => {
    expect(presetRange("30j", TODAY)).toEqual({ from: "2026-08-31", to: "2026-09-29" });
    expect(rangeDays(presetRange("30j", TODAY)!)).toBe(30);
    expect(rangeDays(presetRange("7j", TODAY)!)).toBe(7);
    expect(presetRange("mois", TODAY)).toEqual({ from: "2026-09-01", to: "2026-09-29" });
    expect(presetRange("mois-1", TODAY)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(presetRange("annee", TODAY)).toEqual({ from: "2026-01-01", to: "2026-09-29" });
  });

  it("période précédente de même durée, collée avant", () => {
    expect(previousRange({ from: "2026-09-01", to: "2026-09-10" })).toEqual({ from: "2026-08-22", to: "2026-08-31" });
  });

  it("dates ISO, françaises et bornes", () => {
    expect(toDayKey("31/07/2026")).toBe("2026-07-31");
    expect(toDayKey("2026-07-31T10:00:00Z")).toBe("2026-07-31");
    expect(toDayKey("n'importe quoi")).toBe("");
    const r = { from: "2026-07-01", to: "2026-07-31" };
    expect(inRange("2026-07-31", r)).toBe(true);
    expect(inRange("01/08/2026", r)).toBe(false);
    expect(inRange("2026-07-15", null)).toBe(true);
    const [a, b] = rangeBounds(r);
    expect(b - a).toBe(31 * 86400000);
  });

  it("libellés lisibles", () => {
    expect(rangeLabel(monthRange("2026-07"))).toBe("Juillet 2026");
    expect(rangeLabel({ from: "2026-01-01", to: "2026-12-31" })).toBe("Année 2026");
    expect(fullMonthOf(monthRange("2026-02"))).toBe("2026-02");
    expect(fullMonthOf({ from: "2026-02-01", to: "2026-02-27" })).toBeNull();
    expect(rangeLabel({ from: "2025-12-20", to: "2026-01-05" })).toContain("2025");
  });
});
