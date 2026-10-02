import { describe, it, expect } from "vitest";
import { fmtCompact } from "./timeSeries";

describe("fmtCompact (format français)", () => {
  it("virgule décimale, k minuscule, espace fine insécable", () => {
    expect(fmtCompact(19_500)).toBe("19,5 k");
    expect(fmtCompact(12_000)).toBe("12 k");
    expect(fmtCompact(1_240_000)).toBe("1,2 M");
  });
  it("petits nombres, négatifs, bornes", () => {
    expect(fmtCompact(850)).toBe("850");
    expect(fmtCompact(0)).toBe("0");
    expect(fmtCompact(-2_800)).toBe("-2,8 k");
    expect(fmtCompact(999_960)).toBe("1 M");
    expect(fmtCompact(Number.NaN)).toBe("0");
  });
});
