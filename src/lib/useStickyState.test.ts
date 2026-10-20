import { beforeEach, describe, expect, it } from "vitest";
import { readSticky } from "./useStickyState";

/** localStorage minimal (les tests tournent sous Node). */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

describe("readSticky", () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = memoryStorage();
  });
  it("rend la valeur par défaut sans rien de gardé", () => {
    expect(readSticky("t", ["a", "b"] as const, "a")).toBe("a");
  });
  it("rend la valeur gardée si elle est permise", () => {
    localStorage.setItem("ttp:ui:t", JSON.stringify("b"));
    expect(readSticky("t", ["a", "b"] as const, "a")).toBe("b");
  });
  it("ignore une valeur qui n'existe plus", () => {
    localStorage.setItem("ttp:ui:t", JSON.stringify("z"));
    expect(readSticky("t", ["a", "b"] as const, "a")).toBe("a");
  });
  it("ignore une valeur illisible", () => {
    localStorage.setItem("ttp:ui:t", "{oups");
    expect(readSticky("t", [1, 3] as const, 3)).toBe(3);
  });
});
