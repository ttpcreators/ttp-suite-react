import { describe, it, expect } from "vitest";
import { restoreTabs, navigateTab, addTab, closeTab } from "./tabs";

// Vues valides fictives pour les tests.
const VALID = new Set(["apercu", "contacts", "facturation", "todo", "roster"]);
const isValid = (id: string) => VALID.has(id);

describe("restoreTabs (scénario reload — état persisté)", () => {
  it("restaure une liste valide (dédoublonnée)", () => {
    expect(restoreTabs('["facturation","contacts","facturation"]', "apercu", isValid))
      .toEqual(["facturation", "contacts"]);
  });

  it("ignore les ids inconnus", () => {
    expect(restoreTabs('["facturation","VUE_SUPPRIMEE","todo"]', "apercu", isValid))
      .toEqual(["facturation", "todo"]);
  });

  it("retombe sur [active] si tout est invalide / vide / cassé", () => {
    expect(restoreTabs("[]", "contacts", isValid)).toEqual(["contacts"]);
    expect(restoreTabs('["INCONNU"]', "contacts", isValid)).toEqual(["contacts"]);
    expect(restoreTabs("{pas du json", "contacts", isValid)).toEqual(["contacts"]);
    expect(restoreTabs(null, "contacts", isValid)).toEqual(["contacts"]);
    expect(restoreTabs('"pas un tableau"', "contacts", isValid)).toEqual(["contacts"]);
    expect(restoreTabs("[1,2,3]", "contacts", isValid)).toEqual(["contacts"]);
  });
});

describe("navigateTab (naviguer l'onglet courant)", () => {
  it("remplace la page de l'onglet actif", () => {
    expect(navigateTab(["facturation", "contacts"], "contacts", "todo"))
      .toEqual(["facturation", "todo"]);
  });

  it("ne duplique pas si la cible est déjà ouverte (bascule simple)", () => {
    const tabs = ["facturation", "contacts"];
    expect(navigateTab(tabs, "facturation", "contacts")).toBe(tabs); // même référence
  });

  it("ajoute si l'actif n'est pas dans la liste (sécurité)", () => {
    expect(navigateTab(["facturation"], "inconnu", "todo")).toEqual(["facturation", "todo"]);
  });
});

describe("addTab (nouvel onglet)", () => {
  it("ajoute un onglet", () => {
    expect(addTab(["facturation"], "contacts")).toEqual(["facturation", "contacts"]);
  });
  it("no-op si déjà ouvert", () => {
    const tabs = ["facturation", "contacts"];
    expect(addTab(tabs, "contacts")).toBe(tabs);
  });
});

describe("closeTab (fermer un onglet)", () => {
  it("ferme un onglet non-actif → actif inchangé", () => {
    expect(closeTab(["facturation", "contacts", "todo"], "contacts", "todo"))
      .toEqual({ tabs: ["facturation", "contacts"], active: "contacts" });
  });

  it("ferme l'onglet actif → bascule sur le voisin", () => {
    expect(closeTab(["facturation", "contacts", "todo"], "contacts", "contacts"))
      .toEqual({ tabs: ["facturation", "todo"], active: "todo" });
  });

  it("ferme le dernier onglet → retombe sur apercu", () => {
    expect(closeTab(["contacts"], "contacts", "contacts"))
      .toEqual({ tabs: ["apercu"], active: "apercu" });
  });

  it("ferme le dernier onglet de la liste (actif) → voisin de gauche", () => {
    expect(closeTab(["facturation", "contacts"], "contacts", "contacts"))
      .toEqual({ tabs: ["facturation"], active: "facturation" });
  });
});
