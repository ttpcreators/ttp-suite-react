import { describe, expect, it } from "vitest";
import { explainCollab, explainItem } from "./todayExplain";

describe("explications d'Aujourd'hui", () => {
  it("collab bloquée : sens + action de l'étape suivante, avec prénom et marque", () => {
    const e = explainCollab({ brand: "Seoni", creator: "CANDICE MAISSA", step: 1, stepLabel: "Signature", staleDays: 7 });
    expect(e.meaning).toContain("« Signature » depuis 7 jours");
    expect(e.action).toBe("Vérifie que Seoni et Candice ont signé le contrat. Envoie ensuite le brief à Candice et passe la collab à « Brief transmis ».");
  });
  it("une explication pour chaque type de ligne utile, rien pour une tâche", () => {
    expect(explainItem({ kind: "relance", lateDays: 12, invoice: { party: "Nike x Sarah" } })?.meaning).toBe("Nike n'a pas payé cette facture : l'échéance est dépassée de 12 jours.");
    expect(explainItem({ kind: "contrat", contract: { creator: "léna pasquale", end: "2026-11-01" } })?.action).toContain("avec Léna");
    expect(explainItem({ kind: "todo" })).toBe(null);
    for (const step of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(explainCollab({ brand: "B", creator: "C", step, stepLabel: "x", staleDays: 7 }).action).not.toMatch(/\{[cm]\}/);
    }
  });
});
