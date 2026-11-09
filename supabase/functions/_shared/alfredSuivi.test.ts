import { describe, expect, it } from "vitest";
import { droitsTexte, etatDroit, lireDroits, noterPosts, postLigne, postsQuiCartonnent, type DroitUsage } from "./alfredSuivi.ts";

const droit = (o: Partial<DroitUsage>): DroitUsage => ({ id: "d1", marque: "Marque A", createur: "Créateur Test", type: "publicite", debut: "2026-08-01", fin: "2026-11-01", ...o });

describe("droits d'utilisation", () => {
  it("dit si un droit est expiré, finit bientôt ou court encore", () => {
    expect(etatDroit({ fin: "2026-11-01" }, "2026-11-09")).toEqual({ etat: "expire", jours: -8 });
    expect(etatDroit({ fin: "2026-11-20" }, "2026-11-09")).toEqual({ etat: "bientot", jours: 11 });
    expect(etatDroit({ fin: "2027-02-01" }, "2026-11-09").etat).toBe("en_cours");
    expect(etatDroit({ fin: "" }, "2026-11-09").etat).toBe("sans_date");
    expect(etatDroit({ fin: "2026-11-01", clos: true }, "2026-11-09").etat).toBe("clos");
  });

  it("lit le blob sans planter et classe les expirés en tête", () => {
    expect(lireDroits(null)).toEqual([]);
    expect(lireDroits([{ id: 3 }, "x", droit({})])).toHaveLength(1);
    const t = droitsTexte([droit({ id: "a", fin: "2027-05-01" }), droit({ id: "b", fin: "2026-11-01" }), droit({ id: "c", marque: "Autre", fin: "2026-11-15" })], "2026-11-09");
    const lignes = t.split("\n");
    expect(lignes[0]).toContain("1 expiré(s) · 1 qui finissent");
    expect(lignes[1]).toContain("EXPIRÉ depuis 8 j");
    expect(lignes[2]).toContain("finit dans 6 j");
    expect(droitsTexte([droit({}), droit({ id: "z", marque: "Autre" })], "2026-11-09", "autre").split("\n")).toHaveLength(2);
    expect(droitsTexte([], "2026-11-09")).toContain("Aucun droit noté");
  });
});

describe("les posts qui cartonnent", () => {
  const now = new Date("2026-11-09T10:00:00Z");
  const post = (jour: string, views: number | null, likes = 100) => ({ id: jour, at: `2026-${jour}T18:00:00Z`, views, likes, comments: 10, url: `https://ex.test/${jour}` });

  it("compare chaque post à la médiane des autres", () => {
    const notes = noterPosts([post("11-01", 1000), post("11-02", 1200), post("11-03", 800), post("11-07", 5000)]);
    expect(notes[3].mesure).toBe("vues");
    expect(notes[3].habituel).toBe(1000);
    expect(notes[3].ratio).toBe(5);
  });

  it("garde les posts récents à deux fois l'habituel ou plus", () => {
    const posts = [post("10-01", 30000), post("11-01", 1000), post("11-02", 1200), post("11-03", 800), post("11-07", 2600)];
    const top = postsQuiCartonnent(posts, now);
    expect(top.map((p) => p.id)).toEqual(["11-07"]);
    // Le gros post d'octobre est trop ancien.
    expect(postsQuiCartonnent(posts, now, 7).some((p) => p.id === "10-01")).toBe(false);
    expect(postLigne(top[0]).replace(/\s/g, " ")).toContain("2 600 vues (habituel 1 100, ×2,4)");
  });

  it("passe aux interactions sans vues, et ne juge pas sur trop peu de posts", () => {
    const sansVues = [post("11-01", null, 100), post("11-02", null, 120), post("11-03", null, 90), post("11-08", null, 400)];
    expect(postsQuiCartonnent(sansVues, now)[0]).toMatchObject({ mesure: "interactions", id: "11-08" });
    expect(postsQuiCartonnent(sansVues.slice(0, 3), now)).toEqual([]);
  });
});
