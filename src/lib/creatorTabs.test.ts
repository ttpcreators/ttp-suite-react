import { describe, expect, it } from "vitest";
import { CS_ALL_TABS, CS_BAR_TABS, csFavoritesShown, normalizeCsTab, ownerTab, parseCsFavorites, toggleCsFavorite } from "./creatorTabs";

describe("onglets de l'espace créateur", () => {
  it("barre du bas : Accueil, Missions, À faire, Mail, Plus", () => {
    expect([...CS_BAR_TABS]).toEqual(["accueil", "missions", "todo", "mails", "profil"]);
    expect(new Set(CS_ALL_TABS).size).toBe(CS_ALL_TABS.length);
    expect(CS_ALL_TABS).toContain("gains");
    expect(CS_ALL_TABS).toContain("profil"); // le Menu (avatar)
  });

  it("les anciennes valeurs mémorisées retombent sur un onglet valide", () => {
    expect(normalizeCsTab("briefs")).toBe("missions");
    expect(normalizeCsTab("facturation")).toBe("gains");
    expect(normalizeCsTab("__more")).toBe("profil");
    expect(normalizeCsTab("todo")).toBe("todo");
    expect(normalizeCsTab("mails")).toBe("mails");
    expect(normalizeCsTab("onglet-inconnu")).toBe("accueil");
    expect(normalizeCsTab(null)).toBe("accueil");
    // Lien tapé à la main (/?open=cs-tab&tab=constructor) : jamais une fonction comme onglet.
    expect(normalizeCsTab("constructor")).toBe("accueil");
    expect(normalizeCsTab("toString")).toBe("accueil");
    expect(parseCsFavorites('["constructor","ideas"]')).not.toContain("constructor");
  });

  it("aucune ancienne rubrique perdue", () => {
    const old = ["accueil", "guide", "evolution", "rapport", "debrief", "roadmap", "todo", "ideas", "briefs", "mails", "gifting", "planning", "mediakit", "documents", "contacts", "facturation"];
    for (const v of old) expect(CS_ALL_TABS).toContain(normalizeCsTab(v));
  });

  it("une rubrique du Menu n'allume aucun onglet du bas", () => {
    expect(ownerTab("guide")).toBe("profil");
    expect(ownerTab("profil")).toBe("profil");
    expect(ownerTab("gains")).toBe("profil");
    expect(ownerTab("todo")).toBe("todo");
  });
});

describe("favoris du créateur", () => {
  it("garde seulement les rubriques valides, sans doublon", () => {
    expect(parseCsFavorites('["planning","planning","accueil","inconnu","briefs"]')).toEqual(["planning", "missions"]);
    expect(parseCsFavorites("{oups")).toEqual([]);
    expect(parseCsFavorites(null)).toEqual([]); // premier passage : seulement les favoris d'office
    expect(parseCsFavorites('["todo","mediakit"]')).toEqual(["mediakit"]); // ancienne liste : « todo » est d'office
  });
  it("Accueil, À faire, Idées et Mail sont toujours en tête, puis les favoris choisis", () => {
    expect(csFavoritesShown([])).toEqual(["aujourdhui", "accueil", "todo", "ideas", "mails"]);
    expect(csFavoritesShown(["mediakit", "todo"])).toEqual(["aujourdhui", "accueil", "todo", "ideas", "mails", "mediakit"]);
    expect(toggleCsFavorite(["mediakit"], "ideas")).toEqual(["mediakit"]); // d'office : ne se retire pas
  });
  it("ajoute puis retire", () => {
    const a = toggleCsFavorite([], "mediakit");
    expect(a).toEqual(["mediakit"]);
    expect(toggleCsFavorite(a, "mediakit")).toEqual([]);
    expect(toggleCsFavorite(a, "profil")).toEqual(["mediakit"]);
  });
});
