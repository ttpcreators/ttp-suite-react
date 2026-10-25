import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { daysSinceDue, isOverdueInvoice, overdueInvoices, parseDueDate, relanceEmail } from "./relance";

describe("relances", () => {
  it("lit les échéances ISO et jj/mm/aaaa ; rien d'autre", () => {
    expect(parseDueDate("2026-10-21")?.getDate()).toBe(21);
    expect(parseDueDate("05/11/26")?.getFullYear()).toBe(2026);
    expect(parseDueDate("—")).toBeNull();
    expect(parseDueDate(null)).toBeNull();
  });

  it("en retard dès le lendemain de l'échéance, même au passage à l'heure d'été", () => {
    // Nuit du 27 au 28 mars 2027 : ce jour-là ne dure que 23 h en France.
    const now = new Date(2027, 2, 29, 9, 0);
    expect(daysSinceDue(new Date(2027, 2, 28), now)).toBe(1);
    expect(isOverdueInvoice({ status: "attente", date: "2027-03-28" }, now)).toBe(true);
    expect(isOverdueInvoice({ status: "attente", date: "2027-03-29" }, now)).toBe(false);
    expect(isOverdueInvoice({ status: "brouillon", date: "2020-01-01" }, now)).toBe(false);
    expect(isOverdueInvoice({ status: "payee", date: "2020-01-01" }, now)).toBe(false);
    expect(isOverdueInvoice({ status: "retard", date: null }, now)).toBe(true);
  });

  it("trie de la plus en retard à la moins en retard", () => {
    const now = new Date(2026, 9, 25);
    const base = { ref: "F", party: "Marque", amount: "100", creator: null };
    const list = overdueInvoices(
      [
        { ...base, id: "a", date: "2026-10-20", status: "attente" },
        { ...base, id: "b", date: "2026-09-01", status: "attente" },
        { ...base, id: "c", date: "2026-12-01", status: "attente" },
      ],
      now,
    );
    expect(list.map((x) => [x.iv.id, x.late])).toEqual([["b", 54], ["a", 5]]);
  });

  it("montant de l'email au centime", () => {
    const { subject } = relanceEmail({ ref: "2026-190", party: "Marque", amount: "1 200,50 €" }, 0);
    expect(subject.replace(/\s/g, " ")).toBe("Relance : facture 2026-190 · 1 200,50 €");
  });
});

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
