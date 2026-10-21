import { describe, expect, it } from "vitest";
import { CS_ALL_TABS, CS_MAIN_TABS, normalizeCsTab, ownerTab, parseCsFavorites, toggleCsFavorite } from "./creatorTabs";

describe("onglets de l'espace créateur", () => {
  it("5 onglets en bas, dans l'ordre de la maquette", () => {
    expect([...CS_MAIN_TABS]).toEqual(["accueil", "missions", "mails", "gains", "profil"]);
  });

  it("les anciennes valeurs mémorisées retombent sur un onglet valide", () => {
    expect(normalizeCsTab("briefs")).toBe("missions");
    expect(normalizeCsTab("facturation")).toBe("gains");
    expect(normalizeCsTab("__more")).toBe("profil");
    expect(normalizeCsTab("todo")).toBe("todo");
    expect(normalizeCsTab("mails")).toBe("mails");
    expect(normalizeCsTab("onglet-inconnu")).toBe("accueil");
    expect(normalizeCsTab(null)).toBe("accueil");
  });

  it("aucune ancienne rubrique perdue", () => {
    const old = ["accueil", "guide", "evolution", "rapport", "debrief", "roadmap", "todo", "ideas", "briefs", "mails", "gifting", "planning", "mediakit", "documents", "contacts", "facturation"];
    for (const v of old) expect(CS_ALL_TABS).toContain(normalizeCsTab(v));
  });

  it("une rubrique secondaire allume l'onglet Profil", () => {
    expect(ownerTab("guide")).toBe("profil");
    expect(ownerTab("gains")).toBe("gains");
  });
});

describe("favoris du créateur", () => {
  it("garde seulement les rubriques valides, sans doublon", () => {
    expect(parseCsFavorites('["planning","planning","accueil","inconnu","briefs"]')).toEqual(["planning", "missions"]);
    expect(parseCsFavorites("{oups")).toEqual([]);
    expect(parseCsFavorites(null)).toEqual(["todo", "mediakit"]); // premier passage : favoris d'office
    expect(parseCsFavorites("[]")).toEqual([]); // tout retiré par le créateur : reste vide
  });
  it("ajoute puis retire", () => {
    const a = toggleCsFavorite([], "mediakit");
    expect(a).toEqual(["mediakit"]);
    expect(toggleCsFavorite(a, "mediakit")).toEqual([]);
    expect(toggleCsFavorite(a, "profil")).toEqual(["mediakit"]);
  });
});
