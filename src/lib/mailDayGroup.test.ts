import { describe, expect, it } from "vitest";
import { dayGroup } from "./mailDayGroup";

describe("dayGroup", () => {
  const now = new Date(2026, 10, 4, 18, 0);
  it("groupe par jour puis par mois", () => {
    expect(dayGroup(new Date(2026, 10, 4, 8, 0).getTime(), now)).toBe("Aujourd'hui");
    expect(dayGroup(new Date(2026, 10, 3, 23, 0).getTime(), now)).toBe("Hier");
    expect(dayGroup(new Date(2026, 10, 1, 9, 0).getTime(), now)).toBe("Cette semaine");
    expect(dayGroup(new Date(2026, 9, 20).getTime(), now)).toBe("Octobre");
    expect(dayGroup(new Date(2025, 8, 30).getTime(), now)).toBe("Septembre 2025");
  });
});
