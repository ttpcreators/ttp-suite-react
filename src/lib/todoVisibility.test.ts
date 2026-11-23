import { describe, expect, it } from "vitest";
import { evenementInterne, visibiliteColumnMissing, visiblePourCreateur } from "./todoVisibility";

describe("visiblePourCreateur", () => {
  it("cache une tâche de l'agence tant qu'elle n'est pas cochée visible", () => {
    expect(visiblePourCreateur({ source: "agency" })).toBe(false);
    expect(visiblePourCreateur({ source: "agency", visible_createur: false })).toBe(false);
    expect(visiblePourCreateur({ source: "agency", visible_createur: null })).toBe(false);
  });

  it("montre une tâche de l'agence cochée visible", () => {
    expect(visiblePourCreateur({ source: "agency", visible_createur: true })).toBe(true);
  });

  it("montre toujours les tâches du créateur", () => {
    expect(visiblePourCreateur({ source: "creator" })).toBe(true);
    expect(visiblePourCreateur({ source: null })).toBe(true);
    expect(visiblePourCreateur({})).toBe(true);
  });
});

describe("evenementInterne", () => {
  it("repère les rendez-vous recopiés d'une tâche", () => {
    expect(evenementInterne({ title: "Tâche : relancer la marque" })).toBe(true);
    expect(evenementInterne({ title: "  tache: relancer" })).toBe(true);
    expect(evenementInterne({ title: "Tâche : relancer" })).toBe(true);
  });

  it("respecte la case interne", () => {
    expect(evenementInterne({ title: "Call marque", interne: true })).toBe(true);
    expect(evenementInterne({ title: "Tournage chez la marque", interne: false })).toBe(false);
    expect(evenementInterne({ title: "Call avec l'agence" })).toBe(false);
  });
});

describe("visibiliteColumnMissing", () => {
  it("reconnaît la colonne absente", () => {
    expect(visibiliteColumnMissing({ code: "42703", message: "column todos.visible_createur does not exist" })).toBe(true);
    expect(visibiliteColumnMissing({ code: "42703", message: "column events.interne does not exist" })).toBe(true);
  });

  it("ne confond pas avec une autre erreur", () => {
    expect(visibiliteColumnMissing({ code: "42501", message: "permission denied" })).toBe(false);
    expect(visibiliteColumnMissing({ code: "42703", message: "column todos.progress does not exist" })).toBe(false);
    expect(visibiliteColumnMissing(null)).toBe(false);
  });
});
