import { describe, expect, it } from "vitest";
import { siteSlugify, siteSlugs } from "./mediakitSlug";

describe("adresse du media kit (même règle que le site)", () => {
  it("minuscules, sans accents, tirets", () => {
    expect(siteSlugify("Léa")).toBe("lea");
    expect(siteSlugify("Anne-Sophie B.")).toBe("anne-sophie-b");
    expect(siteSlugify("")).toBe("createur");
  });

  it("champ « Lien » d'abord, sinon le prénom, doublons numérotés dans l'ordre du roster", () => {
    const m = siteSlugs([
      { name: "LÉA MARTIN", mediakit: null },
      { name: "JUSTINE GENTET", mediakit: { slug: "justinegentet" } },
      { name: "LÉA DURAND", mediakit: {} },
      { name: "JUSTINE ROUX", mediakit: null },
      { name: "LÉA PETIT", mediakit: null },
    ]);
    expect(m.get("LÉA MARTIN")).toBe("lea");
    expect(m.get("JUSTINE GENTET")).toBe("justinegentet");
    expect(m.get("LÉA DURAND")).toBe("lea-2");
    expect(m.get("JUSTINE ROUX")).toBe("justine");
    expect(m.get("LÉA PETIT")).toBe("lea-3");
  });
});

describe("deux créateurs au même prénom (audit 2026-11-11)", () => {
  const rows = [{ name: "Lena Martin", mediakit: null }, { name: "Lena Dupont", mediakit: null }];
  it("l'éditeur montre l'adresse que le site donne vraiment à CE créateur", async () => {
    const { siteSlugFor } = await import("./mediakitSlug");
    expect(siteSlugFor(rows, "Lena Martin", "")).toBe("lena");
    expect(siteSlugFor(rows, "Lena Dupont", "")).toBe("lena-2");
    expect(siteSlugFor(rows, "Lena Dupont", "lena")).toBe("lena-2"); // « lena » est déjà pris par l'autre
    expect(siteSlugFor(rows, "Lena Dupont", "Léna D")).toBe("lena-d");
  });
  it("le premier du roster garde son adresse ; hors liste publiée : rien", async () => {
    const { siteSlugFor } = await import("./mediakitSlug");
    expect(siteSlugFor([...rows].reverse(), "Lena Dupont", "lena")).toBe("lena");
    expect(siteSlugFor(rows, "Zoé Absente", "zoe")).toBeUndefined();
  });
});
