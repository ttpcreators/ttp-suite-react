import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ErrorBoundary", () => ({ isChunkError: () => false, recoverStaleApp: () => false }));
const { holdUpdate, shouldReloadNow } = await import("./appUpdate");

describe("mise à jour automatique de l'app", () => {
  const base = { stale: true, editing: false, dialog: false, holds: 0 };
  it("nouvelle version et rien en cours : on recharge", () => {
    expect(shouldReloadNow(base)).toBe(true);
  });
  it("pas de nouvelle version : rien", () => {
    expect(shouldReloadNow({ ...base, stale: false })).toBe(false);
  });
  it("jamais pendant une saisie, une fenêtre ouverte ou un envoi en attente", () => {
    expect(shouldReloadNow({ ...base, editing: true })).toBe(false);
    expect(shouldReloadNow({ ...base, dialog: true })).toBe(false);
    expect(shouldReloadNow({ ...base, holds: 1 })).toBe(false);
  });
  it("holdUpdate se lève", () => {
    const release = holdUpdate();
    expect(typeof release).toBe("function");
    release();
  });
});
