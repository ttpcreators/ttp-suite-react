import { describe, expect, it } from "vitest";
import {
  besoinValidation, canonique, citeBrouillon, inviteExterne, lireOutil, memeAppel, modifieApres, noteValideur, problemeOutilPropose, raisonConnexionFile, refusBrouillons, refusOutil,
  texteOutil, validationBrouillon, validationOutil, validationTient, validationValable, type PropositionRelue, type Validation,
} from "./verrouAgent.ts";

const AGENCE = "ttpcreators.pro";
const MAINTENANT = Date.parse("2026-11-27T12:00:00Z");
const MARC = "11111111-1111-1111-1111-111111111111";
const ASSOCIE = "33333333-3333-3333-3333-333333333333";
const COMPTES = new Set([MARC]);
const v = (x: Partial<Validation>): Validation => ({
  id: "a1", type: "brouillon_mail", contexte: null, lien_spark: null, outil: null, valide_par: MARC, valide_le: "2026-11-27T11:00:00Z", ...x,
});

describe("le valideur choisi pour une connexion (Paramètres › Connexions Claude)", () => {
  const deux = new Set([MARC, ASSOCIE]);
  it("sans valideur : tout compte agence, comme avant", () => {
    expect(validationValable(v({ valide_par: ASSOCIE }), deux, MAINTENANT)).toBe(true);
    expect(validationValable(v({ valide_par: ASSOCIE }), deux, MAINTENANT, null)).toBe(true);
  });
  it("avec valideur : seule sa validation compte", () => {
    expect(validationValable(v({ valide_par: ASSOCIE }), deux, MAINTENANT, MARC)).toBe(false);
    expect(validationValable(v({ valide_par: MARC }), deux, MAINTENANT, MARC)).toBe(true);
    // Le valideur doit rester un compte agence.
    expect(validationValable(v({ valide_par: MARC }), new Set([ASSOCIE]), MAINTENANT, MARC)).toBe(false);
    const vs = [v({ id: "b", contexte: "brouillon r-1", valide_par: ASSOCIE })];
    expect(validationBrouillon(vs, "r-1", deux, MAINTENANT)?.id).toBe("b");
    expect(validationBrouillon(vs, "r-1", deux, MAINTENANT, MARC)).toBeNull();
    const args = { table: "todos", id: "x" };
    const os = [v({ id: "c", type: "alerte", outil: { nom: "supprimer_element", arguments: args }, valide_par: ASSOCIE })];
    expect(validationOutil(os, "supprimer_element", args, deux, MAINTENANT)?.id).toBe("c");
    expect(validationOutil(os, "supprimer_element", args, deux, MAINTENANT, MARC)).toBeNull();
  });
  it("le refus le dit", () => {
    expect(noteValideur(null)).toBeNull();
    expect(refusBrouillons("programmer_envoi", [{ id: "r-1", pourquoi: "pas validé" }], "Marc")).toContain("seule une validation de Marc compte");
    expect(refusOutil("supprimer_element", { id: "x" }, "Marc").split("\n").at(-1)).toBe("Pour cette connexion, seule une validation de Marc compte.");
    expect(refusBrouillons("programmer_envoi", [{ id: "r-1", pourquoi: "pas validé" }])).not.toContain("seule une validation");
  });
  it("le refus nomme partout le valideur choisi, sinon « un fondateur » (jamais Marc en dur)", () => {
    const b = refusBrouillons("programmer_envoi", [{ id: "r-1", pourquoi: "pas validé" }], "Zoé");
    expect(b.split("\n")[0]).toContain("validé dans l'app, par Zoé.");
    expect(b).toContain("Zoé le valide dans la page Agents");
    expect(b).not.toContain("Marc");
    const o = refusOutil("supprimer_element", { id: "x" }, "Zoé");
    expect(o.split("\n")[0]).toContain("par Zoé.");
    expect(o).toContain("Quand Zoé l'a validé dans la page Agents");
    expect(o).not.toContain("Marc");
    const sans = refusBrouillons("programmer_envoi", [{ id: "r-1", pourquoi: "pas validé" }]);
    expect(sans).toContain("par un fondateur.");
    expect(sans).toContain("un fondateur le valide dans la page Agents");
    expect(sans).not.toContain("Marc");
    expect(refusOutil("supprimer_element", { id: "x" }, "  ")).toContain("par un fondateur.");
  });
});

