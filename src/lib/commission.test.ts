import { describe, it, expect } from "vitest";
import { parseCommissionPct, commissionMap, DEFAULT_COMMISSION } from "./commission";

describe("parseCommissionPct", () => {
  it("lit les formats courants", () => {
    expect(parseCommissionPct("25%")).toBe(25);
    expect(parseCommissionPct("25")).toBe(25);
    expect(parseCommissionPct("25,5 %")).toBe(25.5);
    expect(parseCommissionPct("20 %")).toBe(20);
    expect(parseCommissionPct("  30% ")).toBe(30);
    expect(parseCommissionPct("12.5%")).toBe(12.5);
  });

  it("renvoie null si vide / illisible", () => {
    expect(parseCommissionPct("")).toBeNull();
    expect(parseCommissionPct(null)).toBeNull();
    expect(parseCommissionPct(undefined)).toBeNull();
    expect(parseCommissionPct("N/A")).toBeNull();
    expect(parseCommissionPct("—")).toBeNull();
  });

  it("gère 0 sans le confondre avec null", () => {
    expect(parseCommissionPct("0%")).toBe(0);
  });
});

describe("commissionMap", () => {
  it("construit la table nom → taux", () => {
    const map = commissionMap([
      { name: "Lena", commission: "25%" },
      { name: "Marc", commission: "20" },
    ]);
    expect(map).toEqual({ Lena: 25, Marc: 20 });
  });

  it("ignore les créateurs sans commission valide", () => {
    const map = commissionMap([
      { name: "A", commission: "" },
      { name: "B", commission: null },
      { name: "C" },
      { name: "D", commission: "15%" },
    ]);
    expect(map).toEqual({ D: 15 });
  });

  it("table vide si roster vide", () => {
    expect(commissionMap([])).toEqual({});
  });

  it("DEFAULT_COMMISSION vaut 20", () => {
    expect(DEFAULT_COMMISSION).toBe(20);
  });
});
