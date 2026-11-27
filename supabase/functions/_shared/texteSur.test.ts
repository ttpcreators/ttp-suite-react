import { describe, expect, it } from "vitest";
import { couper, str, texteSur } from "./texteSur.ts";

// Texte « bien formé » : aucune moitié d'emoji seule. encodeURIComponent refuse un texte qui en a
// une, et JSON.stringify l'écrit alors en séquence \udxxx isolée, celle que Postgres refuse.
const bienForme = (s: string) => {
  try {
    encodeURIComponent(s);
    return true;
  } catch {
    return false;
  }
};
const SEQUENCE_ISOLEE = /\\ud[89a-f][0-9a-f]{2}/i;

describe("texteSur", () => {
  it("retire le caractère nul", () => {
    expect(texteSur("a\u0000b\u0000")).toBe("ab");
    expect(texteSur("\u0000")).toBe("");
  });
  it("retire une moitié d'emoji orpheline au milieu d'un texte", () => {
    expect(texteSur("début \ud83d fin")).toBe("début  fin");
    expect(texteSur("début \ude00 fin")).toBe("début  fin");
    // Deux moitiés hautes de suite : seule celle qui a sa moitié basse reste.
    expect(texteSur("a\ud83d😀b")).toBe("a😀b");
    expect(texteSur("a😀\ude00b")).toBe("a😀b");
  });
  it("ne change rien d'autre", () => {
    const s = "Collab 💪🔥 avec @marque, code PROMO20 ✨ (é, ü, 中文)\n\tfin ";
    expect(texteSur(s)).toBe(s);
    expect(texteSur("")).toBe("");
  });
});

describe("couper", () => {
  it("emoji coupé pile au milieu : l'emoji entier part", () => {
    // « ab😀 » = a, b, puis les deux moitiés de l'emoji : slice(0, 3) garderait la moitié haute.
    expect("ab😀".slice(0, 3)).not.toBe("ab");
    expect(couper("ab😀", 3)).toBe("ab");
    expect(couper("😀abc", 1)).toBe("");
    expect(couper("😀😀😀", 5)).toBe("😀😀");
  });
  it("emoji entier gardé", () => {
    expect(couper("ab😀", 4)).toBe("ab😀");
    expect(couper("ab😀cd", 4)).toBe("ab😀");
    expect(couper("😀abc", 2)).toBe("😀");
  });
  it("texte court identique", () => {
    const s = "Une légende courte 💪";
    expect(couper(s, 300)).toBe(s);
    expect(couper(s, s.length)).toBe(s);
    expect(couper("bonjour", 3)).toBe("bon");
  });
  it("retire aussi le caractère nul et les moitiés orphelines déjà là", () => {
    expect(couper("a\u0000b", 300)).toBe("ab");
    expect(couper("a\ud83dbcdef", 4)).toBe("abc");
    expect(couper("ab\ud83dcd", 3)).toBe("ab");
  });
  it("longueur maximale vide ou négative : texte vide", () => {
    expect(couper("abc", 0)).toBe("");
    expect(couper("abc", -2)).toBe("");
  });
  it("le résultat passe toujours en JSON, quelle que soit la coupe", () => {
    const legende = "Merci @marque 💪🔥 pour ce colis 🎁✨ code PROMO20 👉 lien en bio 🙏🏽 #ad ".repeat(5);
    let sliceCasse = 0;
    for (let max = 0; max <= legende.length; max++) {
      if (!bienForme(legende.slice(0, max))) sliceCasse++;
      const r = couper(legende, max);
      expect(r.length).toBeLessThanOrEqual(max);
      expect(bienForme(r)).toBe(true);
      expect(JSON.stringify({ cap: r })).not.toMatch(SEQUENCE_ISOLEE);
      expect(legende.startsWith(r)).toBe(true);
    }
    // Sans couper, une partie des coupes casse bien un emoji (le bug du radar).
    expect(sliceCasse).toBeGreaterThan(0);
    expect(JSON.stringify({ t: texteSur("x\u0000y\ud83d") })).toBe('{"t":"xy"}');
  });
});

describe("str (texte reçu d'un outil)", () => {
  it("retire les espaces autour, coupe sans casser d'emoji", () => {
    expect(str("  bonjour  ")).toBe("bonjour");
    expect(str(" ab😀 ", 3)).toBe("ab");
    expect(str("x".repeat(600)).length).toBe(500);
  });
  it("pas un texte : vide", () => {
    expect(str(undefined)).toBe("");
    expect(str(42)).toBe("");
    expect(str(null, 10)).toBe("");
  });
});
