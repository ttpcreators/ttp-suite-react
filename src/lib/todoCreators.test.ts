import { describe, expect, it } from "vitest";
import {
  avatarStack,
  creatorOrFilter,
  creatorsColumnMissing,
  creatorsLabel,
  creatorsPatch,
  hasCreator,
  joinNames,
  normalizeCreators,
  sharedWithLabel,
  todoCreators,
  toggleCreator,
} from "./todoCreators";

describe("todoCreators", () => {
  it("normalise : rogne, retire les vides et les doublons (casse ignorée), garde l'ordre", () => {
    expect(normalizeCreators([" JUSTINE GENTET ", "", null, "Léna", "justine gentet", undefined, "LÉNA"])).toEqual(["JUSTINE GENTET", "Léna"]);
    expect(normalizeCreators(null)).toEqual([]);
  });

  it("créateurs d'une tâche : la liste, sinon l'ancien champ seul", () => {
    expect(todoCreators({ creator: "A", creators: ["B", "A"] })).toEqual(["B", "A"]);
    expect(todoCreators({ creator: "A", creators: [] })).toEqual(["A"]);
    expect(todoCreators({ creator: "A" })).toEqual(["A"]);
    expect(todoCreators({ creator: null, creators: null })).toEqual([]);
    expect(todoCreators({ creator: "  " })).toEqual([]);
  });

  it("hasCreator : premier ou dans la liste, casse ignorée", () => {
    expect(hasCreator({ creator: "A", creators: ["A", "Justine"] }, "JUSTINE")).toBe(true);
    expect(hasCreator({ creator: "Justine" }, "justine")).toBe(true);
    expect(hasCreator({ creator: "A", creators: ["A"] }, "Justine")).toBe(false);
    expect(hasCreator({ creator: "A" }, "")).toBe(false);
  });

  it("libellé du choix : rien, un nom, « Justine + 2 »", () => {
    expect(creatorsLabel([])).toBe("Sélectionner…");
    expect(creatorsLabel([], "L'agence")).toBe("L'agence");
    expect(creatorsLabel(["JUSTINE GENTET"])).toBe("Justine Gentet");
    expect(creatorsLabel(["JUSTINE GENTET", "LÉNA MARTIN", "Inès"])).toBe("Justine + 2");
    expect(creatorsLabel(["JUSTINE GENTET", "justine gentet"])).toBe("Justine Gentet");
  });

  it("noms à la suite", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["LÉNA MARTIN"])).toBe("Léna Martin");
    expect(joinNames(["a", "b", "c"])).toBe("A, B et C");
  });

  it("espace créateur : les autres créateurs, discrètement", () => {
    expect(sharedWithLabel({ creator: "LÉNA MARTIN" }, "LÉNA MARTIN")).toBeNull();
    expect(sharedWithLabel({ creator: "LÉNA MARTIN", creators: ["LÉNA MARTIN", "JUSTINE GENTET"] }, "léna martin")).toBe("Avec Justine");
    expect(sharedWithLabel({ creator: "JUSTINE GENTET", creators: ["JUSTINE GENTET", "LÉNA MARTIN", "Inès"] }, "LÉNA MARTIN")).toBe("Avec Justine et Inès");
    expect(sharedWithLabel({ creators: ["A", "B", "C", "D"] }, "A")).toBe("Avec B, C et 1 autre");
    expect(sharedWithLabel({ creators: ["A", "B", "C", "D", "E"] }, "A")).toBe("Avec B, C et 2 autres");
  });

  it("case à cocher : ajoute ou retire", () => {
    expect(toggleCreator(["A"], "B")).toEqual(["A", "B"]);
    expect(toggleCreator(["A", "B"], "a")).toEqual(["B"]);
    expect(toggleCreator([], " C ")).toEqual(["C"]);
  });

  it("avatars empilés : 3 au plus, puis +N", () => {
    expect(avatarStack(["a", "b"])).toEqual({ shown: ["a", "b"], more: 0 });
    expect(avatarStack(["a", "b", "c", "d", "e"])).toEqual({ shown: ["a", "b", "c"], more: 2 });
  });

  it("filtre PostgREST : premier OU dans la liste, nom entre guillemets", () => {
    expect(creatorOrFilter("LÉNA MARTIN")).toBe('creator.eq."LÉNA MARTIN",creators.cs.{"LÉNA MARTIN"}');
    expect(creatorOrFilter('A "B"')).toBe('creator.eq."A \\"B\\"",creators.cs.{"A \\"B\\""}');
  });

  it("colonne absente détectée, autres erreurs non", () => {
    expect(creatorsColumnMissing({ code: "42703", message: "column todos.creators does not exist" })).toBe(true);
    expect(creatorsColumnMissing({ code: "PGRST204", message: "Could not find the 'creators' column of 'todos' in the schema cache" })).toBe(true);
    expect(creatorsColumnMissing({ code: "42501", message: "permission denied" })).toBe(false);
    expect(creatorsColumnMissing(null)).toBe(false);
  });

  it("champs à écrire : premier créateur, tag, liste seulement si la colonne existe", () => {
    expect(creatorsPatch(["B", "A", "b"], true)).toEqual({ creator: "B", tag: "CRÉATEUR", creators: ["B", "A"] });
    expect(creatorsPatch(["B", "A"], false)).toEqual({ creator: "B", tag: "CRÉATEUR" });
    expect(creatorsPatch([], true)).toEqual({ creator: null, tag: "AGENCE", creators: [] });
  });
});
