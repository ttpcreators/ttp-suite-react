import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Le client Supabase plante sous Node : la remontée d'erreur est remplacée.
vi.mock("@/lib/errorReport", () => ({ reportError: () => {} }));
vi.mock("@/components/ui/loader", () => ({ Loader: () => null }));

import { isChunkError, recoverStaleApp } from "./ErrorBoundary";

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("recoverStaleApp", () => {
  const reload = vi.fn();
  const cacheKeys = vi.fn(async () => ["ttp-shell-v2"]);
  beforeEach(() => {
    reload.mockClear();
    cacheKeys.mockClear();
    vi.stubGlobal("sessionStorage", memoryStorage());
    vi.stubGlobal("location", { reload });
    vi.stubGlobal("caches", { keys: cacheKeys, delete: vi.fn(async () => true) });
    vi.stubGlobal("window", { caches: {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("en ligne : recharge (mise en ligne passée pendant que l'app était ouverte)", () => {
    vi.stubGlobal("navigator", { onLine: true });
    expect(recoverStaleApp()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("hors ligne : ne recharge pas et ne vide pas les fichiers gardés", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(recoverStaleApp()).toBe(false);
    expect(recoverStaleApp()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(cacheKeys).not.toHaveBeenCalled();
  });

  it("s'arrête après deux essais dans la minute", () => {
    vi.stubGlobal("navigator", { onLine: true });
    expect(recoverStaleApp()).toBe(true);
    expect(recoverStaleApp()).toBe(true);
    expect(recoverStaleApp()).toBe(false);
  });
});

describe("isChunkError", () => {
  it("reconnaît un fichier de page introuvable", () => {
    expect(isChunkError(new TypeError("Failed to fetch dynamically imported module: /assets/Todo-abc.js"))).toBe(true);
    expect(isChunkError(new TypeError("Importing a module script failed."))).toBe(true);
  });
  it("laisse passer les vrais bugs", () => {
    expect(isChunkError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
  });
});
