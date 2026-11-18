import { describe, expect, it } from "vitest";
import { alfredEnLigne, heuresTexte, lireReglages } from "./alfredApp";

describe("Alfred dans l'app", () => {
  it("complète les réglages", () => {
    const r = lireReglages({ heures: { matin: 8, veille: [12] }, sonner: { valider: false } });
    expect(r.heures.matin).toBe(8);
    expect(r.heures.soir).toBe(17);
    expect(r.heures.veille).toEqual([12]);
    expect(r.sonner).toEqual({ points: true, valider: false });
    expect(lireReglages(null).heures.veille).toEqual([11, 13, 15]);
  });

  it("dit en ligne ou hors ligne", () => {
    const now = new Date("2026-11-18T12:00:00Z");
    expect(alfredEnLigne("2026-11-18T11:58:00Z", now).enLigne).toBe(true);
    expect(alfredEnLigne("2026-11-18T11:40:00Z", now)).toMatchObject({ enLigne: false, minutes: 20 });
    expect(alfredEnLigne(null, now).jamais).toBe(true);
  });

  it("résume la journée", () => {
    expect(heuresTexte(lireReglages(null).heures)).toContain("point à 9 h");
  });
});