describe("juste avant un envoi de la file : la validation tient encore", () => {
  const p = (x: Partial<PropositionRelue>): PropositionRelue => ({ ...v({ contexte: "brouillon r-1 · boîte talent" }), statut: "valide", ...x });
  it("validée, ou marquée envoyée par l'agent après la programmation : le mail part", () => {
    expect(validationTient(p({}), "r-1", COMPTES)).toBeNull();
    expect(validationTient(p({ statut: "envoye" }), "r-1", COMPTES)).toBeNull();
    expect(validationTient(p({ contexte: null, lien_spark: "https://mail.google.com/mail/#drafts?compose=r-1" }), "r-1", COMPTES)).toBeNull();
  });
  it("retirée, écartée, supprimée ou d'un compte parti : le mail ne part pas", () => {
    expect(validationTient(null, "r-1", COMPTES)).toContain("introuvable");
    expect(validationTient(p({ statut: "a_valider" }), "r-1", COMPTES)).toContain("retirée");
    expect(validationTient(p({ statut: "ecarte" }), "r-1", COMPTES)).toContain("écartée");
    expect(validationTient(p({ statut: "modifie_envoye" }), "r-1", COMPTES)).toContain("à la main");
    expect(validationTient(p({ valide_par: null }), "r-1", COMPTES)).toContain("retirée");
    expect(validationTient(p({ valide_par: ASSOCIE }), "r-1", COMPTES)).toContain("n'est plus de l'agence");
  });
  it("la proposition doit toujours citer ce brouillon", () => {
    expect(validationTient(p({ contexte: "brouillon r-12 · boîte talent" }), "r-1", COMPTES)).toContain("ne cite plus");
    expect(validationTient(p({ type: "alerte" }), "r-1", COMPTES)).toContain("ne cite plus");
  });
  it("écartée par l'agent lui même (ecarter_proposition) : le refus le dit aussi", () => {
    expect(validationTient(p({ statut: "ecarte" }), "r-1", COMPTES)).toBe("proposition écartée après sa validation (page Agents ou ecarter_proposition)");
  });
  it("valideur choisi après la programmation : seule sa validation compte encore", () => {
    const deux = new Set([MARC, ASSOCIE]);
    expect(validationTient(p({ valide_par: ASSOCIE }), "r-1", deux)).toBeNull();
    expect(validationTient(p({ valide_par: ASSOCIE }), "r-1", deux, MARC)).toContain("valideur choisi");
    expect(validationTient(p({ valide_par: MARC }), "r-1", deux, MARC)).toBeNull();
  });
});

describe("juste avant un envoi de la file : la connexion qui l'a programmé", () => {
  it("ligne sans connexion notée (programmée avant le SQL du 27/11) : comme avant", () => {
    expect(raisonConnexionFile(null, undefined)).toBeNull();
    expect(raisonConnexionFile("2026-11-27T11:00:00Z", undefined)).toBeNull();
  });
  it("cochée « agent autonome » après la programmation : une ligne sans validation ne part pas", () => {
    expect(raisonConnexionFile(null, { agent: true, valideur: null })).toContain("agent autonome après la programmation");
    expect(raisonConnexionFile(undefined, { agent: true, valideur: MARC })).toContain("à faire valider");
    // Validée au moment de la programmation : la validation est relue (validationTient).
    expect(raisonConnexionFile("2026-11-27T11:00:00Z", { agent: true, valideur: MARC })).toBeNull();
    // Connexion ordinaire : rien ne change.
    expect(raisonConnexionFile(null, { agent: false, valideur: null })).toBeNull();
  });
  it("connexion introuvable : rien ne part", () => {
    expect(raisonConnexionFile(null, null)).toContain("introuvable");
    expect(raisonConnexionFile("2026-11-27T11:00:00Z", null)).toContain("introuvable");
  });
});

