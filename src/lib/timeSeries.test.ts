import { describe, it, expect } from "vitest";
import { fmtCompact } from "./timeSeries";

describe("fmtCompact (format voulu par Marc : « 1,3K », « 1M », « 1Md »)", () => {
  it("virgule décimale, K / M / Md collés au nombre", () => {
    expect(fmtCompact(1_300)).toBe("1,3K");
    expect(fmtCompact(19_500)).toBe("19,5K");
    expect(fmtCompact(12_000)).toBe("12K");
    expect(fmtCompact(919_000)).toBe("919K");
    expect(fmtCompact(1_000_000)).toBe("1M");
    expect(fmtCompact(1_240_000)).toBe("1,2M");
    expect(fmtCompact(2_400_000_000)).toBe("2,4Md");
  });
  it("petits nombres, négatifs, bornes", () => {
    expect(fmtCompact(850)).toBe("850");
    expect(fmtCompact(0)).toBe("0");
    expect(fmtCompact(-2_800)).toBe("-2,8K");
    expect(fmtCompact(999_960)).toBe("1M");
    expect(fmtCompact(Number.NaN)).toBe("0");
  });
});
