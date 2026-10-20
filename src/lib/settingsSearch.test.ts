import { describe, expect, it } from "vitest";
import { bestHit, entryForTarget, groupHits, pagesVisibility, searchSettings, sectionAnchor, type SettingsEntry } from "./settingsSearch";

const ENTRIES: SettingsEntry[] = [
  { id: "apparence", label: "Apparence", group: "Général", keywords: ["thème", "sombre"], sections: [{ title: "Apparence" }, { title: "Couleur d'accent", keywords: ["couleur"] }, { title: "Pages affichées", keywords: ["menu"] }] },
  { id: "signature", label: "Signature", group: "Général", sections: [{ title: "Signature", keywords: ["contrat"] }] },
  { id: "resumes", label: "Résumés et rappels", group: "Notifications", sections: [{ title: "Résumé du matin", keywords: ["anniversaires"] }, { title: "Point de mi-journée" }] },
  { id: "compte", label: "Compte", group: "Compte", keywords: ["déconnexion"], sections: [{ title: "Compte" }] },
];

describe("Paramètres : recherche d'un réglage", () => {
  it("requête vide = toutes les entrées, sans carte ciblée", () => {
    const hits = searchSettings(ENTRIES, "  ");
    expect(hits.map((h) => h.entry.id)).toEqual(["apparence", "signature", "resumes", "compte"]);
    expect(hits.every((h) => h.section === null)).toBe(true);
  });

  it("libellé, mot-clé ou titre de carte, sans accents ni casse", () => {
    expect(searchSettings(ENTRIES, "SIGN").map((h) => h.entry.id)).toEqual(["signature"]);
    expect(searchSettings(ENTRIES, "theme").map((h) => h.entry.id)).toEqual(["apparence"]);
    expect(searchSettings(ENTRIES, "deconnexion").map((h) => h.entry.id)).toEqual(["compte"]);
    expect(searchSettings(ENTRIES, "zzz")).toEqual([]);
  });

  it("une carte qui correspond mieux que l'entrée est désignée", () => {
    const [hit] = searchSettings(ENTRIES, "matin");
    expect(hit.entry.id).toBe("resumes");
    expect(hit.section?.title).toBe("Résumé du matin");
    // L'entrée elle-même gagne : pas de carte ciblée.
    expect(searchSettings(ENTRIES, "appar")[0].section).toBeNull();
    expect(searchSettings(ENTRIES, "accent")[0].section?.title).toBe("Couleur d'accent");
  });

  it("meilleur résultat et regroupement par en-tête", () => {
    const hits = searchSettings(ENTRIES, "rappel");
    expect(bestHit(hits)?.entry.id).toBe("resumes");
    expect(bestHit([])).toBeNull();
    const groups = groupHits(searchSettings(ENTRIES, ""));
    expect(groups.map((g) => g.group)).toEqual(["Général", "Notifications", "Compte"]);
    expect(groups[0].hits).toHaveLength(2);
  });
});

describe("Paramètres : ancres et cibles", () => {
  it("ancre stable à partir du titre", () => {
    expect(sectionAnchor("Résumé du matin")).toBe("reglage-resume-du-matin");
    expect(sectionAnchor("Couleur d'accent")).toBe("reglage-couleur-d-accent");
  });

  it("retrouve l'entrée par id, ancienne ancre ou titre de carte", () => {
    expect(entryForTarget(ENTRIES, "signature")?.id).toBe("signature");
    expect(entryForTarget(ENTRIES, "#reglage-pages-affichees")?.id).toBe("apparence");
    expect(entryForTarget(ENTRIES, "Point de mi-journée")?.id).toBe("resumes");
    expect(entryForTarget(ENTRIES, "reglage-inconnu")).toBeNull();
    expect(entryForTarget(ENTRIES, null)).toBeNull();
  });
});

describe("Paramètres : pages affichées", () => {
  it("compte les pages visibles", () => {
    expect(pagesVisibility(["a", "b", "c"], ["b", "zz"])).toEqual({ visible: 2, total: 3 });
    expect(pagesVisibility([], [])).toEqual({ visible: 0, total: 0 });
  });
});