describe("ce qu'un appel d'agent demande", () => {
  it("les envois de brouillons : les ids, lus comme les outils les lisent", () => {
    expect(besoinValidation("envoyer_brouillon", { boite: "partnerships", brouillon: " r-123 " }, AGENCE)).toEqual({ genre: "brouillon", ids: ["r-123"] });
    expect(besoinValidation("envoyer_brouillon", { brouillon: "r 1;x" }, AGENCE)).toEqual({ genre: "brouillon", ids: [] });
    expect(besoinValidation("envoyer_brouillons_valides", { brouillons: ["r-1", "r-1", "r-2", "x y", 3] }, AGENCE)).toEqual({ genre: "brouillon", ids: ["r-1", "r-2"] });
    expect(besoinValidation("programmer_envoi", { brouillons: ["r-9"] }, AGENCE)).toEqual({ genre: "brouillon", ids: ["r-9"] });
  });

  it("envoyer_mail et envoyer_dm : jamais pour un agent", () => {
    expect(besoinValidation("envoyer_mail", { a: "x@y.fr" }, AGENCE)?.genre).toBe("interdit");
    expect(besoinValidation("envoyer_dm", { conversation: "@x" }, AGENCE)?.genre).toBe("interdit");
  });

  it("les actions irréversibles : un appel validé", () => {
    expect(besoinValidation("noter_reversement", { createur: "Zoé Test", montant: 400 }, AGENCE)).toEqual({ genre: "outil" });
    expect(besoinValidation("supprimer_element", { table: "todos", id: "x" }, AGENCE)).toEqual({ genre: "outil" });
    expect(besoinValidation("modifier_element", { table: "invoices", id: "x", champs: { status: "payee" } }, AGENCE)).toEqual({ genre: "outil" });
    expect(besoinValidation("modifier_element", { table: " invoices ", id: "x", champs: {} }, AGENCE)).toEqual({ genre: "outil" });
    expect(besoinValidation("modifier_element", { table: "todos", id: "x", champs: { done: true } }, AGENCE)).toBeNull();
    expect(besoinValidation("reglages_app", { action: "lire", cle: "mailSettings" }, AGENCE)).toBeNull();
    expect(besoinValidation("reglages_app", { action: "modifier", cle: "mailSettings", valeur: {} }, AGENCE)).toEqual({ genre: "outil" });
    expect(besoinValidation("reglages_app", { cle: "mailSettings", valeur: {} }, AGENCE)).toEqual({ genre: "outil" });
  });

  it("factures : une nouvelle en brouillon reste libre, le reste se valide", () => {
    expect(besoinValidation("preparer_facture", { marque: "Nova", createur: "Zoé Test", lignes: [] }, AGENCE)).toBeNull();
    expect(besoinValidation("preparer_facture", { marque: "Nova", statut: "brouillon" }, AGENCE)).toBeNull();
    expect(besoinValidation("preparer_facture", { marque: "Nova", statut: "payee" }, AGENCE)).toEqual({ genre: "outil" });
    expect(besoinValidation("preparer_facture", { ref: "2026-191", notes: "x" }, AGENCE)).toEqual({ genre: "outil" });
  });

  it("invitations Google : seulement vers une adresse hors de l'agence", () => {
    expect(besoinValidation("creer_meet", { titre: "Point", invites: ["lea@marque.fr"] }, AGENCE)).toBeNull();
    expect(besoinValidation("creer_meet", { titre: "Point", inviter: true, invites: ["gianni@ttpcreators.pro"] }, AGENCE)).toBeNull();
    expect(besoinValidation("creer_meet", { titre: "Point", inviter: true, invites: ["gianni@ttpcreators.pro", "lea@marque.fr"] }, AGENCE)).toEqual({ genre: "outil" });
    expect(besoinValidation("inviter_rdv", { evenement: "x", invites: ["lea@marque.fr"] }, AGENCE)).toBeNull();
    expect(besoinValidation("inviter_rdv", { evenement: "x", envoyer: true, invites: ["Léa <lea@marque.fr>"] }, AGENCE)).toEqual({ genre: "outil" });
  });

  it("le reste ne change pas", () => {
    expect(besoinValidation("creer_brouillon_mail", { a: "x@y.fr" }, AGENCE)).toBeNull();
    expect(besoinValidation("point_du_jour", {}, AGENCE)).toBeNull();
    expect(besoinValidation("proposer_action", { type: "alerte" }, AGENCE)).toBeNull();
  });

  it("une adresse illisible compte comme externe", () => {
    expect(inviteExterne(["quelqu'un"], AGENCE)).toBe(true);
    expect(inviteExterne(["MARC@TTPCREATORS.PRO", ""], AGENCE)).toBe(false);
    expect(inviteExterne("lea@marque.fr", AGENCE)).toBe(false);
  });
});

