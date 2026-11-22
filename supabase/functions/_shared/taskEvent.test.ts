import { describe, it, expect } from "vitest";
import { taskEventTitles } from "./taskEvent.ts";

describe("évènement d'agenda d'une tâche", () => {
  it("titre exact « Tâche : <texte> », avec ou sans espace insécable", () => {
    expect(taskEventTitles("  Relancer Nike  ")).toEqual(["Tâche : Relancer Nike", "Tâche : Relancer Nike", "Tâche : Relancer Nike"]);
  });
  it("tâche sans texte : aucun titre (on ne retire rien)", () => {
    expect(taskEventTitles("")).toEqual([]);
    expect(taskEventTitles(null)).toEqual([]);
  });
});
