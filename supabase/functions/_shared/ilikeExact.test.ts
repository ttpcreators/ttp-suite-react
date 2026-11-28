import { describe, expect, it } from "vitest";
import { ilikeContient, ilikeExact, lignesExactes } from "./ilikeExact.ts";

describe("ilikeExact", () => {
  it("échappe les jokers d'ilike, garde le reste", () => {
    expect(ilikeExact("jean@marque-exemple.fr")).toBe("jean@marque-exemple.fr");
    expect(ilikeExact("jean_paul@exemple.fr")).toBe("jean\\_paul@exemple.fr");
    expect(ilikeExact("100%@exemple.fr")).toBe("100\\%@exemple.fr");
    expect(ilikeExact("a\\b@exemple.fr")).toBe("a\\\\b@exemple.fr");
    expect(ilikeExact("  Jean@Exemple.fr  ")).toBe("Jean@Exemple.fr");
  });
  it("refuse « * » (joker de PostgREST que rien n'échappe) et le vide", () => {
    expect(ilikeExact("a*@marque-exemple.fr")).toBeNull();
    expect(ilikeExact("*@*.com")).toBeNull();
    expect(ilikeExact("jean@*.fr")).toBeNull();
    expect(ilikeExact("")).toBeNull();
    expect(ilikeExact("   ")).toBeNull();
  });
  it("ilikeContient : %valeur%, mêmes refus", () => {
    expect(ilikeContient("jean@exemple.fr")).toBe("%jean@exemple.fr%");
    expect(ilikeContient("@jean_x.fr")).toBe("%@jean\\_x.fr%");
    expect(ilikeContient("*@exemple.fr")).toBeNull();
    expect(ilikeContient("")).toBeNull();
  });
});

describe("lignesExactes", () => {
  const lignes = [
    { id: "1", email: "Jean@Marque-Exemple.fr" },
    { id: "2", email: " jean@marque-exemple.fr " },
    { id: "3", email: "ajean@marque-exemple.fr" },
    { id: "4", email: null },
    { id: "5" },
  ];
  it("garde seulement la valeur exacte, casse et espaces ignorés", () => {
    expect(lignesExactes(lignes, "email", "jean@marque-exemple.fr").map((l) => l.id)).toEqual(["1", "2"]);
    expect(lignesExactes(lignes, "email", "JEAN@MARQUE-EXEMPLE.FR ").map((l) => l.id)).toEqual(["1", "2"]);
  });
  it("valeur vide ou lignes absentes : rien", () => {
    expect(lignesExactes(lignes, "email", "")).toEqual([]);
    expect(lignesExactes(null, "email", "jean@marque-exemple.fr")).toEqual([]);
    expect(lignesExactes(undefined, "email", "jean@marque-exemple.fr")).toEqual([]);
  });
  it("une autre colonne n'est jamais comparée", () => {
    expect(lignesExactes([{ id: "1", domaine: "marque-exemple.fr", email: null }], "email", "marque-exemple.fr")).toEqual([]);
    expect(lignesExactes([{ id: "1", domaine: "Marque-Exemple.fr", email: null }], "domaine", "marque-exemple.fr").map((l) => l.id)).toEqual(["1"]);
  });
});
