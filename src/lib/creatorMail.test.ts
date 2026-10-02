import { describe, expect, it } from "vitest";
import {
  addressesIn, aliasQuery, brandOf, displayName, isMailStatus, messageMatches, normEmail, threadMatches,
  type GMessageLite,
} from "../../supabase/functions/creator-mail/logic.ts";

const msg = (headers: Record<string, string>, labelIds: string[] = ["INBOX"]): GMessageLite => ({
  labelIds,
  headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
});

const ALIAS = "lea@ttpcreators.pro";

describe("creator-mail : appartenance d'un fil", () => {
  it("reconnaît l'alias dans To / Cc / From / Delivered-To, quelle que soit la casse", () => {
    expect(messageMatches(msg({ To: "Léa <LEA@ttpcreators.pro>" }), ALIAS, null)).toBe(true);
    expect(messageMatches(msg({ Cc: "a@b.com, lea@ttpcreators.pro" }), ALIAS, null)).toBe(true);
    expect(messageMatches(msg({ From: "TTP <lea@ttpcreators.pro>" }), ALIAS, null)).toBe(true);
    expect(messageMatches(msg({ "Delivered-To": "lea@ttpcreators.pro" }), ALIAS, null)).toBe(true);
  });

  it("refuse un alias voisin ou contenu dans une autre adresse", () => {
    expect(messageMatches(msg({ To: "clea@ttpcreators.pro" }), ALIAS, null)).toBe(false);
    expect(messageMatches(msg({ To: "lea@ttpcreators.pro.evil.com" }), ALIAS, null)).toBe(false);
    expect(messageMatches(msg({ To: "lea2@ttpcreators.pro" }), ALIAS, null)).toBe(false);
  });

  it("ignore l'alias cité dans le sujet ou un en-tête non adresse", () => {
    expect(messageMatches(msg({ Subject: "pour lea@ttpcreators.pro", To: "x@y.com" }), ALIAS, null)).toBe(false);
  });

  it("ignore brouillons, corbeille et spam", () => {
    expect(messageMatches(msg({ To: ALIAS }, ["DRAFT"]), ALIAS, null)).toBe(false);
    expect(messageMatches(msg({ To: ALIAS }, ["TRASH"]), ALIAS, null)).toBe(false);
    expect(messageMatches(msg({ To: ALIAS }, ["SPAM"]), ALIAS, null)).toBe(false);
  });

  it("accepte le libellé manuel même sans alias", () => {
    expect(messageMatches(msg({ To: "x@y.com" }, ["INBOX", "Label_42"]), "", "Label_42")).toBe(true);
    expect(messageMatches(msg({ To: "x@y.com" }, ["INBOX", "Label_7"]), "", "Label_42")).toBe(false);
  });

  it("sans alias valide ni libellé, rien ne correspond", () => {
    expect(messageMatches(msg({ To: ALIAS }), "pas-un-mail", null)).toBe(false);
    expect(threadMatches([msg({ To: ALIAS })], "", null)).toBe(false);
  });

  it("un fil appartient s'il contient au moins un message correspondant", () => {
    const t = [msg({ From: "marque@x.com", To: "talents@ttpcreators.pro" }), msg({ From: "talents@ttpcreators.pro", Cc: ALIAS })];
    expect(threadMatches(t, ALIAS, null)).toBe(true);
    expect(threadMatches(t, "autre@ttpcreators.pro", null)).toBe(false);
  });
});

describe("creator-mail : utilitaires", () => {
  it("normalise et valide les adresses", () => {
    expect(normEmail("  Lea@TTPcreators.pro ")).toBe("lea@ttpcreators.pro");
    expect(normEmail("lea")).toBe("");
    expect(normEmail("a b@c.d")).toBe("");
  });

  it("extrait toutes les adresses d'un en-tête", () => {
    expect(addressesIn('"Julie, Nike" <julie@nike.com>, b@c.fr')).toEqual(["julie@nike.com", "b@c.fr"]);
  });

  it("construit une requête Gmail sûre (ou vide)", () => {
    expect(aliasQuery("Lea@ttpcreators.pro")).toBe("{to:lea@ttpcreators.pro from:lea@ttpcreators.pro cc:lea@ttpcreators.pro deliveredto:lea@ttpcreators.pro}");
    expect(aliasQuery("x} OR in:anywhere {")).toBe("");
  });

  it("nom affichable et marque externe", () => {
    expect(displayName('"Julie Martin" <julie@nike.com>')).toBe("Julie Martin");
    expect(displayName("julie@nike.com")).toBe("julie@nike.com");
    const t = [msg({ From: "TTP <talents@ttpcreators.pro>", To: "partenariats@sephora.fr" })];
    expect(brandOf(t, "ttpcreators.pro")).toBe("Sephora");
    expect(brandOf([msg({ From: "Nike FR <julie@nike.com>" })], "ttpcreators.pro")).toBe("Nike FR");
  });

  it("valide les statuts", () => {
    expect(isMailStatus("negociation")).toBe(true);
    expect(isMailStatus("supprime")).toBe(false);
  });
});
