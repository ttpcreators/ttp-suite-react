import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "./todoQuickAdd";

const NOW = new Date(2026, 9, 20, 18, 30); // mardi 20 octobre 2026, le soir
const CREATORS = [{ name: "LÉNA MARTIN" }, { name: "Marc Dupont" }, { name: "Inès" }, { name: "Paul Durand" }, { name: "Paul Morel" }];

describe("todoQuickAdd", () => {
  it("l'exemple de la barre : créateur, priorité, échéance retirés du titre", () => {
    expect(parseQuickAdd("Relancer Nutripure demain @Léna !haute", CREATORS, NOW)).toEqual({
      title: "Relancer Nutripure",
      creator: "LÉNA MARTIN",
      creators: ["LÉNA MARTIN"],
      priority: "haute",
      due: "2026-10-21",
    });
  });

  it("créateur : prénom ou nom complet, sans tenir compte des accents ni de la casse", () => {
    expect(parseQuickAdd("Appeler @lena", CREATORS, NOW).creator).toBe("LÉNA MARTIN");
    expect(parseQuickAdd("Appeler @Léna Martin vite", CREATORS, NOW)).toMatchObject({ title: "Appeler vite", creator: "LÉNA MARTIN" });
    expect(parseQuickAdd("Brief @ines, svp", CREATORS, NOW)).toMatchObject({ title: "Brief svp", creator: "Inès" });
  });

  it("créateur inconnu ou prénom partagé : le texte reste tel quel", () => {
    expect(parseQuickAdd("Voir @Zoé", CREATORS, NOW)).toMatchObject({ title: "Voir @Zoé", creator: null });
    expect(parseQuickAdd("Voir @Paul", CREATORS, NOW)).toMatchObject({ title: "Voir @Paul", creator: null });
    expect(parseQuickAdd("Voir @Paul Morel", CREATORS, NOW)).toMatchObject({ title: "Voir", creator: "Paul Morel" });
    expect(parseQuickAdd("Écrire à contact@marque.fr", CREATORS, NOW).title).toBe("Écrire à contact@marque.fr");
  });

  it("priorité : !haute / !moyenne / !basse, le reste n'est pas touché", () => {
    expect(parseQuickAdd("Facture !BASSE", CREATORS, NOW)).toMatchObject({ title: "Facture", priority: "basse" });
    expect(parseQuickAdd("Facture !moyenne", CREATORS, NOW).priority).toBe("moyenne");
    expect(parseQuickAdd("Facture !urgent", CREATORS, NOW)).toMatchObject({ title: "Facture !urgent", priority: null });
  });

  it("échéance : aujourd'hui, demain, prochain jour de semaine", () => {
    expect(parseQuickAdd("Poster aujourd’hui", CREATORS, NOW)).toMatchObject({ title: "Poster", due: "2026-10-20" });
    expect(parseQuickAdd("Poster Aujourd'hui", CREATORS, NOW).due).toBe("2026-10-20");
    expect(parseQuickAdd("Point lundi", CREATORS, NOW).due).toBe("2026-10-26");
    // Le même jour que aujourd'hui = la semaine prochaine.
    expect(parseQuickAdd("Point mardi", CREATORS, NOW).due).toBe("2026-10-27");
    expect(parseQuickAdd("Point Mercredi", CREATORS, NOW).due).toBe("2026-10-21");
    expect(parseQuickAdd("Bilan demain", CREATORS, new Date(2026, 9, 31)).due).toBe("2026-11-01");
    expect(parseQuickAdd("Rien de daté", CREATORS, NOW).due).toBeNull();
  });

  it("seul le premier mot de chaque sorte est lu", () => {
    expect(parseQuickAdd("Caler lundi ou mardi !haute !basse", CREATORS, NOW)).toEqual({
      title: "Caler ou mardi !basse",
      creator: null,
      creators: [],
      priority: "haute",
      due: "2026-10-26",
    });
  });

  it("plusieurs @ : tâche partagée, dans l'ordre, sans doublon", () => {
    expect(parseQuickAdd("Shooting @Léna @Inès demain", CREATORS, NOW)).toMatchObject({
      title: "Shooting",
      creator: "LÉNA MARTIN",
      creators: ["LÉNA MARTIN", "Inès"],
      due: "2026-10-21",
    });
    expect(parseQuickAdd("Appel @Paul Morel @lena @Léna", CREATORS, NOW)).toMatchObject({
      title: "Appel",
      creators: ["Paul Morel", "LÉNA MARTIN"],
    });
    expect(parseQuickAdd("Voir @Zoé @Inès", CREATORS, NOW)).toMatchObject({ title: "Voir @Zoé", creators: ["Inès"] });
  });

  it("échéance en chiffres : 25/10, 25/10/2026, date passée = l'an prochain, date impossible ignorée", () => {
    expect(parseQuickAdd("Facture 25/10", CREATORS, NOW)).toMatchObject({ title: "Facture", due: "2026-10-25" });
    expect(parseQuickAdd("Facture 5/1", CREATORS, NOW).due).toBe("2027-01-05");
    expect(parseQuickAdd("Facture 20/10", CREATORS, NOW).due).toBe("2026-10-20"); // aujourd'hui
    expect(parseQuickAdd("Bilan 03/11/2026,", CREATORS, NOW)).toMatchObject({ title: "Bilan", due: "2026-11-03" });
    expect(parseQuickAdd("Bilan 03/11/27", CREATORS, NOW).due).toBe("2027-11-03");
    expect(parseQuickAdd("Note 31/02", CREATORS, NOW)).toMatchObject({ title: "Note 31/02", due: null });
    expect(parseQuickAdd("Exercice 12/2025", CREATORS, NOW)).toMatchObject({ title: "Exercice 12/2025", due: null });
  });

  it("phrase complète de la barre, accents et inconnus", () => {
    expect(parseQuickAdd("Relancer Nutripure demain @Lena @Justine !haute", [...CREATORS, { name: "JUSTINE GENTET" }], NOW)).toEqual({
      title: "Relancer Nutripure",
      creator: "LÉNA MARTIN",
      creators: ["LÉNA MARTIN", "JUSTINE GENTET"],
      priority: "haute",
      due: "2026-10-21",
    });
    // Un @nom inconnu reste dans le texte (rien n'est perdu), le reste est lu.
    expect(parseQuickAdd("Appeler @Zoé lundi !basse", CREATORS, NOW)).toEqual({
      title: "Appeler @Zoé",
      creator: null,
      creators: [],
      priority: "basse",
      due: "2026-10-26",
    });
  });

  it("titre vide si la phrase ne contient que des mots reconnus", () => {
    expect(parseQuickAdd("  !haute demain  ", CREATORS, NOW).title).toBe("");
  });
});

