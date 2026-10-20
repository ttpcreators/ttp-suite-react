import { describe, expect, it } from "vitest";
import { AGENT_FIGURINES, assignFigurines } from "./agentAvatars";

describe("figurines des agents", () => {
  it("donne une figurine différente à chaque agent, dans l'ordre", () => {
    expect(assignFigurines([{ id: "megan" }, { id: "tm" }], {})).toEqual({ megan: "circuit", tm: "neon" });
  });
  it("respecte un choix enregistré et ne le redonne pas à un autre", () => {
    expect(assignFigurines([{ id: "megan" }, { id: "tm" }], { tm: "circuit" })).toEqual({ megan: "neon", tm: "circuit" });
  });
  it("ignore un choix inconnu", () => {
    expect(assignFigurines([{ id: "a" }], { a: "dragon" })).toEqual({ a: "circuit" });
  });
  it("recommence la série au-delà de sept agents", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `a${i}` }));
    const out = assignFigurines(many, {});
    expect(new Set(Object.values(out).slice(0, 7)).size).toBe(AGENT_FIGURINES.length);
    expect(out.a7).toBe("circuit");
  });
});
