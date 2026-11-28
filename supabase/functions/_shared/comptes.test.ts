import { describe, expect, it } from "vitest";
import { MIN_MOT_DE_PASSE, adresseAgenceAttendue, compteGoogleAgenceOk, rattachementCreateur, resetAutorise } from "./comptes.ts";
import { MIN_MOT_DE_PASSE as MIN_APP } from "../../../src/lib/passwordRecovery.ts";

describe("mot de passe", () => {
  it("le même minimum dans l'app et dans create-access", () => {
    expect(MIN_MOT_DE_PASSE).toBe(12);
    expect(MIN_APP).toBe(MIN_MOT_DE_PASSE);
  });
});

describe("resetAutorise", () => {
  it("un fondateur change son propre mot de passe, celui d'un créateur ou d'un membre", () => {
    expect(resetAutorise("a", "a", { role: "agency", agency_role: "founder" })).toBe(true);
    expect(resetAutorise("a", "b", { role: "creator", agency_role: null })).toBe(true);
    expect(resetAutorise("a", "b", { role: "agency", agency_role: "member" })).toBe(true);
    expect(resetAutorise("a", "a", null)).toBe(true);
  });
  it("jamais celui d'un autre fondateur, ni un compte sans profil", () => {
    expect(resetAutorise("a", "b", { role: "agency", agency_role: "founder" })).toBe(false);
    expect(resetAutorise("a", "b", null)).toBe(false);
    expect(resetAutorise("", "b", null)).toBe(false);
  });
});

describe("rattachementCreateur", () => {
  it("fiche existante et sans compte", () => {
    expect(rattachementCreateur("Zoé Test", true, 0)).toBe(null);
    expect(rattachementCreateur("  ", true, 0)).toBe("createur_requis");
    expect(rattachementCreateur("Zoé Test", false, 0)).toBe("createur_inconnu");
    expect(rattachementCreateur("Zoé Test", true, 1)).toBe("createur_deja_relie");
  });
});

describe("compte Google de l'agence", () => {
  it("le secret s'il est posé, sinon partnerships@ du domaine", () => {
    expect(adresseAgenceAttendue(undefined, "exemple.test")).toBe("partnerships@exemple.test");
    expect(adresseAgenceAttendue(" Boite@Exemple.test ", "autre.test")).toBe("boite@exemple.test");
    expect(adresseAgenceAttendue("pas une adresse", "exemple.test")).toBe("partnerships@exemple.test");
  });
  it("seule l'adresse attendue, vérifiée par Google", () => {
    const a = "partnerships@exemple.test";
    expect(compteGoogleAgenceOk("Partnerships@Exemple.test", true, a)).toBe(true);
    expect(compteGoogleAgenceOk(a, undefined, a)).toBe(true);
    expect(compteGoogleAgenceOk(a, false, a)).toBe(false);
    expect(compteGoogleAgenceOk("quelquun@exemple.test", true, a)).toBe(false);
    expect(compteGoogleAgenceOk(undefined, true, a)).toBe(false);
    expect(compteGoogleAgenceOk(a, true, null)).toBe(false);
  });
});
