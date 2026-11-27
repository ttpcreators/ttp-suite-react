import { describe, expect, it } from "vitest";
import { brandInitial, briefHasContent, briefKey, buildMissions, creatorPhaseIndex, creatorStage, missionAction, missionState, pairCollabBriefs, stepLine, type MissionBrief, type MissionCollab } from "./creatorMissions";

const brief = (over: Partial<MissionBrief>): MissionBrief => ({ id: "b1", brand: "Marque X", deliverables: "1 reel", due: null, status: "cours", consignes: null, ...over });
const collab = (over: Partial<MissionCollab>): MissionCollab => ({ id: "c1", brand: "Marque X", title: null, deliverables: null, step: 4, status: "active", brief_id: null, ...over });

describe("missions du créateur", () => {
  it("une collab reliée à son brief ne fait qu'une mission", () => {
    const m = buildMissions([collab({ brief_id: "b2", title: "Reel de 45 s" })], [brief({ id: "b2", due: "23/10/2026" })]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ id: "c:c1", step: 4, title: "Reel de 45 s", due: "2026-10-23", done: false });
    expect(m[0].brief?.id).toBe("b2");
  });

  it("sans lien explicite, rapprochement par marque ; un brief seul reste une mission", () => {
    const m = buildMissions([collab({ brand: "marque x " })], [brief({ id: "x" }), brief({ id: "y", brand: "Marque Y" })]);
    expect(m.map((x) => x.id).sort()).toEqual(["b:y", "c:c1"]);
    expect(m.find((x) => x.id === "c:c1")?.brief?.id).toBe("x");
    expect(m.find((x) => x.id === "b:y")?.step).toBeNull();
  });

  it("un brief sans marque (colonne vide en base) ne fait pas planter le tri", () => {
    const m = buildMissions([collab({ brand: "Marque Y" })], [brief({ id: "n1", brand: null }), brief({ id: "n2", brand: null, due: "2026-10-30" })]);
    expect(m.map((x) => x.id)).toEqual(["b:n2", "b:n1", "c:c1"]);
    expect(m.find((x) => x.id === "b:n1")?.brand).toBe("");
  });

  it("collabs perdues ou archivées cachées ; terminées en dernier ; échéance la plus proche d'abord", () => {
    const m = buildMissions(
      [collab({ id: "lost", status: "perdue" }), collab({ id: "won", brand: "Won", step: 11 })],
      [brief({ id: "late", brand: "B", due: "2026-11-02" }), brief({ id: "soon", brand: "A", due: "2026-10-25" }), brief({ id: "nodate", brand: "C" })],
    );
    expect(m.map((x) => x.id)).toEqual(["b:soon", "b:late", "b:nodate", "c:won"]);
  });

  it("même rapprochement collab ↔ brief pour les missions et la prochaine étape", () => {
    const collabs = [collab({ id: "a", brand: "Marque X" }), collab({ id: "b", brand: "Marque Y", brief_id: "by" }), collab({ id: "p", brand: "Marque Z", status: "perdue" })];
    const briefs = [brief({ id: "bx" }), brief({ id: "by", brand: "Marque Y" }), brief({ id: "bz", brand: "Marque Z" })];
    const pairs = pairCollabBriefs(collabs, briefs);
    expect([...pairs.entries()].map(([c, b]) => [c, b.id])).toEqual([["a", "bx"], ["b", "by"]]);
    // Collab perdue : son brief reste une mission à lui seul.
    expect(buildMissions(collabs, briefs).find((m) => m.id === "b:bz")).toBeTruthy();
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
    expect(brandInitial(" marque z")).toBe("M");
    expect(brandInitial("")).toBe("?");
  });
});

