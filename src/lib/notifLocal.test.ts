import { describe, expect, it } from "vitest";
import { actorInitials, toggleIds } from "./notifLocal";

describe("notifLocal", () => {
  it("ajoute et retire des ids", () => {
    const a = toggleIds(new Set(["x"]), ["y", "z"], true);
    expect([...a]).toEqual(["x", "y", "z"]);
    expect([...toggleIds(a, ["x"], false)]).toEqual(["y", "z"]);
  });
  it("borne la liste en gardant les plus récents", () => {
    const big = new Set(Array.from({ length: 400 }, (_, i) => `id${i}`));
    const out = toggleIds(big, ["nouveau"], true);
    expect(out.size).toBe(400);
    expect(out.has("nouveau")).toBe(true);
    expect(out.has("id0")).toBe(false);
  });
  it("trouve l'initiale de la personne", () => {
    expect(actorInitials("Gianni a terminé la tâche")).toBe("G");
    expect(actorInitials("")).toBe("");
  });
});
