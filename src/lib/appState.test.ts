import { describe, it, expect, vi, beforeEach } from "vitest";

// Faux client Supabase : lecture du blob contrôlée à la main (pour simuler les courses).
const h = vi.hoisted(() => {
  const state = {
    loads: [] as Array<(v: { data: unknown; error: unknown }) => void>,
    rpcResult: { error: null as null | { code?: string; message: string } },
    updates: 0,
  };
  const loadBuilder = () => {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.order = () => b;
    b.limit = () => new Promise((res) => state.loads.push(res));
    b.update = () => {
      state.updates++;
      return { eq: () => Promise.resolve({ error: null }) };
    };
    b.insert = () => Promise.resolve({ error: null });
    return b;
  };
  const supabase = {
    from: vi.fn(() => loadBuilder()),
    rpc: vi.fn(() => Promise.resolve(state.rpcResult)),
  };
  return { state, supabase };
});

vi.mock("./supabase", () => ({ supabase: h.supabase }));
vi.mock("./useLive", () => ({ useLive: () => {} }));

import { getAppState, invalidateAppState, refreshAppState, saveAppStateKey, isMissingFunction } from "./appState";

const row = (o: unknown) => ({ data: [{ id: "1", a: JSON.stringify(o) }], error: null });
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  invalidateAppState();
  h.state.loads.length = 0;
  h.state.rpcResult = { error: null };
  h.state.updates = 0;
  h.supabase.from.mockClear();
});

describe("appState", () => {
  it("un refresh lancé avant une écriture n'écrase pas le cache avec un snapshot périmé", async () => {
    const p0 = getAppState();
    h.state.loads.shift()!(row({ a: 1, k: "old" }));
    await p0;

    const pr = refreshAppState();
    // Pendant le refresh, le cache n'est plus vidé.
    expect(await getAppState()).toEqual({ a: 1, k: "old" });
    expect(await saveAppStateKey("k", "new")).toBe(true);
    h.state.loads.shift()!(row({ a: 1, k: "old" })); // snapshot pré-écriture
    await pr;
    expect(await getAppState()).toEqual({ a: 1, k: "new" });
  });

  it("une écriture sur cache vide ne crée pas de cache partiel", async () => {
    expect(await saveAppStateKey("k", "v")).toBe(true);
    const p = getAppState(); // doit relire le blob complet
    await flush();
    expect(h.state.loads.length).toBe(1);
    h.state.loads.shift()!(row({ a: 1, k: "v" }));
    expect(await p).toEqual({ a: 1, k: "v" });
  });

  it("fallback legacy UNIQUEMENT si la fonction SQL manque", async () => {
    h.state.rpcResult = { error: { code: "42501", message: "permission denied" } };
    expect(await saveAppStateKey("k", "v")).toBe(false);
    expect(h.supabase.from).not.toHaveBeenCalled();

    h.state.rpcResult = { error: { code: "42883", message: "function app_state_set does not exist" } };
    const p = saveAppStateKey("k", "v");
    await flush();
    h.state.loads.shift()!(row({ a: 1 }));
    expect(await p).toBe(true);
    expect(h.state.updates).toBe(1);
  });

  it("isMissingFunction", () => {
    expect(isMissingFunction({ code: "42883" })).toBe(true);
    expect(isMissingFunction({ code: "PGRST202", message: "" })).toBe(true);
    expect(isMissingFunction({ message: "function public.app_state_set(text, jsonb) does not exist" })).toBe(true);
    expect(isMissingFunction({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
  });
});
