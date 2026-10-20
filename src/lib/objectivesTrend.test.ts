import { describe, expect, it } from "vitest";
import {
  averagePct,
  bestMonth,
  clampPct,
  monthlyAverages,
  objectiveStatus,
  trendBars,
} from "./objectivesTrend";

describe("clampPct / averagePct", () => {
  it("borne chaque objectif entre 0 et 100", () => {
    expect(clampPct(150)).toBe(100);
    expect(clampPct(-20)).toBe(0);
    expect(clampPct("42")).toBe(42);
    expect(clampPct("abc")).toBe(0);
    expect(clampPct(undefined)).toBe(0);
  });
  it("moyenne arrondie, dépassement non compté au delà de 100", () => {
    expect(averagePct([{ pct: 150 }, { pct: 20 }])).toBe(60);
    expect(averagePct([{ pct: 33 }, { pct: 34 }])).toBe(34);
    expect(averagePct([])).toBe(0);
  });
});

describe("monthlyAverages", () => {
  it("trie les mois et ignore les clés invalides ou vides", () => {
    const pts = monthlyAverages(
      { "2026-09": [{ pct: 40 }], "2026-08": [{ pct: 60 }, { pct: 60 }], "2026-07": [], foo: [{ pct: 90 }] },
      "2026-10",
    );
    expect(pts).toEqual([
      { month: "2026-08", pct: 60 },
      { month: "2026-09", pct: 40 },
    ]);
  });
  it("ancienne clé « 0 » = mois courant, sauf si le mois a déjà sa clé", () => {
    expect(monthlyAverages({ "0": [{ pct: 80 }] }, "2026-10")).toEqual([{ month: "2026-10", pct: 80 }]);
    expect(monthlyAverages({ "0": [{ pct: 80 }], "2026-10": [{ pct: 10 }] }, "2026-10")).toEqual([
      { month: "2026-10", pct: 10 },
    ]);
  });
});

describe("bestMonth", () => {
  it("prend la moyenne la plus haute, le plus récent à égalité", () => {
    expect(
      bestMonth([
        { month: "2026-07", pct: 60 },
        { month: "2026-08", pct: 60 },
        { month: "2026-09", pct: 40 },
      ]),
    ).toEqual({ month: "2026-08", pct: 60 });
  });
  it("null sans données ou si tout est à 0 %", () => {
    expect(bestMonth([])).toBeNull();
    expect(bestMonth([{ month: "2026-08", pct: 0 }])).toBeNull();
  });
});

describe("trendBars", () => {
  it("ajoute le mois courant vide en « À définir »", () => {
    expect(trendBars([{ month: "2026-09", pct: 40 }], "2026-10")).toEqual([
      { month: "2026-09", pct: 40, empty: false },
      { month: "2026-10", pct: 0, empty: true },
    ]);
  });
  it("pas de barre vide si le mois courant a des données", () => {
    expect(trendBars([{ month: "2026-10", pct: 0 }], "2026-10")).toEqual([{ month: "2026-10", pct: 0, empty: false }]);
  });
  it("aucune donnée → aucune barre", () => {
    expect(trendBars([], "2026-10")).toEqual([]);
  });
  it("garde les derniers mois seulement", () => {
    const pts = Array.from({ length: 14 }, (_, i) => ({ month: `2025-${String(i + 1).padStart(2, "0")}`, pct: i }));
    const bars = trendBars(pts.slice(0, 12), "2026-10", 6);
    expect(bars).toHaveLength(6);
    expect(bars.at(-1)).toEqual({ month: "2026-10", pct: 0, empty: true });
    expect(bars[0].month).toBe("2025-08");
  });
});

describe("objectiveStatus", () => {
  const today = new Date(2026, 9, 15); // 15 octobre 2026 : ~48 % du mois écoulé
  it("atteint dès 100 %", () => {
    expect(objectiveStatus(100, "2026-10", today)).toBe("reached");
    expect(objectiveStatus(130, "2026-08", today)).toBe("reached");
  });
  it("mois passé non atteint", () => {
    expect(objectiveStatus(90, "2026-09", today)).toBe("missed");
  });
  it("mois courant : comparé au rythme attendu", () => {
    expect(objectiveStatus(60, "2026-10", today)).toBe("onTrack");
    expect(objectiveStatus(30, "2026-10", today)).toBe("behind");
  });
  it("mois à venir : jamais en retard", () => {
    expect(objectiveStatus(0, "2026-11", today)).toBe("onTrack");
  });
});
