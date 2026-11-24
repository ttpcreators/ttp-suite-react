import { describe, expect, it } from "vitest";
import {
  OV_TRUST_MS, SETTLE_MS, adjustUnread, applyOverride, overrideAgrees, pruneOverrides, revertAdj, rowKey, settleAdjs, trashConfirmText, unreadDelta,
  type OvRow, type Override, type UnreadAdj,
} from "./mailOptimistic";

// Fils fictifs (aucune donnée réelle).
const row = (over: Partial<OvRow> = {}): OvRow => ({
  threadId: "abc123", box: "partnerships", unread: true, ts: 1_000, direction: "in", count: 1, snippet: "Bonjour", ...over,
});
const K = rowKey(row());

describe("affichage tout de suite (changements en attente)", () => {
  it("lu / non lu s'affiche avant la réponse de Gmail", () => {
    expect(applyOverride(row(), { unread: false, at: 1 })?.unread).toBe(false);
    expect(applyOverride(row({ unread: false }), { unread: true, at: 1 })?.unread).toBe(true);
    const same = row({ unread: false });
    expect(applyOverride(same, { unread: false, at: 1 })).toBe(same);
    expect(applyOverride(same, undefined)).toBe(same);
  });
  it("archivé ou supprimé : le fil disparaît de la liste", () => {
    expect(applyOverride(row(), { hidden: "trash", at: 1 })).toBeNull();
    expect(applyOverride(row(), { hidden: "archive", at: 1 })).toBeNull();
  });
  it("réponse envoyée : « Répondu » et lu, sauf si un message plus récent est arrivé", () => {
    const r = applyOverride(row({ ts: 1_000 }), { reply: { ts: 2_000, snippet: "Merci" }, at: 1 });
    expect(r).toMatchObject({ direction: "out", unread: false, snippet: "Merci", ts: 2_000, count: 2 });
    expect(applyOverride(row({ ts: 3_000 }), { reply: { ts: 2_000, snippet: "Merci" }, at: 1 })?.direction).toBe("in");
  });
});

describe("liste fraîche du serveur", () => {
  const confirmed = (o: Omit<Override, "at" | "done">, done = 10_000): Override => ({ ...o, at: done - 500, done });

  it("garde un changement pas encore confirmé, même si la liste dit l'inverse", () => {
    const m = new Map([[K, { unread: false, at: 5_000 } as Override]]);
    const fresh = new Map([[K, row({ unread: true })]]);
    expect(pruneOverrides(m, fresh, "inbox", 999_999)).toBe(m);
  });
  it("garde un changement confirmé si la liste est partie trop tôt (ancien état de Gmail)", () => {
    const m = new Map([[K, confirmed({ unread: false })]]);
    const fresh = new Map([[K, row({ unread: true })]]);
    expect(pruneOverrides(m, fresh, "inbox", 10_000 + SETTLE_MS - 1).has(K)).toBe(true);
    // Partie assez tard mais Gmail dit encore « non lu » : on garde (moins de 90 s).
    expect(pruneOverrides(m, fresh, "inbox", 10_000 + SETTLE_MS + 1).has(K)).toBe(true);
    // Au-delà de 90 s, le serveur fait foi.
    expect(pruneOverrides(m, fresh, "inbox", 10_000 + OV_TRUST_MS + 1).has(K)).toBe(false);
  });
  it("oublie le changement quand la liste le montre", () => {
    const m = new Map([[K, confirmed({ unread: false })]]);
    expect(pruneOverrides(m, new Map([[K, row({ unread: false })]]), "inbox", 20_000).has(K)).toBe(false);
    const t = new Map([[K, confirmed({ hidden: "trash" })]]);
    expect(pruneOverrides(t, new Map(), "inbox", 20_000).has(K)).toBe(false);
    expect(pruneOverrides(t, new Map([[K, row()]]), "inbox", 20_000).has(K)).toBe(true);
  });
  it("un fil absent de la liste des envoyés n'est pas jugé par elle", () => {
    const m = new Map([[K, confirmed({ hidden: "trash" })]]);
    expect(pruneOverrides(m, new Map(), "sent", 20_000)).toBe(m);
  });
  it("archivé : d'accord si le fil est absent ou marqué archivé", () => {
    const o: Override = { hidden: "archive", at: 1, done: 2 };
    expect(overrideAgrees(o, undefined, "inbox")).toBe(true);
    expect(overrideAgrees(o, row({ archived: true }), "inbox")).toBe(true);
    expect(overrideAgrees(o, row({ archived: false }), "inbox")).toBe(false);
  });
});

describe("compte des non lus", () => {
  it("écart d'un clic selon l'état affiché avant", () => {
    expect(unreadDelta({ unread: true }, { unread: false })).toBe(-1);
    expect(unreadDelta({ unread: false }, { unread: false })).toBe(0);
    expect(unreadDelta({ unread: false }, { unread: true })).toBe(1);
    expect(unreadDelta({ unread: true }, { unread: true })).toBe(0);
    expect(unreadDelta({ unread: true }, { hidden: "trash" })).toBe(-1);
    expect(unreadDelta({ unread: false }, { hidden: "archive" })).toBe(0);
    // Fil inconnu ou déjà hors boîte de réception : le serveur ne le compte pas.
    expect(unreadDelta(null, { unread: false })).toBe(0);
    expect(unreadDelta({ unread: true, archived: true }, { hidden: "trash" })).toBe(0);
  });
  it("corrige le compte du serveur, jamais en dessous de zéro, sans inventer de boîte", () => {
    const adjs: UnreadAdj[] = [{ box: "partnerships", delta: -1 }, { box: "partnerships", delta: -1 }, { box: "talent", delta: -1 }];
    expect(adjustUnread({ partnerships: 5, talent: 0 }, adjs)).toEqual({ partnerships: 3, talent: 0 });
    expect(adjustUnread({ partnerships: 1 }, adjs)).toEqual({ partnerships: 0 });
    expect(adjustUnread({}, adjs)).toEqual({});
  });
  it("oublie un écart quand un coup d'œil parti après la confirmation le compte", () => {
    const m = new Map<string, UnreadAdj>([
      ["a", { box: "partnerships", delta: -1, done: 10_000 }],
      ["b", { box: "partnerships", delta: -1 }], // pas encore confirmé
    ]);
    expect(settleAdjs(m, 10_000 + SETTLE_MS - 1)).toBe(m);
    const n = settleAdjs(m, 10_000 + SETTLE_MS);
    expect([...n.keys()]).toEqual(["b"]);
  });
  it("« Annuler » : retire l'écart en attente, ou en ajoute un inverse s'il était déjà compté", () => {
    const orig: UnreadAdj = { box: "talent", delta: -1, done: 1 };
    const pending = new Map([["x", orig]]);
    expect(revertAdj(pending, "x", "y", orig, 50).size).toBe(0);
    const counted = revertAdj(new Map(), "x", "y", orig, 50);
    expect(counted.get("y")).toEqual({ box: "talent", delta: 1, done: 50 });
    expect(revertAdj(new Map(), "x", "y", null, 50).size).toBe(0);
  });
});

describe("confirmation de suppression", () => {
  it("dit la boîte du fil et la corbeille de 30 jours", () => {
    expect(trashConfirmText("partnerships")).toEqual({
      title: "Supprimer ce mail ?",
      message: "Il part dans la corbeille de Gmail (boîte partnerships@) et sera effacé définitivement par Gmail au bout de 30 jours.",
    });
    expect(trashConfirmText("talent").message).toContain("(boîte talent@)");
  });
});
