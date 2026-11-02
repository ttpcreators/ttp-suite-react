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
