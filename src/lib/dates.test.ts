import { describe, expect, it } from "vitest";
import { fmtAgoDays, fmtAgoSince, fmtDay, fmtDayAny, fmtDayTime } from "./dates";

const NOW = new Date(2026, 9, 22, 12);

describe("formats d'affichage", () => {
  it("un jour : sans année cette année, avec année sinon", () => {
    expect(fmtDay("2026-10-04", "fr-FR", NOW)).toBe("4 oct.");
    expect(fmtDay("2025-10-21", "fr-FR", NOW)).toBe("21 oct. 2025");
    expect(fmtDay(new Date(2026, 0, 3).getTime(), "fr-FR", NOW)).toBe("3 janv.");
    expect(fmtDay("", "fr-FR", NOW)).toBe("");
    expect(fmtDay("—", "fr-FR", NOW)).toBe("");
    expect(fmtDay("pas une date", "fr-FR", NOW)).toBe("");
  });
  it("un jour et l'heure", () => {
    expect(fmtDayTime(new Date(2026, 9, 21, 18, 44), "fr-FR", NOW)).toBe("21 oct. à 18:44");
  });
  it("durée", () => {
    expect([0, 1, 23, 45, 120, 400, 800].map(fmtAgoDays)).toEqual([
      "0 j", "1 j", "23 j", "2 mois", "4 mois", "1 an", "2 ans",
    ]);
    expect(fmtAgoSince(new Date(2026, 9, 20, 12), NOW.getTime())).toBe("2 j");
  });
  it("une date sous n'importe quelle forme", () => {
    expect(fmtDayAny("2026-11-04", "fr-FR", NOW)).toBe("4 nov.");
    expect(fmtDayAny("04/11/2026", "fr-FR", NOW)).toBe("4 nov.");
    expect(fmtDayAny("10/11/2025", "fr-FR", NOW)).toBe("10 nov. 2025");
    expect(fmtDayAny("fin juin", "fr-FR", NOW)).toBe("fin juin");
    expect(fmtDayAny("", "fr-FR", NOW)).toBe("");
    expect(fmtDayAny("—", "fr-FR", NOW)).toBe("");
  });
});
