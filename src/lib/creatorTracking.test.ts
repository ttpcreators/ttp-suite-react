import { describe, it, expect } from "vitest";
import {
  emptyCadence, cadenceTotal, emptyProfile, normProfile, emptyMonth,
  computeAlerts, trajectoryOf, type EditorialProfile,
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
