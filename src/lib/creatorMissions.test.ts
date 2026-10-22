import { describe, expect, it } from "vitest";
import { brandInitial, briefKey, buildMissions, creatorPhaseIndex, creatorStage, missionAction, missionState, stepLine, type MissionBrief, type MissionCollab } from "./creatorMissions";

const brief = (over: Partial<MissionBrief>): MissionBrief => ({ id: "b1", brand: "Fitaya", deliverables: "1 reel", due: null, status: "cours", consignes: null, ...over });
const collab = (over: Partial<MissionCollab>): MissionCollab => ({ id: "c1", brand: "Fitaya", title: null, deliverables: null, step: 4, status: "active", brief_id: null, ...over });

describe("missions du créateur", () => {
  it("une collab reliée à son brief ne fait qu'une mission", () => {
    const m = buildMissions([collab({ brief_id: "b2", title: "Reel de 45 s" })], [brief({ id: "b2", due: "23/10/2026" })]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ id: "c:c1", step: 4, title: "Reel de 45 s", due: "2026-10-23", done: false });
    expect(m[0].brief?.id).toBe("b2");
  });

  it("sans lien explicite, rapprochement par marque ; un brief seul reste une mission", () => {
    const m = buildMissions([collab({ brand: "fitaya " })], [brief({ id: "x" }), brief({ id: "y", brand: "Seoni" })]);
    expect(m.map((x) => x.id).sort()).toEqual(["b:y", "c:c1"]);
    expect(m.find((x) => x.id === "c:c1")?.brief?.id).toBe("x");
    expect(m.find((x) => x.id === "b:y")?.step).toBeNull();
  });

  it("collabs perdues ou archivées cachées ; terminées en dernier ; échéance la plus proche d'abord", () => {
    const m = buildMissions(
      [collab({ id: "lost", status: "perdue" }), collab({ id: "won", brand: "Won", step: 11 })],
      [brief({ id: "late", brand: "B", due: "2026-11-02" }), brief({ id: "soon", brand: "A", due: "2026-10-25" }), brief({ id: "nodate", brand: "C" })],
    );
    expect(m.map((x) => x.id)).toEqual(["b:soon", "b:late", "b:nodate", "c:won"]);
  });

  it("statut normalisé et pastille (jamais de rouge)", () => {
    expect(briefKey("À valider")).toBe("valider");
    expect(briefKey("Terminé")).toBe("terminé");
    expect(briefKey("en cours")).toBe("cours");
    expect(briefKey("")).toBe("attente");
    const [m] = buildMissions([], [brief({ due: "2026-10-01" })]);
    expect(missionState(m, "2026-10-20")).toEqual({ tone: "wait", label: "Échéance passée" });
    const [v] = buildMissions([], [brief({ status: "valider" })]);
    expect(missionState(v, "2026-10-20").tone).toBe("info");
    const [d] = buildMissions([], [brief({ status: "terminé", due: "2026-10-01" })]);
    expect(missionState(d, "2026-10-20")).toEqual({ tone: "ok", label: "Terminée" });
  });

  it("phases créateur et ligne d'étape", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 11].map(creatorPhaseIndex)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect(stepLine(4)).toEqual({ key: "Étape {n} sur {total} · {label}", vars: { n: 4, total: 11, label: "Tournage" } });
    expect(brandInitial(" nutripure")).toBe("N");
    expect(brandInitial("")).toBe("?");
  });
});

describe("étapes vues par le créateur", () => {
  const withStep = (step: number, status = "active", hasBrief = true) => buildMissions([collab({ step, status, brief_id: "b1" })], hasBrief ? [brief({ id: "b1" })] : [])[0];
  it("les 11 étapes agence deviennent 5 étapes créateur", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => creatorStage(withStep(n)))).toEqual([-1, 0, 0, 1, 2, 3, 3, 3, 3, 4, 4]);
    expect(creatorStage(withStep(3, "gagnee"))).toBe(4);
  });
  it("brief seul : selon son statut", () => {
    expect(creatorStage(buildMissions([], [brief({ status: "attente" })])[0])).toBe(0);
    expect(creatorStage(buildMissions([], [brief({ status: "valider" })])[0])).toBe(1);
    expect(creatorStage(buildMissions([], [brief({ status: "terminé" })])[0])).toBe(2);
  });
  it("un seul bouton principal, selon l'étape", () => {
    expect(missionAction(withStep(2))?.label).toBe("Lire le brief");
    expect(missionAction(withStep(3))?.label).toBe("Envoyer mon contenu");
    expect(missionAction(withStep(4))?.label).toBe("Voir les retours");
    expect(missionAction(withStep(6))?.label).toBe("Ouvrir");
    expect(missionAction(withStep(8))?.label).toBe("Déposer ma facture");
    expect(missionAction(withStep(10))).toBeNull();
    expect(missionAction(withStep(1, "active", false))?.label).toBe("Ouvrir");
    expect(missionAction(buildMissions([], [brief({ status: "cours" })])[0])?.label).toBe("Envoyer mon contenu");
  });
});

