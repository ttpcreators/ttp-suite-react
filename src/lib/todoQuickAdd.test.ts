import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "./todoQuickAdd";

const NOW = new Date(2026, 9, 20, 18, 30); // mardi 20 octobre 2026, le soir
const CREATORS = [{ name: "LÉNA MARTIN" }, { name: "Marc Dupont" }, { name: "Inès" }, { name: "Paul Durand" }, { name: "Paul Morel" }];

describe("todoQuickAdd", () => {
  it("l'exemple de la barre : créateur, priorité, échéance retirés du titre", () => {
    expect(parseQuickAdd("Relancer Nutripure demain @Léna !haute", CREATORS, NOW)).toEqual({
      title: "Relancer Nutripure",
      creator: "LÉNA MARTIN",
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
      priority: "haute",
      due: "2026-10-26",
    });
  });

  it("titre vide si la phrase ne contient que des mots reconnus", () => {
    expect(parseQuickAdd("  !haute demain  ", CREATORS, NOW).title).toBe("");
  });
});
