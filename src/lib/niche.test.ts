import { describe, expect, it } from "vitest";
import { guessNiche, SPORTS } from "./niche";

describe("guessNiche", () => {
  it("devine la niche d'un créateur depuis sa bio et ses légendes", () => {
    expect(guessNiche("Maquillage & skincare ✨ Mes routines beauté")).toBe("Beauté");
    expect(guessNiche("Maman de 2 enfants 👶 | famille, quotidien et grossesse")).toBe("Famille");
    expect(guessNiche("Recettes healthy faciles 🍳 #food #recette")).toBe("Food");
  });

  it("ne devine rien sans indice clair", () => {
    expect(guessNiche("")).toBeNull();
    expect(guessNiche("Paris 📍 contact par mail")).toBeNull();
    expect(guessNiche("mode")).toBeNull(); // une seule mention : pas assez
  });

  it("devine le sport d'un sportif", () => {
    expect(guessNiche("Footballeur pro ⚽ Attaquant", SPORTS)).toBe("Football");
    expect(guessNiche("Boxeuse 🥊 championne de France de boxe", SPORTS)).toBe("Boxe");
  });
});

describe("sportif ou créateur (Sourcing → Scouting)", () => {
  it("un seul mot de métier suffit", async () => {
    const { guessSport } = await import("./niche");
    expect(guessSport("Footballeur au PSG ⚽️")).toBe("Football");
    expect(guessSport("Joueuse WNBA · Paris")).toBe("Basket");
    expect(guessSport("Athlète · équipe de France")).toBe("Sport");
    expect(guessSport("Maman de 2 · lifestyle et recettes")).toBeNull();
    expect(guessSport("Running et fitness au quotidien")).toBeNull();
  });
});
