import { describe, expect, it } from "vitest";
import { etatRecrut, lireSuivi, noterMessage, plusJours, texteSuivi } from "./recrutementSuivi.ts";

describe("noterMessage", () => {
  it("premier contact puis deux relances, puis fini", () => {
    const s0 = noterMessage(null, "dm", "2026-11-25");
    expect(s0).toEqual({ premier: "2026-11-25", canal: "dm", relances: 0, prochaine: "2026-11-30", dernier: "2026-11-25" });
    const s1 = noterMessage(s0, "email", "2026-11-30");
    expect(s1.relances).toBe(1);
    expect(s1.prochaine).toBe("2026-12-07");
    expect(s1.premier).toBe("2026-11-25");
    const s2 = noterMessage(s1, "dm", "2026-12-07");
    expect(s2.relances).toBe(2);
    expect(s2.prochaine).toBe(null);
    expect(s2.fini).toBe(true);
  });
  it("repart de zéro après un suivi fini", () => {
    const fini = { premier: "2026-01-01", canal: "dm" as const, relances: 2, prochaine: null, dernier: "2026-01-13", fini: true };
    expect(noterMessage(fini, "dm", "2026-11-25").relances).toBe(0);
  });
});

describe("etatRecrut", () => {
  const s = noterMessage(null, "dm", "2026-11-25");
  it("suit les étapes", () => {
    expect(etatRecrut("contacter", null, null, "2026-11-25")).toBe("a_contacter");
    expect(etatRecrut("observation", null, null, "2026-11-25")).toBe("hors_suivi");
    expect(etatRecrut("contacter", s, null, "2026-11-27")).toBe("attente");
    expect(etatRecrut("contacter", s, null, "2026-11-30")).toBe("a_relancer");
    expect(etatRecrut("contacter", s, "2026-11-28", "2026-11-30")).toBe("a_repondu");
    expect(etatRecrut("contacter", s, "2026-11-01", "2026-11-30")).toBe("a_relancer");
    expect(etatRecrut("discussion", s, null, "2026-11-30")).toBe("hors_suivi");
  });
});

describe("lecture et texte", () => {
  it("relit un suivi et refuse un suivi abîmé", () => {
    expect(lireSuivi({ premier: "2026-11-25", canal: "email", relances: 9 })?.relances).toBe(2);
    expect(lireSuivi({ premier: "hier" })).toBe(null);
    expect(lireSuivi(null)).toBe(null);
  });
  it("texte court", () => {
    expect(texteSuivi(null)).toBe("jamais contacté");
    expect(texteSuivi(noterMessage(null, "dm", "2026-11-20"))).toBe("1er contact 20 nov. (DM) · prochaine 25 nov.");
    expect(plusJours("2026-12-30", 5)).toBe("2027-01-04");
  });
});
