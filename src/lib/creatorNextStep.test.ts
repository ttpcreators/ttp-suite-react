import { describe, expect, it } from "vitest";
import { creatorSteps, pickNextStep, whenLabel, type NextStepInput } from "./creatorNextStep";

// Mardi 20 octobre 2026, 9 h 30 (heure locale).
const NOW = new Date(2026, 9, 20, 9, 30);

const base: NextStepInput = { briefs: [], collabs: [], todos: [], events: [], invoices: [], statsStale: false, now: NOW };
const brief = (over: Partial<NextStepInput["briefs"][number]>) => ({
  id: "b1", brand: "Fitaya", deliverables: "1 reel", due: null, status: "cours", consignes: "Mon script", ...over,
});

describe("prochaine étape du créateur", () => {
  it("rien à faire : aucune étape", () => {
    expect(pickNextStep(base)).toBeNull();
    expect(creatorSteps(base)).toEqual([]);
  });

  it("un contenu en retard passe avant tout le reste", () => {
    const s = pickNextStep({
      ...base,
      statsStale: true,
      briefs: [brief({ id: "a", status: "valider", due: "2026-10-30" }), brief({ id: "b", brand: "Seoni", due: "2026-10-18" })],
    });
    expect(s?.kind).toBe("deliverable");
    expect(s?.vars.brand).toBe("Seoni");
    expect(s?.days).toBe(-2);
    expect(s?.target).toEqual({ tab: "missions", briefId: "b" });
  });

  it("brief à valider, puis script à écrire, puis stats du mois", () => {
    const steps = creatorSteps({
      ...base,
      statsStale: true,
      briefs: [brief({ id: "s", consignes: null, due: "2026-11-20" }), brief({ id: "v", status: "À valider", due: "2026-11-20" })],
    });
    expect(steps.map((x) => x.kind)).toEqual(["validate", "script", "stats"]);
  });

  it("un brief terminé n'apparaît pas", () => {
    expect(creatorSteps({ ...base, briefs: [brief({ status: "Terminé", due: "2026-10-01" })] })).toEqual([]);
  });

  it("à rendre d'ici 2 jours : urgent, avec les livrables en détail", () => {
    const s = pickNextStep({ ...base, briefs: [brief({ due: "21/10/2026" })] });
    expect(s?.bucket).toBe(1);
    expect(s?.detail).toBe("{text}");
    expect(s?.detailVars.text).toBe("1 reel");
  });

  it("rendez-vous de demain avant une tâche prioritaire sans date", () => {
    const steps = creatorSteps({
      ...base,
      events: [{ id: "e1", date: "2026-10-21", day: null, time: "14:00", title: "Tournage Fitaya", type: "shoot" }],
      todos: [{ id: "t1", text: "Monter la vidéo", due: null, priority: "haute", done: false }],
    });
    expect(steps.map((x) => x.id)).toEqual(["event:e1", "todo:t1"]);
    expect(steps[0].detailVars.time).toBe("14:00");
    expect(steps[0].days).toBe(1);
  });

  it("les rendez-vous passés ou lointains et les tâches faites sont ignorés", () => {
    const steps = creatorSteps({
      ...base,
      events: [
        { id: "old", date: "2026-10-19", day: null, time: null, title: "Hier", type: null },
        { id: "far", date: "2026-11-20", day: null, time: null, title: "Loin", type: null },
      ],
      todos: [{ id: "t", text: "Fait", due: null, priority: null, done: true }],
    });
    expect(steps).toEqual([]);
  });

  it("collab à l'étape facturation sans facture à ce nom : dépôt proposé", () => {
    const steps = creatorSteps({
      ...base,
      collabs: [
        { id: "c1", brand: "JNPR", step: 9, status: "active", brief_id: null },
        { id: "c2", brand: "Nutripure", step: 9, status: "active", brief_id: null },
        { id: "c3", brand: "Perdue", step: 9, status: "perdue", brief_id: null },
      ],
      invoices: [{ party: "nutripure" }],
    });
    expect(steps.map((x) => x.id)).toEqual(["invoice:c1"]);
    expect(steps[0].target).toEqual({ tab: "gains" });
  });

  it("libellés du « quand »", () => {
    expect(whenLabel(null)).toBeNull();
    expect(whenLabel(-3)).toEqual({ key: "Depuis {n} jours", vars: { n: 3 } });
    expect(whenLabel(-1)?.key).toBe("Depuis hier");
    expect(whenLabel(0)?.key).toBe("Aujourd'hui");
    expect(whenLabel(1)?.key).toBe("Demain");
    expect(whenLabel(4)).toEqual({ key: "Dans {n} jours", vars: { n: 4 } });
    expect(whenLabel(10)).toBeNull();
  });
});
