import { describe, expect, it } from "vitest";
import { clip45, ctDroits, ctGroups, ctKpis, ctLateDays, ctMatchFilter, ctPeutRetirer, ctPostpone, ctSorte, ctStatus, type CtTodo } from "./creatorTodos";

const T = "2026-10-22";
const td = (p: Partial<CtTodo>): CtTodo => ({ id: "x", text: "Tâche", due: null, priority: "moyenne", done: false, ...p });

describe("À faire du créateur", () => {
  it("retard et statut", () => {
    expect(ctLateDays(td({ due: "2026-10-19" }), T)).toBe(3);
    expect(ctLateDays(td({ due: "2026-10-19", done: true }), T)).toBe(0);
    expect(ctLateDays(td({ due: "—" }), T)).toBe(0);
    expect(ctStatus(td({ status: "En cours" }))).toBe("En cours");
    expect(ctStatus(td({ status: "En cours", done: true }))).toBe("Fait");
  });
  it("filtres et tuiles", () => {
    const rows = [td({ id: "a", priority: "haute" }), td({ id: "b", due: "2026-10-01" }), td({ id: "c", done: true })];
    expect(rows.filter((r) => ctMatchFilter("encours", r, T)).map((r) => r.id)).toEqual(["a", "b"]);
    expect(rows.filter((r) => ctMatchFilter("retard", r, T)).map((r) => r.id)).toEqual(["b"]);
    expect(ctKpis(rows, T)).toEqual({ encours: 2, retard: 1, prioritaires: 1, terminees: 1 });
  });
  it("groupes par priorité, dans l'ordre", () => {
    const g = ctGroups([td({ id: "a", priority: "basse" }), td({ id: "b", priority: "haute" }), td({ id: "c", priority: "??" })]);
    expect(g.map((x) => [x.key, x.rows.map((r) => r.id)])).toEqual([["haute", ["b"]], ["basse", ["a"]], ["autre", ["c"]]]);
  });
  it("report et titre court", () => {
    expect(ctPostpone(td({ due: "2026-10-30" }), 1, T)).toBe("2026-10-31");
    expect(ctPostpone(td({ due: "2026-10-01" }), 7, T)).toBe("2026-10-29");
    expect(clip45("x".repeat(50))).toHaveLength(45);
  });
});

describe("tâches de l'agence chez le créateur (vague 1)", () => {
  const suivie = (p: Partial<CtTodo>) => td({ source: "agency", pour_createur: false, ...p });
  const demandee = (p: Partial<CtTodo>) => td({ source: "agency", pour_createur: true, ...p });

  it("une tâche suivie par l'agence n'est jamais en retard ni comptée", () => {
    expect(ctLateDays(suivie({ due: "2026-10-01" }), T)).toBe(0);
    expect(ctMatchFilter("retard", suivie({ due: "2026-10-01" }), T)).toBe(false);
    const rows = [td({ id: "a" }), demandee({ id: "b", due: "2026-10-01", priority: "haute" }), suivie({ id: "c", due: "2026-10-01", priority: "haute" }), suivie({ id: "d", done: true })];
    expect(ctKpis(rows, T)).toEqual({ encours: 2, retard: 1, prioritaires: 1, terminees: 0 });
  });

  it("trois sortes, et ce que le créateur peut en faire", () => {
    expect([td({}), td({ source: "creator" }), demandee({}), suivie({})].map(ctSorte)).toEqual(["sienne", "sienne", "demandee", "suivie"]);
    expect(ctDroits(td({ source: "creator" }))).toEqual({ terminer: true, modifier: true, supprimer: true, sousTaches: true, deposer: true });
    expect(ctDroits(demandee({}))).toEqual({ terminer: true, modifier: false, supprimer: false, sousTaches: true, deposer: true });
    expect(ctDroits(suivie({}))).toEqual({ terminer: false, modifier: false, supprimer: false, sousTaches: false, deposer: false });
  });

  it("avant le SQL, une tâche de l'agence est demandée : il la termine, sans la modifier ni la supprimer", () => {
    expect(ctSorte(td({ source: "agency" }))).toBe("demandee");
    expect(ctDroits(td({ source: "agency" }))).toMatchObject({ terminer: true, modifier: false, supprimer: false });
  });

  it("pièces jointes : sur une tâche demandée, il ne retire que les siennes", () => {
    const mien = "creator-uploads/u1/todo-attachments/t1/a.pdf";
    const agence = "todo-attachments/t1/brief.pdf";
    expect(ctPeutRetirer(td({ source: "creator" }), agence, "creator-uploads/u1/")).toBe(true);
    expect(ctPeutRetirer(demandee({}), mien, "creator-uploads/u1/")).toBe(true);
    expect(ctPeutRetirer(demandee({}), agence, "creator-uploads/u1/")).toBe(false);
    expect(ctPeutRetirer(demandee({}), "creator-uploads/u2/todo-attachments/t1/b.pdf", "creator-uploads/u1/")).toBe(false);
    expect(ctPeutRetirer(suivie({}), mien, "creator-uploads/u1/")).toBe(false);
  });
});
