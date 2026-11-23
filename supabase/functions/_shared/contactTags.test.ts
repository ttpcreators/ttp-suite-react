import { describe, expect, it } from "vitest";
import { CONTACT_TAGS, normaliserTag, tagConnu, tagHorsListe } from "./contactTags.ts";

describe("normaliserTag", () => {
  it("garde les valeurs de la liste, sans tenir compte des majuscules ni des accents", () => {
    for (const t of CONTACT_TAGS) expect(normaliserTag(t)).toBe(t);
    expect(normaliserTag("media")).toBe("Média");
    expect(normaliserTag("AGENCE rp")).toBe("Agence RP");
    expect(normaliserTag("perso")).toBe("Perso");
    expect(normaliserTag("Lead site")).toBe("Lead site");
  });
  it("rapproche les saisies proches", () => {
    expect(normaliserTag("presse")).toBe("Média");
    expect(normaliserTag("Magazine")).toBe("Média");
    expect(normaliserTag("RP")).toBe("Agence RP");
    expect(normaliserTag("Agence de relations presse")).toBe("Agence RP");
    expect(normaliserTag("attachée de presse")).toBe("Agence RP");
    expect(normaliserTag("agence de talents")).toBe("Agence");
    expect(normaliserTag("brand")).toBe("Marque");
    expect(normaliserTag("Start-up")).toBe("PME");
    expect(normaliserTag("indépendante")).toBe("Freelance");
  });
  it("valeur inconnue : Autre ; vide : la valeur par défaut", () => {
    expect(normaliserTag("Sport")).toBe("Autre");
    expect(normaliserTag("xyz")).toBe("Autre");
    expect(normaliserTag("")).toBe("Autre");
    expect(normaliserTag("  ", "Marque")).toBe("Marque");
  });
});

describe("tagConnu / tagHorsListe", () => {
  it("repère les anciens tags libres", () => {
    expect(tagConnu("média")).toBe("Média");
    expect(tagConnu("Sport")).toBeNull();
    expect(tagHorsListe("Sport")).toBe(true);
    expect(tagHorsListe("Marque")).toBe(false);
    expect(tagHorsListe("")).toBe(false);
  });
});
