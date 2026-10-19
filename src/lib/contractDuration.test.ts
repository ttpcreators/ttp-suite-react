import { describe, it, expect } from "vitest";
import { durationToMonths } from "./contractDuration";

describe("durationToMonths", () => {
  it("lit les mois (et un nombre seul comme des mois)", () => {
    expect(durationToMonths("12 mois")).toBe(12);
    expect(durationToMonths("3 Mois")).toBe(3);
    expect(durationToMonths("6")).toBe(6);
  });

  it("lit les années, semaines et jours (plus lus comme des mois)", () => {
    expect(durationToMonths("1 an")).toBe(12);
    expect(durationToMonths("2 ans")).toBe(24);
    expect(durationToMonths("1 année")).toBe(12);
    expect(durationToMonths("6 semaines")).toBe(2);
    expect(durationToMonths("90 jours")).toBe(3);
    expect(durationToMonths("1,5 an")).toBe(18);
    expect(durationToMonths("1 an et 6 mois")).toBe(18);
  });

  it("au moins un mois pour une durée courte", () => {
    expect(durationToMonths("1 semaine")).toBe(1);
    expect(durationToMonths("10 jours")).toBe(1);
  });

  it("vide ou non compris → null (pas d'échéance)", () => {
    expect(durationToMonths("")).toBeNull();
    expect(durationToMonths("—")).toBeNull();
    expect(durationToMonths("illimitée")).toBeNull();
    expect(durationToMonths("48 h")).toBeNull();
    expect(durationToMonths("0 mois")).toBeNull();
  });
});
