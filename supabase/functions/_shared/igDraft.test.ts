import { describe, expect, it } from "vitest";
import { collaborateurs, parisVersUtc, preparerBrouillonPost } from "./igDraft.ts";

const NOW = Date.parse("2026-11-15T12:00:00Z");

describe("brouillon de post Instagram (Alfred)", () => {
  it("convertit l'heure de Paris, hiver comme été", () => {
    expect(parisVersUtc("2026-11-20", "18:30")).toBe("2026-11-20T17:30:00.000Z");
    expect(parisVersUtc("2026-07-01", "9h05")).toBe("2026-07-01T07:05:00.000Z");
    expect(parisVersUtc("2026-02-31", "10:00")).toBeNull();
    expect(parisVersUtc("2026-03-29", "02:30")).toBeNull(); // heure sautée au passage à l'heure d'été
    expect(parisVersUtc("20/11/2026", "10:00")).toBeNull();
  });

  it("nettoie les comptes en collaboration", () => {
    expect(collaborateurs("@Lea.fit, @nova_box @lea.fit, paul, ines")).toEqual(["lea.fit", "nova_box", "paul"]);
    expect(collaborateurs(["@lea fit"])).toBeNull();
    expect(collaborateurs("léa")).toBeNull();
    expect(collaborateurs("")).toEqual([]);
  });

  it("prépare toujours un brouillon, jamais un post programmé", () => {
    const r = preparerBrouillonPost({ type: "reel", legende: "Léa teste Nova — et elle adore", date: "2026-11-20", heure: "18:30", collaborateurs: "@nova", createur: "Léa", marque: "Nova" }, NOW);
    expect(r).toEqual({
      row: {
        kind: "reel",
        caption: "Léa teste Nova, et elle adore",
        collaborators: ["nova"],
        ref: { creator: "Léa", brand: "Nova" },
        scheduled_at: "2026-11-20T17:30:00.000Z",
        status: "brouillon",
      },
    });
  });

  it("refuse ce qui ne peut pas partir tel quel", () => {
    expect(preparerBrouillonPost({ legende: "" }, NOW)).toHaveProperty("error");
    expect(preparerBrouillonPost({ type: "live", legende: "x" }, NOW)).toHaveProperty("error");
    expect(preparerBrouillonPost({ legende: "x".repeat(2201) }, NOW)).toHaveProperty("error");
    expect(preparerBrouillonPost({ legende: "ok", date: "2026-11-14" }, NOW)).toHaveProperty("error");
    expect(preparerBrouillonPost({ legende: "ok", collaborateurs: "a,b,c,d" }, NOW)).toEqual(expect.objectContaining({ row: expect.objectContaining({ collaborators: ["a", "b", "c"] }) }));
  });

  it("une story n'a ni légende obligatoire ni collaborateurs, et sans date reste sans date", () => {
    const r = preparerBrouillonPost({ type: "story", collaborateurs: "@nova" }, NOW);
    expect(r).toEqual({ row: { kind: "story", caption: "", collaborators: [], ref: null, scheduled_at: null, status: "brouillon" } });
  });
});
