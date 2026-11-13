import { describe, expect, it } from "vitest";
import { motsCles, tacheEnDouble } from "./todoDoublon.ts";

const ouvertes = [
  { id: "t1", text: "Relancer Nova pour le contrat de Léa", creator: "Léa", due: "2026-11-20" },
  { id: "t2", text: "Envoyer les stats Yade", creators: ["Inès"] },
  { id: "t3", text: "Répondre à Lorna (Seoni) : tarifs", creator: null },
];

describe("To-do : pas de tâche en double", () => {
  it("garde les mots qui portent le sens, sans accents", () => {
    expect(motsCles("Répondre à Lorna (Seoni) : tarifs")).toEqual(["repondre", "lorna", "seoni", "tarifs"]);
  });

  it("trouve la même tâche écrite autrement, pour le même créateur", () => {
    expect(tacheEnDouble("Relance contrat Nova Léa", ["Léa"], ouvertes)?.id).toBe("t1");
    expect(tacheEnDouble("Envoyer stats Yade", ["inès"], ouvertes)?.id).toBe("t2");
    expect(tacheEnDouble("Répondre à Lorna pour les tarifs Seoni", [], ouvertes)?.id).toBe("t3");
  });

  it("laisse passer une autre action, ou la même action pour un autre créateur", () => {
    expect(tacheEnDouble("Facturer Nova pour Léa", ["Léa"], ouvertes)).toBeNull();
    expect(tacheEnDouble("Envoyer les stats Yade", ["Léa"], ouvertes)).toBeNull();
    expect(tacheEnDouble("", [], ouvertes)).toBeNull();
  });
});
