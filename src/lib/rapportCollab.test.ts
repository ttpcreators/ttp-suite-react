import { describe, expect, it } from "vitest";
import { renderRapportCollab } from "./rapportCollab";

const base = {
  marque: "Nova",
  createur: "Léa Test",
  periode: "Publié le 12 novembre 2026",
  livrables: "1 reel Instagram, 1 TikTok",
  chiffres: [{ valeur: "182 000", libelle: "Vues, 2,1 fois sa moyenne" }, { valeur: "", libelle: "vide" }],
  posts: [
    { reseau: "Instagram", format: "reel", date: "12 nov.", lien: "https://www.instagram.com/reel/abc/", vues: 150000, likes: 9000 },
    { reseau: "TikTok", date: "12 nov.", vues: 32000, likes: 2100 },
  ],
  captures: [{ url: "https://example.com/a.jpg", legende: "Le reel" }, { url: "javascript:alert(1)" }],
  points_forts: ["Accroche en 2 secondes", ""],
  enseignements: ["Le format démo marche mieux"],
  suite: "Une série de trois reels en janvier.",
};

describe("rapport de fin de collab", () => {
  it("fabrique le document avec l'identité des PDF de l'app", () => {
    const r = renderRapportCollab(base);
    if ("erreur" in r) throw new Error(r.erreur);
    expect(r.html).toContain("Rapport de collaboration");
    expect(r.html).toContain("182 000");
    expect(r.html).toContain("Instrument Serif");
    expect(r.html).toContain("150 000");
    expect(r.html).toContain("Une série de trois reels");
    expect(r.titre).toContain("Nova");
  });

  it("n'affiche que les colonnes et rubriques qui ont des données", () => {
    const r = renderRapportCollab({ ...base, captures: [], enseignements: [] });
    if ("erreur" in r) throw new Error(r.erreur);
    expect(r.html).not.toContain("Partages");
    expect(r.html).not.toContain("Les contenus");
    expect(r.html).not.toContain("Ce que nous en retenons");
  });

  it("écarte une image qui n'est pas en https et échappe le texte", () => {
    const r = renderRapportCollab({ ...base, suite: "<script>x</script>" });
    if ("erreur" in r) throw new Error(r.erreur);
    expect(r.html).not.toContain("javascript:");
    const f = renderRapportCollab({ ...base, captures: [{ url: "file:///Users/x/etat/araignee/a.png" }, { url: "file:///etc/passwd" }] });
    if ("erreur" in f) throw new Error(f.erreur);
    expect(f.html).toContain("a.png");
    expect(f.html).not.toContain("passwd");
    expect(r.html).not.toContain("<script>x");
  });

  it("refuse un rapport sans marque ou sans chiffres", () => {
    expect(renderRapportCollab({ createur: "Léa" })).toHaveProperty("erreur");
    expect(renderRapportCollab({ marque: "Nova", createur: "Léa" })).toHaveProperty("erreur");
  });
});
