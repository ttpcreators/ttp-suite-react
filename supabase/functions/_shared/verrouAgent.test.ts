import { describe, expect, it } from "vitest";
import {
  OUTILS_A_VALIDER, besoinValidation, brouillonCite, brouillonDe, canonique, citeBrouillon, empreinteBrouillon, empreinteChangee, inviteExterne, lireOutil, memeAppel, memeConnexion,
  modifieApres, noteValideur, problemeOutilPropose, propositionBrouillon, raisonConnexionFile, refusBrouillons, refusOutil,
  texteOutil, validationBrouillon, validationOutil, validationTient, validationValable, type BrouillonComplet, type PropositionRelue, type Validation,
} from "./verrouAgent.ts";

const AGENCE = "ttpcreators.pro";
const MAINTENANT = Date.parse("2026-11-27T12:00:00Z");
const MARC = "11111111-1111-1111-1111-111111111111";
const ASSOCIE = "33333333-3333-3333-3333-333333333333";
const COMPTES = new Set([MARC]);
const GRANT = "44444444-4444-4444-4444-444444444444";
const AUTRE_GRANT = "55555555-5555-5555-5555-555555555555";
const v = (x: Partial<Validation>): Validation => ({
  id: "a1", type: "brouillon_mail", contexte: null, lien_spark: null, outil: null, valide_par: MARC, valide_le: "2026-11-27T11:00:00Z", grant_id: GRANT, ...x,
});
/** Ce que la page Agents montre (le test échoue si la proposition est refusée). */
const montre = (b: BrouillonComplet, note = "") => {
  const r = propositionBrouillon(b, "partnerships", "r-1", note);
  if ("erreur" in r) throw new Error(r.erreur);
  return r;
};
/** Le brouillon rangé par le serveur dans une proposition de mail. */
const rangé = (brouillon: string, boite = "talent", empreinte = "e1") => ({ nom: "envoyer_brouillon", arguments: { boite, brouillon }, empreinte });

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
    const vs = [v({ id: "b", outil: rangé("r-1"), valide_par: ASSOCIE })];
    expect(validationBrouillon(vs, "r-1", "talent", deux, MAINTENANT, null, GRANT)?.id).toBe("b");
    expect(validationBrouillon(vs, "r-1", "talent", deux, MAINTENANT, MARC, GRANT)).toBeNull();
    const args = { table: "todos", id: "x" };
    const os = [v({ id: "c", type: "alerte", outil: { nom: "supprimer_element", arguments: args }, valide_par: ASSOCIE })];
    expect(validationOutil(os, "supprimer_element", args, deux, MAINTENANT, null, GRANT)?.id).toBe("c");
    expect(validationOutil(os, "supprimer_element", args, deux, MAINTENANT, MARC, GRANT)).toBeNull();
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
    // Proposition du serveur : le brouillon rangé dans outil.
    expect(validationTient(p({ contexte: "autre texte", outil: rangé("r-1") }), "r-1", COMPTES)).toBeNull();
  });
  it("un id caché dans le lien ne vaut plus validation", () => {
    expect(validationTient(p({ contexte: null, lien_spark: "https://mail.google.com/mail/#drafts?compose=r-1" }), "r-1", COMPTES)).toContain("ne cite plus");
    // Proposition du serveur pour un autre brouillon : son contexte ne compte pas.
    expect(validationTient(p({ contexte: "brouillon r-1", outil: rangé("r-2") }), "r-1", COMPTES)).toContain("ne cite plus");
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
    expect(besoinValidation("modifier_element", { table: "creator_mail_settings", id: "x", champs: { aliases: ["a@b.fr"] } }, AGENCE)).toEqual({ genre: "outil" });
    expect(besoinValidation("modifier_element", { table: "documents", id: "x", champs: { creator: "Zoé Test" } }, AGENCE)).toEqual({ genre: "outil" });
    expect(besoinValidation("modifier_element", { table: "collabs", id: "x", champs: { cachet: "900" } }, AGENCE)).toEqual({ genre: "outil" });
    expect(besoinValidation("modifier_element", { table: "collabs", id: "x", champs: { notes: "relancée" } }, AGENCE)).toBeNull();
    expect(besoinValidation("modifier_element", { table: "prospects", id: "x", champs: { value: "2000" } }, AGENCE)).toEqual({ genre: "outil" });
    // L'étape du pipeline (Signé, Perdu) se valide aussi.
    expect(besoinValidation("modifier_element", { table: "prospects", id: "x", champs: { stage: "Signé" } }, AGENCE)).toEqual({ genre: "outil" });
    expect(besoinValidation("modifier_element", { table: "prospects", id: "x", champs: { notes: "relancé" } }, AGENCE)).toBeNull();
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
    expect(besoinValidation("creer_meet", { titre: "Point", inviter: true, invites: ["equipe@ttpcreators.pro"] }, AGENCE)).toBeNull();
    expect(besoinValidation("creer_meet", { titre: "Point", inviter: true, invites: ["equipe@ttpcreators.pro", "lea@marque.fr"] }, AGENCE)).toEqual({ genre: "outil" });
    expect(besoinValidation("inviter_rdv", { evenement: "x", envoyer: true, invites: ["Léa <lea@marque.fr>"] }, AGENCE)).toEqual({ genre: "outil" });
    expect(besoinValidation("inviter_rdv", { evenement: "x", invites: ["equipe@ttpcreators.pro"] }, AGENCE)).toBeNull();
    expect(besoinValidation("inviter_rdv", { evenement: "x", lien_meet: true }, AGENCE)).toBeNull();
  });

  it("inviter_rdv en deux appels : l'ajout d'un externe sans mail se valide, et tout envoi", () => {
    expect(besoinValidation("inviter_rdv", { evenement: "x", invites: ["lea@marque.fr"] }, AGENCE)).toEqual({ genre: "outil" });
    expect(besoinValidation("inviter_rdv", { evenement: "x", envoyer: true, invites: ["equipe@ttpcreators.pro"] }, AGENCE)).toEqual({ genre: "outil" });
  });

  it("argent, accès, consignes durables, pages publiques et crédits : un appel validé", () => {
    for (const nom of ["noter_lecon", "ajouter_modele", "lien_boite_createur", "lien_connexion_instagram", "maj_chiffres_mediakit", "trouver_emails_marque", "trouver_email_personne", "scanner_base_createurs", "importer_historique_instagram"]) {
      expect(besoinValidation(nom, {}, AGENCE)).toEqual({ genre: "outil" });
    }
    expect(besoinValidation("avancer_collab", { collab: "x", etape: 7 }, AGENCE)).toBeNull();
    expect(besoinValidation("avancer_collab", { collab: "x", etape: 8 }, AGENCE)).toEqual({ genre: "outil" });
    expect(besoinValidation("avancer_collab", { collab: "x", etape: 3, revenir: true }, AGENCE)).toEqual({ genre: "outil" });
    expect(besoinValidation("avancer_collab", { collab: "x", etape: "?" }, AGENCE)).toEqual({ genre: "outil" });
    // Lue comme l'outil la lit (arrondie) : 7,5 donne l'étape 8.
    expect(besoinValidation("avancer_collab", { collab: "x", etape: 7.5 }, AGENCE)).toEqual({ genre: "outil" });
    expect(besoinValidation("avancer_collab", { collab: "x", etape: "7.6" }, AGENCE)).toEqual({ genre: "outil" });
    expect(besoinValidation("avancer_collab", { collab: "x", etape: 7.4 }, AGENCE)).toBeNull();
    expect(besoinValidation("creer_element", { table: "todos", champs: { text: "x" } }, AGENCE)).toBeNull();
    expect(besoinValidation("creer_element", { table: "collabs", champs: { brand: "Nova" } }, AGENCE)).toBeNull();
    expect(besoinValidation("creer_element", { table: "collabs", champs: { brand: "Nova", cachet: "800" } }, AGENCE)).toEqual({ genre: "outil" });
    // Une collab créée déjà avancée se valide comme avancer_collab.
    expect(besoinValidation("creer_element", { table: "collabs", champs: { brand: "Nova", step: 10 } }, AGENCE)).toEqual({ genre: "outil" });
    expect(besoinValidation("creer_element", { table: "collabs", champs: { brand: "Nova", step: 7.5 } }, AGENCE)).toEqual({ genre: "outil" });
    expect(besoinValidation("creer_element", { table: "collabs", champs: { brand: "Nova", status: "gagnee" } }, AGENCE)).toEqual({ genre: "outil" });
    expect(besoinValidation("creer_element", { table: "collabs", champs: { brand: "Nova", step: 2, status: "active" } }, AGENCE)).toBeNull();
    expect(besoinValidation("creer_element", { table: "events", champs: { title: "x" } }, AGENCE)).toEqual({ genre: "outil" });
    expect(besoinValidation("noter_droits", { marque: "Nova", note: "x" }, AGENCE)).toBeNull();
    expect(besoinValidation("noter_droits", { id: "x", prix: "300" }, AGENCE)).toEqual({ genre: "outil" });
    expect(besoinValidation("noter_droits", { id: "x", clos: true }, AGENCE)).toEqual({ genre: "outil" });
    expect(besoinValidation("memoire_createur", { createur: "Zoé Test" }, AGENCE)).toBeNull();
    expect(besoinValidation("memoire_createur", { createur: "Zoé Test", info: "voyage" }, AGENCE)).toEqual({ genre: "outil" });
    // Chaque outil qui peut demander une validation se propose avec `outil`.
    for (const nom of ["avancer_collab", "creer_element", "noter_droits", "memoire_createur", "noter_lecon"]) expect(OUTILS_A_VALIDER).toContain(nom);
  });

  it("le reste ne change pas", () => {
    expect(besoinValidation("creer_brouillon_mail", { a: "x@y.fr" }, AGENCE)).toBeNull();
    expect(besoinValidation("point_du_jour", {}, AGENCE)).toBeNull();
    expect(besoinValidation("proposer_action", { type: "alerte" }, AGENCE)).toBeNull();
  });

  it("une adresse illisible compte comme externe", () => {
    expect(inviteExterne(["quelqu'un"], AGENCE)).toBe(true);
    expect(inviteExterne(["EQUIPE@TTPCREATORS.PRO", ""], AGENCE)).toBe(false);
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
    expect(validationOutil(vs, "modifier_element", args, COMPTES, MAINTENANT, null, GRANT)?.id).toBe("y");
    expect(validationOutil(vs, "modifier_element", { ...args, id: "autre" }, COMPTES, MAINTENANT, null, GRANT)).toBeNull();
    expect(validationOutil([v({ type: "alerte", outil: { nom: "modifier_element", arguments: args }, valide_par: null })], "modifier_element", args, COMPTES, MAINTENANT, null, GRANT)).toBeNull();
  });

  it("ne sert qu'à la connexion qui l'a proposée", () => {
    const args = { table: "invoices", id: "abc", champs: { status: "payee" } };
    const vs = [v({ type: "alerte", outil: { nom: "modifier_element", arguments: args } })];
    expect(validationOutil(vs, "modifier_element", args, COMPTES, MAINTENANT, null, AUTRE_GRANT)).toBeNull();
    expect(validationOutil([v({ type: "alerte", outil: { nom: "modifier_element", arguments: args }, grant_id: null })], "modifier_element", args, COMPTES, MAINTENANT, null, GRANT)).toBeNull();
    expect(memeConnexion(v({}), GRANT)).toBe(true);
    expect(memeConnexion(v({}), "")).toBe(false);
  });
});

