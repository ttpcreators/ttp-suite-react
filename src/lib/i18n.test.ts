import { describe, expect, it } from "vitest";
import { translate } from "./i18n";
import { EN } from "./i18n/en";

describe("traduction de l'espace créateur", () => {
  it("français par défaut, anglais si traduit, sinon repli sur le français", () => {
    expect(translate("fr", "Bonjour {name}", { name: "Léa" })).toBe("Bonjour Léa");
    expect(translate("en", "texte jamais traduit")).toBe("texte jamais traduit");
  });

  it("un nom hérité d'objet (constructor…) n'est ni une traduction ni une variable", () => {
    expect(translate("en", "constructor")).toBe("constructor");
    expect(translate("fr", "{toString} et {name}", { name: "Léa" })).toBe("{toString} et Léa");
  });

  it("chaque traduction garde exactement les mêmes variables {…}", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    const bad = Object.entries(EN).filter(([fr, en]) => vars(fr) !== vars(en) || !en.trim());
    expect(bad).toEqual([]);
  });
});
