import { describe, expect, it } from "vitest";
import { agencyAwaits, appendPoint, latestPoint, parsePoints, progressColumnMissing, stampPoint } from "./todoProgress";

const NOW = new Date(2026, 9, 21, 9, 5);

describe("todoProgress", () => {
  it("un nouveau point porte sa date", () => {
    expect(stampPoint("  Brief envoyé ", NOW)).toBe("21/10/2026 · Brief envoyé");
    expect(appendPoint("", "Brief envoyé", NOW)).toBe("21/10/2026 · Brief envoyé");
    expect(appendPoint("Ancien point\n", "Relance", NOW)).toBe("Ancien point\n21/10/2026 · Relance");
  });

  it("lecture : points datés et anciens points sans date", () => {
    expect(parsePoints("Ancien point\n\n21/10/2026 · Relance faite")).toEqual([
      { date: null, text: "Ancien point" },
      { date: "21/10/2026", text: "Relance faite" },
    ]);
    expect(parsePoints(null)).toEqual([]);
  });

  it("dernier point = où j'en suis", () => {
    expect(latestPoint("A\n20/10/2026 · B\n21/10/2026 · C")).toEqual({ date: "21/10/2026", text: "C" });
    expect(latestPoint("Juste un mot")).toEqual({ date: null, text: "Juste un mot" });
    expect(latestPoint("  ")).toBeNull();
  });

  it("un point signé dit qui l'a écrit", () => {
    expect(stampPoint("Tu peux m'envoyer le script ?", NOW, "Agence")).toBe("21/10/2026 · Agence : Tu peux m'envoyer le script ?");
    expect(parsePoints("21/10/2026 · Agence : Script ?\n21/10/2026 · Créateur : Envoyé\n21/10/2026 · Note : libre")).toEqual([
      { date: "21/10/2026", text: "Script ?", who: "Agence" },
      { date: "21/10/2026", text: "Envoyé", who: "Créateur" },
      { date: "21/10/2026", text: "Note : libre" },
    ]);
  });

  it("message de l'agence en attente", () => {
    expect(agencyAwaits("21/10/2026 · Agence : Script ?")).toBe(true);
    expect(agencyAwaits("21/10/2026 · Agence : Script ?\n21/10/2026 · Créateur : Envoyé")).toBe(false);
    expect(agencyAwaits("Ancien point")).toBe(false);
  });

  it("reconnaît la colonne absente", () => {
    expect(progressColumnMissing({ code: "42703", message: 'column todos.progress does not exist' })).toBe(true);
    expect(progressColumnMissing({ code: "42501", message: "permission denied" })).toBe(false);
  });
});
