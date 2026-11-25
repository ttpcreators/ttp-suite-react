import { describe, expect, it } from "vitest";
import { PLAFONDS, partDuReleve, raisonDAttendre } from "./quotaMeta.ts";

const now = Date.parse("2026-11-25T10:00:00Z");
const ilYa = (min: number) => new Date(now - min * 60_000).toISOString();

describe("quota Meta partagé", () => {
  it("les profils passent avant l'import, l'import avant le radar", () => {
    expect(PLAFONDS.profils).toBeGreaterThan(PLAFONDS.import);
    expect(PLAFONDS.import).toBeGreaterThan(PLAFONDS.radar);
  });
  it("part du relevé", () => {
    expect(partDuReleve({ appPct: 40, bucPct: 72 })).toBe(72);
    expect(partDuReleve({})).toBe(null);
  });
  it("attend si Meta bloque", () => {
    expect(raisonDAttendre({ blockedUntil: new Date(now + 60_000).toISOString() }, 85, now)).toBe("meta_limite");
    expect(raisonDAttendre({ blockedUntil: ilYa(1) }, 85, now)).toBe(null);
  });
  it("attend si le relevé récent dépasse le plafond de la tâche", () => {
    const r = { appPct: 70, lastAt: ilYa(3) };
    expect(raisonDAttendre(r, PLAFONDS.radar, now)).toBe("quota_proche");
    expect(raisonDAttendre(r, PLAFONDS.import, now)).toBe(null);
    expect(raisonDAttendre(r, PLAFONDS.profils, now)).toBe(null);
  });
  it("un vieux relevé ne bloque pas", () => {
    expect(raisonDAttendre({ appPct: 99, lastAt: ilYa(30) }, PLAFONDS.radar, now)).toBe(null);
    expect(raisonDAttendre(null, PLAFONDS.radar, now)).toBe(null);
  });
});
