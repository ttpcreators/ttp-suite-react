import { describe, expect, it } from "vitest";
import { briefForCollab, cleanConcept, conceptColumnsMissing, conceptState, CONCEPT_MAX } from "./briefConcept";

describe("brief lu et concept du créateur", () => {
  it("état du concept", () => {
    expect(conceptState(null)).toBe("aucun");
    expect(conceptState({ concept: "  ", concept_status: "propose" })).toBe("aucun");
    expect(conceptState({ concept: "Un réveil en musique", concept_status: "propose" })).toBe("propose");
    expect(conceptState({ concept: "Un réveil en musique", concept_status: "valide" })).toBe("valide");
  });

  it("nettoie la proposition", () => {
    expect(cleanConcept("  Idée  ", "")).toEqual({ concept: "Idée", link: null });
    expect(cleanConcept("Idée", "drive.google.com/x")).toEqual({ concept: "Idée", link: "https://drive.google.com/x" });
    expect(cleanConcept("", "")).toEqual({ error: "vide" });
    expect(cleanConcept("x".repeat(CONCEPT_MAX + 1), "")).toEqual({ error: "long" });
    expect(cleanConcept("Idée", "pas un lien")).toEqual({ error: "lien" });
  });

  it("colonnes absentes avant le SQL", () => {
    expect(conceptColumnsMissing({ code: "42703", message: "column briefs.read_at does not exist" })).toBe(true);
    expect(conceptColumnsMissing({ code: "42501", message: "permission denied" })).toBe(false);
  });

  it("retrouve le brief d'une collab", () => {
    const briefs = [
      { id: "b1", brand: "Alpha", creator: "Test Un", collab_id: null, created_at: "2026-10-01" },
      { id: "b2", brand: "alpha", creator: "test un", collab_id: null, created_at: "2026-11-01" },
      { id: "b3", brand: "Bravo", creator: "Test Un", collab_id: "c2", created_at: "2026-09-01" },
    ];
    expect(briefForCollab({ id: "c9", brief_id: "b1", brand: "Alpha", creator: "Test Un" }, briefs)?.id).toBe("b1");
    expect(briefForCollab({ id: "c2", brand: "Autre", creator: "Test Un" }, briefs)?.id).toBe("b3");
    expect(briefForCollab({ id: "c1", brand: "Alpha", creator: "Test Un" }, briefs)?.id).toBe("b2");
    expect(briefForCollab({ id: "c3", brand: "Zulu", creator: "Test Un" }, briefs)).toBeNull();
  });
});
