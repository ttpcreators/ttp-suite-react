import { describe, expect, it } from "vitest";
import { clip45, ctGroups, ctKpis, ctLateDays, ctMatchFilter, ctPostpone, ctStatus, type CtTodo } from "./creatorTodos";

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
