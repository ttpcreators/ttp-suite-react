import { describe, expect, it } from "vitest";
import { DEDUPE_MS, IOS_GAP_MS, PATTERNS, createHaptics, haptic, type HapticEnv } from "./haptics";

function env(over: Partial<HapticEnv> = {}) {
  const log: unknown[] = [];
  let t = 1000;
  const later: [() => void, number][] = [];
  const e: HapticEnv = {
    touch: true,
    ios: false,
    vibrate: (p) => log.push(p),
    tick: () => log.push("tic"),
    enabled: () => true,
    now: () => t,
    later: (fn, ms) => later.push([fn, ms]),
    ...over,
  };
  return { e, log, later, avance: (ms: number) => (t += ms) };
}

describe("haptics", () => {
  it("Android : motif selon l'action", () => {
    const { e, log, avance } = env();
    const h = createHaptics(e);
    h("succes");
    avance(500);
    h("retrait");
    avance(500);
    h("erreur");
    expect(log).toEqual([PATTERNS.succes, PATTERNS.retrait, PATTERNS.erreur]);
    expect(PATTERNS.erreur).toEqual([14, 70, 14]);
  });

  it("iPhone : un tic, et un double tic pour une erreur", () => {
    const { e, log, later, avance } = env({ ios: true, vibrate: undefined });
    const h = createHaptics(e);
    expect(h("succes")).toBe(true);
    expect(log).toEqual(["tic"]);
    avance(500);
    h("erreur");
    expect(log).toEqual(["tic", "tic"]);
    expect(later).toHaveLength(1);
    expect(later[0][1]).toBe(IOS_GAP_MS);
    later[0][0]();
    expect(log).toEqual(["tic", "tic", "tic"]);
  });

  it("deux actions collées : un seul tic", () => {
    const { e, log, avance } = env();
    const h = createHaptics(e);
    h("succes");
    avance(DEDUPE_MS - 1);
    expect(h("succes")).toBe(false);
    avance(2);
    expect(h("succes")).toBe(true);
    expect(log).toHaveLength(2);
  });

  it("rien à la souris, ni quand c'est coupé", () => {
    const a = env({ touch: false });
    createHaptics(a.e)("succes");
    expect(a.log).toEqual([]);
    const b = env({ enabled: () => false });
    createHaptics(b.e)("erreur");
    expect(b.log).toEqual([]);
  });

  it("une panne du téléphone ne casse pas l'action", () => {
    const { e } = env({ vibrate: () => { throw new Error("x"); } });
    expect(createHaptics(e)("succes")).toBe(false);
  });

  it("hors navigateur : sans effet", () => {
    expect(() => haptic("succes")).not.toThrow();
  });
});