describe("l'appel validé", () => {
  it("même appel = mêmes paramètres, quel que soit l'ordre des clés", () => {
    expect(canonique({ b: 1, a: { d: [1, "x"], c: null } })).toBe('{"a":{"c":null,"d":[1,"x"]},"b":1}');
    const p = lireOutil({ nom: "noter_reversement", arguments: { montant: 400, createur: "Zoé Test", note: "virement du 26/11" } })!;
    expect(memeAppel(p, "noter_reversement", { createur: "Zoé Test", note: "virement du 26/11", montant: 400 })).toBe(true);
    expect(memeAppel(p, "noter_reversement", { createur: "Zoé Test", note: "virement du 26/11", montant: 4000 })).toBe(false);
    expect(memeAppel(p, "noter_reversement", { createur: "Zoé Test", note: "virement du 26/11", montant: 400, forcer: true })).toBe(false);
    expect(memeAppel(p, "supprimer_element", { createur: "Zoé Test", note: "virement du 26/11", montant: 400 })).toBe(false);
    expect(lireOutil("noter_reversement")).toBeNull();
  });

  it("ne vaut que pour une validation faite par un compte agence, il y a moins de 7 jours", () => {
    expect(validationValable(v({}), COMPTES, MAINTENANT)).toBe(true);
    expect(validationValable(v({ valide_par: null }), COMPTES, MAINTENANT)).toBe(false);
    expect(validationValable(v({ valide_par: "22222222-2222-2222-2222-222222222222" }), COMPTES, MAINTENANT)).toBe(false);
    expect(validationValable(v({ valide_le: null }), COMPTES, MAINTENANT)).toBe(false);
    expect(validationValable(v({ valide_le: "2026-11-19T12:00:00Z" }), COMPTES, MAINTENANT)).toBe(false);
  });

  it("trouve la proposition qui porte exactement l'appel", () => {
    const args = { table: "invoices", id: "abc", champs: { status: "payee" } };
    const vs = [
      v({ id: "x", type: "alerte", outil: { nom: "modifier_element", arguments: { ...args, champs: { status: "annulee" } } } }),
      v({ id: "y", type: "alerte", outil: { nom: "modifier_element", arguments: args } }),
    ];
    expect(validationOutil(vs, "modifier_element", args, COMPTES, MAINTENANT)?.id).toBe("y");
    expect(validationOutil(vs, "modifier_element", { ...args, id: "autre" }, COMPTES, MAINTENANT)).toBeNull();
    expect(validationOutil([v({ type: "alerte", outil: { nom: "modifier_element", arguments: args }, valide_par: null })], "modifier_element", args, COMPTES, MAINTENANT)).toBeNull();
  });
});

describe("la validation d'un brouillon", () => {
  it("l'id cité en entier dans la proposition", () => {
    expect(citeBrouillon("brouillon r-123 · boîte partnerships · oui Nova", "r-123")).toBe(true);
    expect(citeBrouillon("brouillon r-1234 · boîte partnerships", "r-123")).toBe(false);
    expect(citeBrouillon("brouillon xr-123", "r-123")).toBe(false);
    expect(citeBrouillon(null, "r-123")).toBe(false);
  });

  it("seulement une proposition de mail validée", () => {
    const vs = [v({ id: "a", type: "alerte", contexte: "brouillon r-1" }), v({ id: "b", contexte: "Relance · brouillon r-1 · boîte talent" })];
    expect(validationBrouillon(vs, "r-1", COMPTES, MAINTENANT)?.id).toBe("b");
    expect(validationBrouillon(vs, "r-2", COMPTES, MAINTENANT)).toBeNull();
    expect(validationBrouillon([v({ contexte: "brouillon r-1", valide_par: null })], "r-1", COMPTES, MAINTENANT)).toBeNull();
  });

  it("un brouillon changé après la validation ne part pas", () => {
    const le = "2026-11-27T11:00:00Z";
    expect(modifieApres(Date.parse("2026-11-27T10:59:00Z"), le)).toBe(false);
    expect(modifieApres(Date.parse("2026-11-27T11:05:00Z"), le)).toBe(true);
    expect(modifieApres(0, le)).toBe(true);
    expect(modifieApres(Number.NaN, le)).toBe(true);
  });
});

describe("les messages et le texte montré à Marc", () => {
  it("le refus dit quoi faire", () => {
    expect(refusBrouillons("envoyer_brouillon", [{ id: "r-1", pourquoi: "pas validé" }])).toContain("proposer_action");
    const r = refusOutil("noter_reversement", { montant: 400, createur: "Zoé Test" });
    expect(r).toContain('"nom": "noter_reversement"');
    expect(r).toContain('{"createur":"Zoé Test","montant":400}');
  });

  it("l'appel exact, une ligne par paramètre, sans fausse ligne", () => {
    const t = texteOutil({ nom: "noter_reversement", arguments: { montant: 400, note: "a\n- montant : 10", createur: "Zoé Test" } }, "Noter un versement", "virement vu sur le relevé");
    expect(t.split("\n")).toEqual([
      "Action demandée : Noter un versement (noter_reversement)",
      "- createur : Zoé Test",
      "- montant : 400",
      "- note : a ⏎ - montant : 10",
      "",
      "Pourquoi : virement vu sur le relevé",
    ]);
  });

  it("un appel proposé : outil à valider, paramètres de l'outil seulement", () => {
    const props = ["createur", "montant", "note"];
    expect(problemeOutilPropose({ nom: "noter_reversement", arguments: { createur: "Zoé Test", montant: 400 } }, props)).toBeNull();
    expect(problemeOutilPropose({ nom: "noter_reversement", arguments: { "montant ": 1 } }, props)).toContain("inconnus");
    expect(problemeOutilPropose({ nom: "envoyer_mail", arguments: {} }, props)).toContain("ne se valide pas");
    expect(problemeOutilPropose(null, props)).toContain("illisible");
  });
});