describe("étapes vues par le créateur", () => {
  const withStep = (step: number, status = "active", hasBrief = true, over: Partial<MissionBrief> = {}) =>
    buildMissions([collab({ step, status, brief_id: "b1" })], hasBrief ? [brief({ id: "b1", ...over })] : [])[0];
  it("les 11 étapes agence deviennent 5 étapes créateur", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => creatorStage(withStep(n)))).toEqual([-1, 0, 0, 1, 2, 3, 3, 3, 3, 4, 4]);
  });
  it("une collab gagnée suit son étape : jamais « Terminée » ni « Payé » avant la fin", () => {
    expect([1, 3, 9, 10].map((n) => creatorStage(withStep(n, "gagnee")))).toEqual([-1, 0, 3, 4]);
    expect(withStep(3, "gagnee").done).toBe(false);
    expect(withStep(10, "gagnee").done).toBe(false);
    expect(withStep(11, "gagnee").done).toBe(true);
    expect(missionState(withStep(2, "gagnee"), "2026-10-20").label).toBe("En cours");
    expect(missionAction(withStep(2, "gagnee"))?.label).toBe("Lire le brief");
    expect(missionAction(withStep(3, "gagnee"))?.label).toBe("Envoyer mon contenu");
  });
  it("brief seul : selon son statut", () => {
    expect(creatorStage(buildMissions([], [brief({ status: "attente" })])[0])).toBe(0);
    expect(creatorStage(buildMissions([], [brief({ status: "valider" })])[0])).toBe(1);
    expect(creatorStage(buildMissions([], [brief({ status: "terminé" })])[0])).toBe(2);
  });
  it("un seul bouton principal, selon l'étape", () => {
    expect(missionAction(withStep(2))?.label).toBe("Lire le brief");
    expect(missionAction(withStep(3))?.label).toBe("Envoyer mon contenu");
    // Étape 4 : pas de retours de la marque dans l'app, le bouton ouvre la fiche.
    expect(missionAction(withStep(4))).toEqual({ key: "open", label: "Ouvrir" });
    expect(missionAction(buildMissions([], [brief({ status: "valider" })])[0])?.key).toBe("open");
    expect(missionAction(withStep(6))?.label).toBe("Ouvrir");
    expect(missionAction(withStep(8))?.label).toBe("Déposer ma facture");
    expect(missionAction(withStep(10))).toBeNull();
    expect(missionAction(withStep(1, "active", false))?.label).toBe("Ouvrir");
    expect(missionAction(buildMissions([], [brief({ status: "cours" })])[0])?.label).toBe("Envoyer mon contenu");
  });
  it("à la signature, « Lire le brief » seulement si le brief a un résumé ou un PDF", () => {
    // Brief créé tout seul avec la collab : livrables recopiés, rien d'autre.
    expect(missionAction(withStep(1))?.label).toBe("Ouvrir");
    const resume = { faire: ["Montrer le produit"], eviter: [], livrables: [], mentions: [] };
    expect(missionAction(withStep(1, "active", true, { resume }))?.label).toBe("Lire le brief");
    expect(missionAction(withStep(1, "active", true, { pdf: { path: "briefs/b1.pdf" } }))?.label).toBe("Lire le brief");
    expect(briefHasContent(brief({ pdf: {} }))).toBe(false);
    expect(briefHasContent(null)).toBe(false);
  });
  it("« Lire le brief » tant que « J'ai lu » n'est pas touché, comme « Ta prochaine étape »", () => {
    expect(missionAction(withStep(2), false)?.label).toBe("Lire le brief");
    // Étape 2, brief lu : le script et le concept se font dans la fiche.
    expect(missionAction(withStep(2), true)).toEqual({ key: "open", label: "Ouvrir" });
    expect(missionAction(withStep(3), true)?.label).toBe("Envoyer mon contenu");
    const resume = { faire: ["Montrer le produit"], eviter: [], livrables: [], mentions: [] };
    expect(missionAction(withStep(1, "active", true, { resume }), true)?.label).toBe("Ouvrir");
    // Brief seul « En attente » déjà lu : il ne reste qu'à envoyer son contenu.
    const [seul] = buildMissions([], [brief({ status: "attente" })]);
    expect(missionAction(seul)?.label).toBe("Lire le brief");
    expect(missionAction(seul, true)?.label).toBe("Envoyer mon contenu");
  });
  it("l'échéance du brief compte jusqu'au tournage : plus de retard une fois le contenu validé", () => {
    const today = "2026-10-20";
    expect(withStep(4, "active", true, { due: "2026-09-01" }).due).toBe("2026-09-01");
    expect(missionState(withStep(4, "active", true, { due: "2026-09-01" }), today).label).toBe("Échéance passée");
    // Étape 5 et après (validée, publiée, payée) : ni « Échéance passée » ni date.
    for (const [step, status] of [[5, "active"], [6, "active"], [9, "gagnee"], [10, "gagnee"]] as const) {
      const m = withStep(step, status, true, { due: "2026-09-01" });
      expect(m.due).toBe("");
      expect(missionState(m, today)).toEqual({ tone: "progress", label: "En cours" });
    }
    // Signature : la date du brief reste affichée.
    expect(withStep(1, "active", true, { due: "2026-11-05" }).due).toBe("2026-11-05");
  });
});
