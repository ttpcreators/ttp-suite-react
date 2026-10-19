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
