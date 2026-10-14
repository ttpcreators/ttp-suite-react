import { describe, expect, it } from "vitest";
import { agencyCandidates, growth, sparkPoints } from "./igRivals";

const hist = (pairs: [string, number][]) => pairs.map(([d, f]) => ({ d, f }));

describe("growth", () => {
  it("compare au relevé d'il y a 7 jours", () => {
    const h = hist([["2026-10-01", 1000], ["2026-10-07", 1100], ["2026-10-14", 1210]]);
    expect(growth(h, 7)).toEqual({ abs: 110, pct: 10, days: 7 });
  });
  it("prend le plus ancien si la période est en partie couverte", () => {
    const h = hist([["2026-10-01", 1000], ["2026-10-14", 1100]]);
    expect(growth(h, 20)?.abs).toBe(100);
  });
  it("rien sans assez d'historique", () => {
    expect(growth(hist([["2026-10-14", 1000]]), 7)).toBeNull();
    expect(growth(hist([["2026-10-13", 1000], ["2026-10-14", 1010]]), 30)).toBeNull();
  });
});

describe("sparkPoints", () => {
  it("dessine de gauche à droite, du bas vers le haut", () => {
    const p = sparkPoints(hist([["2026-10-01", 10], ["2026-10-02", 20]]), 100, 20).split(" ");
    expect(p[0]).toBe("0.0,19.0");
    expect(p[1]).toBe("100.0,1.0");
  });
});

describe("agencyCandidates", () => {
  it("repère les comptes d'agence cités dans les bios", () => {
    const out = agencyCandidates(
      ["Management @wonder.agency 📩", "mgmt: wondertalents", "géré par @wonder.agency", "contact@wonder.agency.fr", "booking @lea.studio"],
      new Set(["ttp.creators"]),
    );
    expect(out[0]).toEqual({ u: "wonder.agency", n: 2 });
    expect(out.map((x) => x.u)).toContain("wondertalents");
    expect(out.map((x) => x.u)).toContain("lea.studio");
    expect(out.map((x) => x.u)).not.toContain("management");
  });
  it("ignore les comptes déjà suivis", () => {
    expect(agencyCandidates(["mgmt @ttp.creators"], new Set(["ttp.creators"]))).toEqual([]);
  });
});
