import { describe, expect, it } from "vitest";
import { cleanHandle, collabCaption, countHashtags, countMentions, cropBox, nextSlot, planProblems, signatureCaption, targetRatio, type PlanMedia } from "./igPlanner";

const img = (w = 1080, h = 1350): PlanMedia => ({ url: "u", path: "p", type: "image", w, h });
const vid = (dur = 20): PlanMedia => ({ url: "u", path: "p", type: "video", dur });

describe("planProblems", () => {
  it("accepte un post photo au bon format", () => {
    expect(planProblems({ kind: "post", caption: "Hello", media: [img()], collaborators: [] })).toEqual([]);
  });
  it("refuse un post sans photo ou avec une vidéo", () => {
    expect(planProblems({ kind: "post", caption: "", media: [], collaborators: [] })[0]).toMatch(/Ajoute/);
    expect(planProblems({ kind: "post", caption: "", media: [vid()], collaborators: [] })[0]).toMatch(/Reel/);
  });
  it("carrousel : 2 à 10 éléments", () => {
    expect(planProblems({ kind: "carrousel", caption: "", media: [img()], collaborators: [] })[0]).toMatch(/2 à 10/);
    expect(planProblems({ kind: "carrousel", caption: "", media: [img(), vid()], collaborators: [] })).toEqual([]);
  });
  it("reel : une vidéo de 3 s à 15 min", () => {
    expect(planProblems({ kind: "reel", caption: "", media: [img()], collaborators: [] })[0]).toMatch(/une seule vidéo/);
    expect(planProblems({ kind: "reel", caption: "", media: [vid(1)], collaborators: [] })[0]).toMatch(/3 secondes/);
  });
  it("photo trop allongée refusée", () => {
    expect(planProblems({ kind: "post", caption: "", media: [img(1080, 1920)], collaborators: [] })[0]).toMatch(/4:5/);
  });
  it("limites de légende et de collaborateurs", () => {
    const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ");
    expect(planProblems({ kind: "post", caption: tags, media: [img()], collaborators: [] })[0]).toMatch(/hashtags/);
    expect(planProblems({ kind: "post", caption: "", media: [img()], collaborators: ["a", "b", "c", "d"] })[0]).toMatch(/3 collaborateurs/);
    expect(planProblems({ kind: "post", caption: "", media: [img()], collaborators: ["pas valide !"] })[0]).toMatch(/pas valide/);
  });
});

describe("formats", () => {
  it("ramène une photo trop haute à 4:5 et garde une photo carrée", () => {
    expect(targetRatio("post", 1080, 1920)).toBe(0.8);
    expect(targetRatio("post", 1080, 1080)).toBeNull();
    expect(targetRatio("story", 1080, 1920)).toBeNull();
    expect(targetRatio("carrousel", 1080, 1080, 0.8)).toBe(0.8);
  });
  it("recadre au centre", () => {
    expect(cropBox(1080, 1920, 0.8)).toEqual({ sx: 0, sy: 285, sw: 1080, sh: 1350 });
    expect(cropBox(2000, 1000, 1)).toEqual({ sx: 500, sy: 0, sw: 1000, sh: 1000 });
  });
});

describe("légendes et @", () => {
  it("compte hashtags et @ sans prendre les emails", () => {
    expect(countHashtags("#a #b_c #été")).toBe(3);
    expect(countMentions("@lea x @marque.fr, écris à pr@marque.fr")).toBe(2);
  });
  it("nettoie un @", () => {
    expect(cleanHandle("@Lea.Fit")).toBe("lea.fit");
    expect(cleanHandle("https://www.instagram.com/lea.fit/")).toBe("lea.fit");
    expect(cleanHandle("pas valide")).toBe("");
  });
  it("modèles", () => {
    expect(signatureCaption("Léa Martin", "lea.fit")).toContain("@lea.fit");
    expect(signatureCaption("Léa Martin", "lea.fit")).toContain("Léa ✨");
    const c = collabCaption("Léa Martin", "lea.fit", "Gymshark", "gymshark");
    expect(c).toContain("@lea.fit × @gymshark");
    expect(c).toContain("Merci à Gymshark");
  });
  it("créneau conseillé à 18 h", () => {
    const morning = new Date(2026, 9, 14, 10, 0);
    const evening = new Date(2026, 9, 14, 20, 0);
    expect(new Date(nextSlot(morning)).getDate()).toBe(14);
    expect(new Date(nextSlot(evening)).getDate()).toBe(15);
    expect(new Date(nextSlot(evening)).getHours()).toBe(18);
  });
});
