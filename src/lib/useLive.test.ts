import { describe, expect, it } from "vitest";
import { IDLE_MS, pollAllowed } from "./useLive";

describe("pollAllowed", () => {
  const now = 1_000_000_000;
  it("rafraîchit quand on se sert de l'app", () => {
    expect(pollAllowed({ visible: true, focused: true, lastActivity: now - 10_000, now })).toBe(true);
  });
  it("s'arrête au repos, fenêtre derrière une autre ou onglet caché", () => {
    expect(pollAllowed({ visible: true, focused: true, lastActivity: now - IDLE_MS, now })).toBe(false);
    expect(pollAllowed({ visible: true, focused: false, lastActivity: now, now })).toBe(false);
    expect(pollAllowed({ visible: false, focused: true, lastActivity: now, now })).toBe(false);
  });
});
