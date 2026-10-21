import { describe, expect, it } from "vitest";
import { contratsSubFromTab, contratsTabFromSub, parseTabOrder, sortByOrder, tabFromSub, tabLabel } from "./folderTabs";

describe("Onglets dossier", () => {
  it("compteur dans le libellé, rien quand il est nul", () => {
    expect(tabLabel("Agents", 2)).toBe("Agents · 2");
    expect(tabLabel("Agents", 0)).toBe("Agents");
    expect(tabLabel("Agents")).toBe("Agents");
    expect(tabLabel("Agents", null)).toBe("Agents");
  });

  it("ordre enregistré, nouveaux onglets à la fin dans leur ordre d'origine", () => {
    const items = [{ value: "a" }, { value: "b" }, { value: "c" }, { value: "d" }];
    expect(sortByOrder(items, ["c", "a"]).map((i) => i.value)).toEqual(["c", "a", "b", "d"]);
    expect(sortByOrder(items, []).map((i) => i.value)).toEqual(["a", "b", "c", "d"]);
    // Un id enregistré qui n'existe plus ne gêne pas.
    expect(sortByOrder(items, ["zz", "d"]).map((i) => i.value)).toEqual(["d", "a", "b", "c"]);
  });

  it("ordre gardé : JSON illisible ou autre chose qu'une liste = vide", () => {
    expect(parseTabOrder('["b","a"]')).toEqual(["b", "a"]);
    expect(parseTabOrder(null)).toEqual([]);
    expect(parseTabOrder("{oups")).toEqual([]);
    expect(parseTabOrder('{"a":1}')).toEqual([]);
  });

  it("sous-page de la sidebar → onglet, sinon l'onglet par défaut", () => {
    const tabs = ["creatrices", "agence", "files"] as const;
    expect(tabFromSub("agence", tabs, "creatrices")).toBe("agence");
    expect(tabFromSub(null, tabs, "creatrices")).toBe("creatrices");
    expect(tabFromSub("inconnu", tabs, "creatrices")).toBe("creatrices");
  });

  it("Contrats : sous-page nulle = « Tous », aller-retour sans perte", () => {
    expect(contratsTabFromSub(null)).toBe("tous");
    expect(contratsTabFromSub("repr")).toBe("repr");
    expect(contratsTabFromSub("autre")).toBe("tous");
    expect(contratsSubFromTab("tous")).toBeNull();
    for (const t of ["marque", "repr", "ugc"] as const) expect(contratsTabFromSub(contratsSubFromTab(t))).toBe(t);
  });
});
