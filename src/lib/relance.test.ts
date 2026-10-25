import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { daysSinceDue, parseDueDate } from "./relance";

// Heure de Paris : les changements d'heure (fin mars, fin octobre) donnent des jours de 23 h et 25 h.
beforeAll(() => {
  vi.stubEnv("TZ", "Europe/Paris");
});
afterAll(() => {
  vi.unstubAllEnvs();
});

describe("daysSinceDue", () => {
  it("compte les jours pleins au passage à l'heure d'été (jour de 23 h)", () => {
    const due = parseDueDate("2027-03-27")!;
    expect(daysSinceDue(due, new Date(2027, 2, 29, 10))).toBe(2);
    expect(daysSinceDue(parseDueDate("2027-03-27")!, new Date(2027, 2, 28, 9))).toBe(1);
  });
  it("compte les jours pleins au passage à l'heure d'hiver (jour de 25 h)", () => {
    expect(daysSinceDue(parseDueDate("2026-10-24")!, new Date(2026, 9, 26, 8))).toBe(2);
  });
  it("une échéance du jour n'est pas en retard, celle de demain non plus", () => {
    const now = new Date(2026, 9, 25, 23, 30);
    expect(daysSinceDue(parseDueDate("2026-10-25")!, now)).toBe(0);
    expect(daysSinceDue(parseDueDate("26/10/2026")!, now)).toBe(-1);
  });
});
