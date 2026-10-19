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

import { getAppState, invalidateAppState, refreshAppState, saveAppStateKey, mergeAppStateKey, listAppStateKey, isMissingFunction } from "./appState";

const row = (o: unknown) => ({ data: [{ id: "1", a: JSON.stringify(o) }], error: null });
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  invalidateAppState();
  h.state.loads.length = 0;
  h.state.rpcResult = { error: null };
  h.state.updates = 0;
  h.supabase.from.mockClear();
  h.supabase.rpc.mockClear();
});

// Charge le cache avec un blob donné (lecture résolue à la main).
async function primeCache(o: unknown) {
  const p = getAppState();
  h.state.loads.shift()!(row(o));
  await p;
}

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

  it("mergeAppStateKey : n'envoie que les entrées touchées et met le cache à jour", async () => {
    await primeCache({ notes: { a: "1", b: "2", c: "3" }, other: 1 });
    expect(await mergeAppStateKey("notes", { b: "B", d: "4" }, ["c"])).toBe(true);
    expect(h.supabase.rpc).toHaveBeenCalledWith("app_state_merge", { p_key: "notes", p_set: { b: "B", d: "4" }, p_remove: ["c"] });
    expect(await getAppState()).toEqual({ notes: { a: "1", b: "B", d: "4" }, other: 1 });
  });

  it("mergeAppStateKey : échec franc (pas de repli) si l'erreur n'est pas une fonction absente", async () => {
    h.state.rpcResult = { error: { code: "42501", message: "permission denied" } };
    expect(await mergeAppStateKey("notes", { a: "1" })).toBe(false);
    expect(h.supabase.from).not.toHaveBeenCalled();
  });

  it("mergeAppStateKey : repli = relecture fraîche + réécriture de la clé fusionnée", async () => {
    // Fonction absente pour app_state_merge ET app_state_set → chemin legacy complet.
    h.state.rpcResult = { error: { code: "42883", message: "function app_state_merge does not exist" } };
    const p = mergeAppStateKey("notes", { b: "B" }, ["a"]);
    await flush();
    h.state.loads.shift()!(row({ notes: { a: "1", c: "3" }, other: 1 })); // relecture fraîche
    await flush();
    h.state.loads.shift()!(row({ notes: { a: "1", c: "3" }, other: 1 })); // read-before-save legacy
    expect(await p).toBe(true);
    expect(h.supabase.rpc).toHaveBeenCalledWith("app_state_set", { p_key: "notes", p_value: { c: "3", b: "B" } });
    expect(h.state.updates).toBe(1);
    expect(await getAppState()).toEqual({ notes: { c: "3", b: "B" }, other: 1 });
  });

  it("listAppStateKey : remplace sur place, retire par id, ajoute en tête si prepend", async () => {
    await primeCache({ hist: [{ id: "a", v: 1 }, { id: "b", v: 2 }, { id: "c", v: 3 }] });
    expect(await listAppStateKey("hist", [{ id: "b", v: 20 } as { id: string }, { id: "n", v: 9 } as { id: string }], ["c"], true)).toBe(true);
    expect(h.supabase.rpc).toHaveBeenCalledWith("app_state_list", {
      p_key: "hist",
      p_upsert: [{ id: "b", v: 20 }, { id: "n", v: 9 }],
      p_remove: ["c"],
      p_prepend: true,
    });
    expect((await getAppState()).hist).toEqual([{ id: "n", v: 9 }, { id: "a", v: 1 }, { id: "b", v: 20 }]);
  });

  it("listAppStateKey : ajout en fin par défaut ; clé absente = liste vide", async () => {
    await primeCache({ other: 1 });
    expect(await listAppStateKey("hist", [{ id: "x" }])).toBe(true);
    expect(await listAppStateKey("hist", [{ id: "y" }])).toBe(true);
    expect((await getAppState()).hist).toEqual([{ id: "x" }, { id: "y" }]);
  });

  it("listAppStateKey : repli = relecture fraîche + réécriture de la liste modifiée", async () => {
    h.state.rpcResult = { error: { code: "PGRST202", message: "Could not find the function app_state_list" } };
    const p = listAppStateKey("hist", [{ id: "n" }], ["a"], true);
    await flush();
    h.state.loads.shift()!(row({ hist: [{ id: "a" }, { id: "b" }] }));
    await flush();
    h.state.loads.shift()!(row({ hist: [{ id: "a" }, { id: "b" }] }));
    expect(await p).toBe(true);
    expect(h.supabase.rpc).toHaveBeenCalledWith("app_state_set", { p_key: "hist", p_value: [{ id: "n" }, { id: "b" }] });
  });

  it("isMissingFunction", () => {
    expect(isMissingFunction({ code: "42883" })).toBe(true);
    expect(isMissingFunction({ code: "PGRST202", message: "" })).toBe(true);
    expect(isMissingFunction({ message: "function public.app_state_set(text, jsonb) does not exist" })).toBe(true);
    expect(isMissingFunction({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
  });
});
