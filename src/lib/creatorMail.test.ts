import { describe, expect, it } from "vitest";
import {
  addressesIn, aliasQuery, brandOf, cleanComment, displayName, isMailStatus, messageMatches, normEmail, parseChoice,
  threadMatches, type GMessageLite,
} from "../../supabase/functions/creator-mail/logic.ts";
import { autoStatusOf, buildFeed, choiceOf, type MailNote, type MailStatusEvent } from "./creatorMail";

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

describe("creator-mail : ce que voit une créatrice (alias ou libellé)", () => {
  it("le libellé suffit, quelles que soient les adresses du message", () => {
    const t = [msg({ From: "marque@x.com", To: "talent@ttpcreators.pro" }, ["INBOX", "Label_42"])];
    expect(threadMatches(t, ALIAS, "Label_42")).toBe(true);
    expect(threadMatches(t, "", "Label_42")).toBe(true);
  });

  it("le libellé d'une autre créatrice ne donne accès à rien", () => {
    const t = [msg({ From: "marque@x.com", To: "talent@ttpcreators.pro" }, ["INBOX", "Label_7"])];
    expect(threadMatches(t, ALIAS, "Label_42")).toBe(false);
  });

  it("un libellé posé seulement sur un message à la corbeille ne donne plus accès", () => {
    const t = [msg({ To: "talent@ttpcreators.pro" }, ["INBOX"]), msg({ To: "talent@ttpcreators.pro" }, ["TRASH", "Label_42"])];
    expect(threadMatches(t, "", "Label_42")).toBe(false);
  });

  it("l'alias compte aussi en Cci, Reply-To et X-Original-To", () => {
    expect(messageMatches(msg({ Bcc: ALIAS }), ALIAS, null)).toBe(true);
    expect(messageMatches(msg({ "Reply-To": `Léa <${ALIAS}>` }), ALIAS, null)).toBe(true);
    expect(messageMatches(msg({ "X-Original-To": ALIAS }), ALIAS, null)).toBe(true);
  });

  it("un mail envoyé à deux alias est visible par les deux créatrices, pas par une troisième", () => {
    const t = [msg({ From: "marque@x.com", To: `${ALIAS}, chloe@ttpcreators.pro` })];
    expect(threadMatches(t, ALIAS, null)).toBe(true);
    expect(threadMatches(t, "chloe@ttpcreators.pro", null)).toBe(true);
    expect(threadMatches(t, "ines@ttpcreators.pro", null)).toBe(false);
  });

  it("l'adresse générale de l'agence ne fait pas tout voir à une créatrice", () => {
    const t = [msg({ From: "marque@x.com", To: "talent@ttpcreators.pro" })];
    expect(threadMatches(t, ALIAS, null)).toBe(false);
  });
});

describe("creator-mail : avis En cours / Validé / Refusé", () => {
  it("accepte les trois choix et l'ancien nom « annuler »", () => {
    expect(parseChoice("valide")).toBe("valide");
    expect(parseChoice("refuse")).toBe("refuse");
    expect(parseChoice("encours")).toBe("encours");
    expect(parseChoice("annuler")).toBe("encours");
    expect(parseChoice("nouvelle")).toBe(null);
    expect(parseChoice(undefined)).toBe(null);
    expect(parseChoice(["valide"])).toBe(null);
  });

  it("nettoie le mot facultatif (vide = rien, 1000 caractères max, émojis entiers)", () => {
    expect(cleanComment("  ok pour moi  ")).toBe("ok pour moi");
    expect(cleanComment("   ")).toBe(null);
    expect(cleanComment(42)).toBe(null);
    expect(cleanComment("a".repeat(1500))?.length).toBe(1000);
    const emojis = cleanComment("😀".repeat(1200)) ?? "";
    expect(Array.from(emojis).length).toBe(1000);
    expect(emojis.endsWith("😀")).toBe(true);
  });

  it("range les statuts dans les trois cases", () => {
    expect(choiceOf("nouvelle")).toBe("encours");
    expect(choiceOf("negociation")).toBe("encours");
    expect(choiceOf("valide")).toBe("valide");
    expect(choiceOf("refuse")).toBe("refuse");
  });

  it("statut automatique : « En négociation » dès que l'agence a répondu", () => {
    expect(autoStatusOf([{ fromAgency: false }])).toBe("nouvelle");
    expect(autoStatusOf([{ fromAgency: true }])).toBe("nouvelle"); // l'agence a écrit en premier
    expect(autoStatusOf([{ fromAgency: false }, { fromAgency: true }])).toBe("negociation");
  });
});

describe("creator-mail : suivi d'un échange", () => {
  const note = (id: string, at: string): MailNote => ({ id, body: id, created_at: at, agency_read_at: null });
  const ev = (id: string, at: string, status: MailStatusEvent["status"] = "valide"): MailStatusEvent =>
    ({ id, status, by_role: "creator", comment: null, created_at: at });

  it("mélange messages et changements de statut dans l'ordre", () => {
    const f = buildFeed(
      [note("n2", "2026-10-03T12:00:00Z"), note("n1", "2026-10-03T09:00:00Z")],
      [ev("e1", "2026-10-03T10:00:00Z")],
    );
    expect(f.map((x) => (x.kind === "note" ? x.note.id : x.event.id))).toEqual(["n1", "e1", "n2"]);
  });

  it("garde une décision prise avant l'historique", () => {
    const f = buildFeed([], [], { status: "refuse", decidedBy: "agency", decidedAt: "2026-10-02T08:00:00Z" });
    expect(f).toHaveLength(1);
    expect(f[0].kind === "event" && f[0].event.by_role).toBe("agency");
  });

  it("n'invente rien quand l'historique existe déjà ou sans décision", () => {
    expect(buildFeed([], [ev("e1", "2026-10-03T10:00:00Z")], { status: "valide", decidedBy: "creator", decidedAt: "2026-10-03T10:00:00Z" })).toHaveLength(1);
    expect(buildFeed([], [], { status: "negociation", decidedBy: null, decidedAt: null })).toHaveLength(0);
    expect(buildFeed([], null)).toHaveLength(0);
  });
});