describe("liste des créateurs sous « @ »", async () => {
  const { mentionAt, mentionSuggestions, insertMention, parseQuickAdd } = await import("./todoQuickAdd");
  const roster = [{ name: "léna pasquale" }, { name: "justine gentet" }, { name: "pierre gentet" }, { name: "léa berenger" }, { name: "lea martin" }];
  it("repère le mot en cours qui commence par @", () => {
    expect(mentionAt("Relancer @lé", 12)).toEqual({ start: 9, query: "lé" });
    expect(mentionAt("Relancer @", 10)).toEqual({ start: 9, query: "" });
    expect(mentionAt("mail@marque.com", 15)).toBeNull();
    expect(mentionAt("Relancer @Léna demain", 21)).toBeNull();
  });
  it("propose par prénom puis par nom, sans accents", () => {
    expect(mentionSuggestions("le", roster).map((c) => c.name)).toEqual(["léa berenger", "lea martin", "léna pasquale"]);
    expect(mentionSuggestions("gent", roster).map((c) => c.name)).toEqual(["justine gentet", "pierre gentet"]);
    expect(mentionSuggestions("", roster)).toHaveLength(5);
    // Une lettre : seulement les prénoms ou noms qui COMMENCENT par elle.
    expect(mentionSuggestions("j", roster).map((c) => c.name)).toEqual(["justine gentet"]);
  });
  it("insère @Prénom (ou le nom complet si le prénom est en double), relisible par l'ajout rapide", () => {
    const a = insertMention("Relancer @ju demain", 9, 12, "justine gentet", roster);
    expect(a.text).toBe("Relancer @Justine demain");
    expect(a.caret).toBe(18);
    const b = insertMention("Appeler @le", 8, 11, "lea martin", [...roster, { name: "lea durand" }]);
    expect(b.text).toBe("Appeler @Lea Martin ");
    expect(parseQuickAdd(a.text, roster).creators ?? [parseQuickAdd(a.text, roster).creator]).toContain("justine gentet");
  });
  it("marche aussi dans un texte sur plusieurs lignes (notes, descriptions)", () => {
    const text = "Ordre du jour\n@pi";
    expect(mentionAt(text, text.length)).toEqual({ start: 14, query: "pi" });
    const r = insertMention(text, 14, text.length, "pierre gentet", roster);
    expect(r.text).toBe("Ordre du jour\n@Pierre ");
    expect(r.caret).toBe(r.text.length);
  });
});
