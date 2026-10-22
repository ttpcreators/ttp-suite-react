import { describe, expect, it } from "vitest";
import { creatorTodayItems, creatorTodaySections, creatorVerb, sectionFor } from "./creatorToday";
import { markHandled, snooze } from "./aujourdhui";

const NOW = new Date(2026, 9, 22, 10);
const base = { briefs: [], collabs: [], todos: [], events: [], invoices: [], statsStale: false, now: NOW, snoozed: {}, handled: {} };

describe("Aujourd'hui du créateur", () => {
  it("range par moment", () => {
    expect([null, -2, 0, 1, 2, 7, 8, 30, 31].map(sectionFor)).toEqual(["today", "late", "today", "tomorrow", "week", "week", "later", "later", null]);
  });

  it("tâches, rendez-vous et contenus jusqu'à 30 jours", () => {
    const items = creatorTodayItems({
      ...base,
      todos: [
        { id: "t1", text: "Envoyer le script", due: "2026-10-23", priority: "haute", done: false },
        { id: "t2", text: "Ranger", due: null, priority: null, done: false },
        { id: "t3", text: "Fait", due: null, priority: null, done: true },
      ],
      events: [
        { id: "e1", date: "2026-10-27", day: null, time: "16:00", title: "Call marque", type: "call" },
        { id: "e2", date: "2026-11-06", day: null, time: null, title: "Tournage", type: "tournage" },
        { id: "e3", date: "2026-12-30", day: null, time: null, title: "Trop loin", type: null },
      ],
      briefs: [{ id: "b1", brand: "Nakd", deliverables: "1 Reel", due: "2026-11-15", status: "en cours", consignes: "ok" }],
    });
    expect(items.map((i) => [i.id, i.section])).toEqual([
      ["todo:t2", "today"],
      ["todo:t1", "tomorrow"],
      ["event:e1", "week"],
      ["event:e2", "later"],
      ["brief-later:b1", "later"],
    ]);
    const sections = creatorTodaySections(items, NOW);
    expect(sections.map((s) => [s.id, s.from ?? null, s.to ?? null])).toEqual([
      ["today", null, null],
      ["tomorrow", "2026-10-23", null],
      ["week", "2026-10-24", "2026-10-29"],
      ["later", "2026-10-30", "2026-11-21"],
    ]);
    expect(items.map(creatorVerb)).toEqual(["Terminer", "Terminer", "Préparer", "Préparer", "Ouvrir"]);
  });

  it("cache ce qui est reporté ou fait aujourd'hui", () => {
    const todos = [
      { id: "t1", text: "A", due: null, priority: null, done: false },
      { id: "t2", text: "B", due: null, priority: null, done: false },
      { id: "t3", text: "C", due: null, priority: null, done: false },
    ];
    const items = creatorTodayItems({
      ...base,
      todos,
      snoozed: snooze({}, "todo:t1", "2026-10-23", "2026-10-22"),
      handled: markHandled({}, "todo:t2", "B", "2026-10-22"),
    });
    expect(items.map((i) => i.id)).toEqual(["todo:t3"]);
  });
});