describe("la validation d'un brouillon", () => {
  it("l'id cité en entier dans la proposition", () => {
    expect(citeBrouillon("brouillon r-123 · boîte partnerships · oui Nova", "r-123")).toBe(true);
    expect(citeBrouillon("brouillon r-1234 · boîte partnerships", "r-123")).toBe(false);
    expect(citeBrouillon("brouillon xr-123", "r-123")).toBe(false);
    expect(citeBrouillon(null, "r-123")).toBe(false);
  });

  it("seulement la proposition de mail où le serveur a rangé ce brouillon", () => {
    const vs = [v({ id: "a", type: "alerte", outil: rangé("r-1") }), v({ id: "b", outil: rangé("r-1") })];
    expect(validationBrouillon(vs, "r-1", "talent", COMPTES, MAINTENANT, null, GRANT)?.id).toBe("b");
    expect(validationBrouillon(vs, "r-2", "talent", COMPTES, MAINTENANT, null, GRANT)).toBeNull();
    expect(validationBrouillon(vs, "r-1", "partnerships", COMPTES, MAINTENANT, null, GRANT)).toBeNull();
    expect(validationBrouillon(vs, "r-1", "talent", COMPTES, MAINTENANT, null, AUTRE_GRANT)).toBeNull();
    expect(validationBrouillon([v({ outil: rangé("r-1"), valide_par: null })], "r-1", "talent", COMPTES, MAINTENANT, null, GRANT)).toBeNull();
  });

  it("un id cité dans le contexte ou caché dans le lien ne vaut plus validation", () => {
    const vs = [v({ contexte: "brouillon r-111 · boîte talent", lien_spark: "https://exemple.test/?compose=r-444" })];
    expect(validationBrouillon(vs, "r-111", "talent", COMPTES, MAINTENANT, null, GRANT)).toBeNull();
    expect(validationBrouillon(vs, "r-444", "talent", COMPTES, MAINTENANT, null, GRANT)).toBeNull();
    // Un agent ne peut pas ranger lui même un brouillon (pas d'empreinte, ou un autre type).
    expect(brouillonDe({ type: "brouillon_mail", outil: { nom: "envoyer_brouillon", arguments: { boite: "talent", brouillon: "r-1" } } })).toBeNull();
    expect(brouillonDe({ type: "alerte", outil: rangé("r-1") })).toBeNull();
    expect(problemeOutilPropose({ nom: "envoyer_brouillon", arguments: { boite: "talent", brouillon: "r-1" } }, ["boite", "brouillon"])).toContain("ne se valide pas");
  });

  it("le brouillon cité par l'agent : un seul par proposition", () => {
    expect(brouillonCite({ contexte: "brouillon r-1 · boîte talent" })).toEqual({ brouillon: "r-1", boite: "talent", cite: true });
    expect(brouillonCite({ brouillon: "r-2", boite: "partnerships", contexte: "brouillon r-1 · brouillon r-3" })).toEqual({ brouillon: "r-2", boite: "partnerships", cite: true });
    expect(brouillonCite({ contexte: "brouillon r-1 · boîte talent · brouillon r-2 · boîte talent" })).toHaveProperty("erreur");
    expect(brouillonCite({ contexte: "Relance Nova" })).toMatchObject({ cite: false });
    expect(brouillonCite({ brouillon: "r 1;x", boite: "talent" })).toHaveProperty("erreur");
    expect(brouillonCite({ brouillon: "r-1" })).toMatchObject({ cite: true });
    expect(brouillonCite({ brouillon: "r-1" })).toHaveProperty("erreur");
  });

  it("seule la forme « brouillon <id> · boîte <boîte> » compte dans le contexte", () => {
    // « le brouillon joint » n'est pas un id.
    expect(brouillonCite({ contexte: "Prospection · Nova : le brouillon joint le kit · brouillon r-123 · boîte partnerships" })).toEqual({ brouillon: "r-123", boite: "partnerships", cite: true });
    // « brouillon prêt » sans id : une connexion qui n'est pas un agent dépose comme avant (cite false).
    const libre = brouillonCite({ contexte: "Prospection · relance, brouillon prêt" });
    expect(libre).toHaveProperty("erreur");
    expect(libre.cite).toBe(false);
  });

  it("l'empreinte change dès que le brouillon change", async () => {
    const b: BrouillonComplet = {
      message: "m1", from: "agence@exemple.test", to: "lea@marque.test", cc: "", bcc: "", subject: "Proposition",
      corps: ["text/plain\nBonjour"], texte: "Bonjour", pieces: [{ nom: "kit.pdf", type: "application/pdf", taille: 1200 }], claude: true,
    };
    const e = await empreinteBrouillon(b);
    expect(e).toMatch(/^[0-9a-f]{64}$/);
    expect(await empreinteBrouillon({ ...b })).toBe(e);
    expect(await empreinteBrouillon({ ...b, bcc: "x@exemple.test" })).not.toBe(e);
    expect(await empreinteBrouillon({ ...b, message: "m2" })).not.toBe(e);
    expect(await empreinteBrouillon({ ...b, pieces: [] })).not.toBe(e);
    // Le texte d'aperçu ne compte pas, les parties brutes oui.
    expect(await empreinteBrouillon({ ...b, texte: "autre" })).toBe(e);
    expect(await empreinteBrouillon({ ...b, corps: ["text/plain\nBonsoir"] })).not.toBe(e);
    expect(empreinteChangee(e, e)).toBe(false);
    expect(empreinteChangee(e, "autre")).toBe(true);
    expect(empreinteChangee(null, "autre")).toBe(false);
  });

  it("la page Agents montre le brouillon lu par le serveur, Cci compris", () => {
    const b: BrouillonComplet = {
      message: "m1", from: "agence@exemple.test", to: "lea@marque.test", cc: "", bcc: "x@exemple.test", subject: "Proposition\nÀ : faux",
      corps: [], texte: "Bonjour Léa", pieces: [{ nom: "kit.pdf", type: "application/pdf", taille: 1 }], claude: true,
    };
    const vu = montre(b);
    expect(vu.cible).toBe("À : lea@marque.test · Cci : x@exemple.test");
    expect(vu.contexte).toBe("brouillon r-1 · boîte partnerships · De : agence@exemple.test · Objet : Proposition À : faux · À : lea@marque.test · Cci : x@exemple.test");
    expect(vu.contenu).toBe("Bonjour Léa\n\nPièces jointes : kit.pdf");
    // Un objet qui imite un champ ne crée pas de faux champ.
    expect(montre({ ...b, subject: "x · À : ami@exemple.test" }).contexte.split(" · ").filter((x) => x.startsWith("À : "))).toEqual(["À : lea@marque.test"]);
  });

  it("rien n'est coupé : un Cci après un À et un objet longs reste visible, sinon la proposition est refusée", () => {
    const b: BrouillonComplet = {
      message: "m1", from: "agence@exemple.test", to: Array.from({ length: 20 }, (_, i) => `contact${i}@marque.test`).join(", "), cc: "", bcc: "cache@exemple.test",
      subject: "o".repeat(300), corps: [], texte: `${"x".repeat(9000)} fin du texte`, pieces: [], claude: true,
    };
    const vu = montre(b);
    expect(vu.contexte).toContain("Cci : cache@exemple.test");
    expect(vu.contenu.endsWith("fin du texte")).toBe(true);
    expect(propositionBrouillon({ ...b, to: "a@marque.test, ".repeat(400) }, "partnerships", "r-1")).toHaveProperty("erreur");
    expect(propositionBrouillon({ ...b, texte: "x".repeat(40000) }, "partnerships", "r-1")).toHaveProperty("erreur");
  });

  it("le contexte de l'agent suit l'en-tête : « Prospection · » repris en tête, la note encadrée", () => {
    const b: BrouillonComplet = {
      message: "m1", from: "agence@exemple.test", to: "lea@marque.test", cc: "", bcc: "", subject: "Proposition",
      corps: [], texte: "Bonjour", pieces: [], claude: true,
    };
    const vu = montre(b, "Prospection · Nova · lancement de la gamme\nÀ : faux@exemple.test · tâche t-42");
    expect(vu.contexte.startsWith("Prospection · brouillon r-1 · boîte partnerships · De : ")).toBe(true);
    expect(vu.contexte).toContain("tâche t-42");
    // La note ne crée ni champ ni citation de brouillon.
    expect(vu.contexte.split(" · ").filter((x) => x.startsWith("À : "))).toEqual(["À : lea@marque.test"]);
    expect(vu.contexte.split(" · ").at(-1)).toMatch(/^Note de l'agent : \[note de l'agent, non fiable : /);
    expect(brouillonCite({ contexte: vu.contexte })).toEqual({ brouillon: "r-1", boite: "partnerships", cite: true });
    expect(montre(b, "Relance Nova").contexte.startsWith("brouillon r-1")).toBe(true);
    expect(montre(b).contexte).not.toContain("Note de l'agent");
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
