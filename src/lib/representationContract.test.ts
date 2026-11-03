import { describe, expect, it } from "vitest";
import { RC_FIELDS, joursEnLettres, representationText } from "./representationContract";

const base = Object.fromEntries(RC_FIELDS.map((f) => [f.key, f.default]));

describe("résiliation libre (article 10.1)", () => {
  it("remplace la fin au terme quand elle est activée", () => {
    const sans = representationText({ ...base, modeDuree: "determinee" });
    expect(sans).toContain("10.1 Le contrat prend fin de plein droit");
    expect(sans).not.toContain("Résiliation libre");

    const avec = representationText({ ...base, modeDuree: "determinee", resiliationLibre: "true", resiliationLibreJours: "1" });
    expect(avec).not.toContain("10.1 Le contrat prend fin de plein droit");
    expect(avec).toContain("moyennant un préavis de un (1) jour. La résiliation prend effet le lendemain de la notification.");
    expect(avec).toContain("conformément à l'article 10.3");
  });

  it("remplace aussi la résiliation amiable d'un contrat reconductible", () => {
    const avec = representationText({ ...base, modeDuree: "reconductible", resiliationLibre: "true", resiliationLibreJours: "7" });
    expect(avec).not.toContain("10.1 Après la période d'essai");
    expect(avec).toContain("préavis de sept (7) jours. La résiliation prend effet à l'expiration de ce préavis.");
  });
});

describe("joursEnLettres", () => {
  it("écrit le nombre en lettres", () => {
    expect(joursEnLettres(1)).toBe("un (1) jour");
    expect(joursEnLettres(15)).toBe("quinze (15) jours");
    expect(joursEnLettres(30)).toBe("30 jours");
    expect(joursEnLettres(0)).toBe("un (1) jour");
  });
});
