import { describe, it, expect } from "vitest";
import {
  emptyCadence, cadenceTotal, emptyProfile, normProfile, emptyMonth,
  computeAlerts, trajectoryOf, contractDaysLeft, lastMonthOf, lastContact, nextPoint,
  roadmapFrom, normRoadmap, normSelfCadence,
  type EditorialProfile, type MonthEntry, type JournalEntry,
} from "./creatorTracking";

describe("cadence", () => {
  it("somme les formats en ignorant les négatifs", () => {
    expect(cadenceTotal({ reels: 4, carrousels: 2, stories: 8, tiktoks: 6, youtube: 1 })).toBe(21);
    expect(cadenceTotal({ ...emptyCadence(), reels: -3, stories: 5 })).toBe(5);
  });
});

describe("normProfile — tolérance aux blobs partiels", () => {
  it("complète un profil vide/legacy sans casser", () => {
    const p = normProfile(undefined);
    expect(p.piliers).toEqual([]);
    expect(p.cadenceReco).toEqual(emptyCadence());
    expect(p.plateformes).toEqual([]);
  });
  it("filtre les plateformes inconnues", () => {
    const p = normProfile({ plateformes: ["instagram", "myspace", "tiktok"] as never });
    expect(p.plateformes).toEqual(["instagram", "tiktok"]);
  });
});

describe("computeAlerts", () => {
  const base: EditorialProfile = { ...emptyProfile(), cadenceReco: { reels: 8, carrousels: 0, stories: 0, tiktoks: 0, youtube: 0 } };

  it("sous-performance quand la cadence réelle < 70 % de la recommandée", () => {
    const m = { ...emptyMonth("2026-07"), cadence: { ...emptyCadence(), reels: 5 } }; // 5 < 5.6
    const a = computeAlerts({ profile: base, lastMonth: m });
    expect(a.some((x) => x.kind === "sousperf")).toBe(true);
  });
  it("pas de sous-perf si la cadence est tenue", () => {
    const m = { ...emptyMonth("2026-07"), cadence: { ...emptyCadence(), reels: 8 } };
    expect(computeAlerts({ profile: base, lastMonth: m }).some((x) => x.kind === "sousperf")).toBe(false);
  });
  it("dérive éditoriale remontée depuis le mois", () => {
    const m = { ...emptyMonth("2026-07"), cadence: { ...emptyCadence(), reels: 8 }, derive: true };
    expect(computeAlerts({ profile: base, lastMonth: m }).some((x) => x.kind === "derive")).toBe(true);
  });
  it("renouvellement selon le délai (danger ≤ 7 j)", () => {
    expect(computeAlerts({ profile: base, deadlineInDays: 40 }).some((x) => x.kind === "renouvellement")).toBe(false);
    const soon = computeAlerts({ profile: base, deadlineInDays: 5 }).find((x) => x.kind === "renouvellement");
    expect(soon?.level).toBe("danger");
  });
  it("conformité : à vérifier tant que non marquée « ok »", () => {
    expect(computeAlerts({ profile: { ...base, conformite: "à vérifier" } }).some((x) => x.kind === "conformite")).toBe(true);
    expect(computeAlerts({ profile: { ...base, conformite: "OK" } }).some((x) => x.kind === "conformite")).toBe(false);
    expect(computeAlerts({ profile: base }).some((x) => x.kind === "conformite")).toBe(false); // vide = pas d'alerte
  });
});

describe("trajectoryOf", () => {
  it("le plus grave l'emporte", () => {
    expect(trajectoryOf([])).toBe("bonne");
    expect(trajectoryOf([{ kind: "derive", label: "", level: "warn" }])).toBe("surveiller");
    expect(trajectoryOf([{ kind: "sousperf", label: "", level: "danger" }, { kind: "derive", label: "", level: "warn" }])).toBe("difficulte");
  });
});

describe("dérivés dashboard", () => {
  it("contractDaysLeft : différence en jours (négatif si échu)", () => {
    const in10 = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    // deal démarré aujourd'hui-10j+... plus simple : start = dans 10j, 0 mois → ~10j
    expect(contractDaysLeft(in10, 0)).toBeGreaterThanOrEqual(9);
    expect(contractDaysLeft("pas une date", 12)).toBeNull();
    const pastStart = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
    expect(contractDaysLeft(pastStart, 12)).toBeLessThan(0); // 12 mois après un début il y a 400j → échu
  });
  it("lastMonthOf prend le mois le plus récent", () => {
    const ms: MonthEntry[] = [emptyMonth("2026-05"), emptyMonth("2026-07"), emptyMonth("2026-06")];
    expect(lastMonthOf(ms)?.month).toBe("2026-07");
    expect(lastMonthOf([])).toBeUndefined();
  });
  it("lastContact = date la plus récente du journal", () => {
    const j: JournalEntry[] = [
      { id: "1", date: "2026-07-01", type: "appel", resume: "", decisions: "", actions: "", prochainPoint: "" },
      { id: "2", date: "2026-07-15", type: "message", resume: "", decisions: "", actions: "", prochainPoint: "" },
    ];
    expect(lastContact(j)).toBe("2026-07-15");
    expect(lastContact([])).toBeNull();
  });
  it("nextPoint = prochain point futur le plus proche", () => {
    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const j: JournalEntry[] = [
      { id: "1", date: today, type: "appel", resume: "", decisions: "", actions: "", prochainPoint: "2020-01-01" }, // passé → ignoré
      { id: "2", date: today, type: "appel", resume: "", decisions: "", actions: "", prochainPoint: future },
    ];
    expect(nextPoint(j)).toBe(future);
    expect(nextPoint([])).toBeNull();
  });
});

describe("feuille de route partagée", () => {
  it("roadmapFrom n'expose PAS la conformité ni la date d'entrée", () => {
    const p: EditorialProfile = { ...emptyProfile(), conformite: "à vérifier", dateEntree: "2026-01-01", positionnement: "Fitness", piliers: ["a", "b"] };
    const r = roadmapFrom(p);
    expect(r.positionnement).toBe("Fitness");
    expect(r.piliers).toEqual(["a", "b"]);
    expect("conformite" in r).toBe(false);
    expect("dateEntree" in r).toBe(false);
  });
  it("normRoadmap tolère un blob null/partiel", () => {
    expect(normRoadmap(null).piliers).toEqual([]);
    expect(normRoadmap({ piliers: ["x"] }).piliers).toEqual(["x"]);
  });
  it("normSelfCadence complète chaque mois et ignore les entrées vides", () => {
    const s = normSelfCadence({ "2026-07": { reels: 5 } as never });
    expect(s["2026-07"]).toEqual({ ...emptyCadence(), reels: 5 });
    expect(normSelfCadence(null)).toEqual({});
  });
});
