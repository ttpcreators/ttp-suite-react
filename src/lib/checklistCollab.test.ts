import { describe, expect, it } from "vitest";
import { autoChecked, collabChecklistName, isChecked, mergeChecklists, nameMatchesCollab, toSaved, type CollabLite, type SavedChecklist } from "./checklistCollab";

const jnpr: CollabLite = { id: "c1", brand: "JNPR", creator: "LÉNA TEST", step: 8, status: "active" };
const nutri: CollabLite = { id: "c2", brand: "Nutripure", creator: "Margaux Test", step: 2, status: "active" };
const lost: CollabLite = { id: "c3", brand: "Perdue", creator: "Alice Test", step: 3, status: "perdue" };

describe("checklist reliée aux collabs", () => {
  it("coche les étapes atteintes par la collab", () => {
    expect(autoChecked("brief-1", 1)).toBe(false);
    expect(autoChecked("brief-1", 2)).toBe(true);
    expect(autoChecked("fact-1", 8)).toBe(true);
    expect(autoChecked("fact-2", 8)).toBe(false);
    expect(autoChecked("brief-1", undefined)).toBe(false);
  });
  it("reconnaît une collab dans un nom libre", () => {
    expect(nameMatchesCollab("JNPR X LÉNA", jnpr)).toBe(true);
    expect(nameMatchesCollab("léna × jnpr", jnpr)).toBe(true);
    expect(nameMatchesCollab("Nutripure x Léna", jnpr)).toBe(false);
    expect(nameMatchesCollab("JNPR", jnpr)).toBe(false);
    expect(collabChecklistName(jnpr)).toBe("JNPR × Léna");
  });
  it("relie les anciennes checklists et crée celles qui manquent", () => {
    const saved: SavedChecklist[] = [{ id: "a", name: "JNPR X LÉNA", done: { "fact-2": true } }, { id: "b", name: "Libre", done: {} }];
    const shown = mergeChecklists(saved, [jnpr, nutri, lost]);
    expect(shown.map((c) => [c.id, c.collab?.id ?? null, !!c.virtual])).toEqual([
      ["a", "c1", false],
      ["b", null, false],
      ["collab:c2", "c2", true],
    ]);
    expect(isChecked(shown[0], "fact-1")).toBe(true); // collab à l'étape 8
    expect(isChecked(shown[0], "fact-2")).toBe(true); // coché à la main
    expect(isChecked(shown[0], "fact-3")).toBe(false);
    expect(toSaved(shown[0])).toEqual({ id: "a", name: "JNPR X LÉNA", done: { "fact-2": true }, collabId: "c1" });
  });
  it("une collab n'a qu'une checklist", () => {
    const saved: SavedChecklist[] = [{ id: "a", name: "x", done: {}, collabId: "c1" }, { id: "b", name: "JNPR x Léna", done: {} }];
    const shown = mergeChecklists(saved, [jnpr]);
    expect(shown.map((c) => c.collab?.id ?? null)).toEqual(["c1", null]);
  });
});
