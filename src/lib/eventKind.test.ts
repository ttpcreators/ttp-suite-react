import { describe, expect, it } from "vitest";
import { guessEventKind } from "./eventKind";

describe("guessEventKind", () => {
  it("devine le type d'après le titre", () => {
    expect(guessEventKind("Poster pour Nakd")).toBe("deadline");
    expect(guessEventKind("Event Intersport × Under Armour")).toBe("event");
    expect(guessEventKind("Tournage Gymshark")).toBe("shoot");
    expect(guessEventKind("Call brief Alo Yoga")).toBe("call");
    expect(guessEventKind("Ivana")).toBe("call");
  });
});

describe("mots accentués en début de titre (audit 2026-11-11)", () => {
  it("« Événement » est bien un évènement, pas un appel", () => {
    expect(guessEventKind("Événement Nike")).toBe("event");
    expect(guessEventKind("événement presse")).toBe("event");
    expect(guessEventKind("Soirée Adidas")).toBe("event");
  });
});
