import { describe, expect, it } from "vitest";
import { REGLES, adresses, cleSociete, coupeCircuit, dansLaFenetre, ligneFile, planifier, prochainCreneau, quandCourt, raisonDeBloquer, rebondsDuJournal, rebondsQuiComptent, texteListe } from "./fileEnvoi.ts";

// Le mercredi 25 novembre 2026, Paris est à UTC+1.
const at = (iso: string) => new Date(iso);

describe("file d'envoi : heures d'envoi", () => {
  it("jours ouvrés, de 8 h 30 à 18 h 30 à Paris", () => {
    expect(dansLaFenetre(at("2026-11-25T07:29:00Z"))).toBe(false); // 8 h 29
    expect(dansLaFenetre(at("2026-11-25T07:30:00Z"))).toBe(true); // 8 h 30
    expect(dansLaFenetre(at("2026-11-25T17:29:00Z"))).toBe(true); // 18 h 29
    expect(dansLaFenetre(at("2026-11-25T17:30:00Z"))).toBe(false); // 18 h 30
    expect(dansLaFenetre(at("2026-11-28T10:00:00Z"))).toBe(false); // samedi
  });
  it("le prochain créneau : tout de suite, plus tard le jour même, ou lundi", () => {
    expect(prochainCreneau(at("2026-11-25T10:00:00Z")).toISOString()).toBe("2026-11-25T10:00:00.000Z");
    expect(prochainCreneau(at("2026-11-25T05:00:00Z")).toISOString()).toBe("2026-11-25T07:30:00.000Z");
    expect(prochainCreneau(at("2026-11-25T19:00:00Z")).toISOString()).toBe("2026-11-26T07:30:00.000Z");
    expect(prochainCreneau(at("2026-11-27T18:00:00Z")).toISOString()).toBe("2026-11-30T07:30:00.000Z"); // vendredi soir → lundi
  });
});

describe("file d'envoi : planification", () => {
  const fixe = () => 0.5; // écart de 5 minutes
  it("espace les mails de 3 à 7 minutes, à partir d'une minute après maintenant", () => {
    const t = planifier(3, at("2026-11-25T09:00:00Z"), [], REGLES, fixe).map((d) => d.toISOString());
    expect(t).toEqual(["2026-11-25T09:01:00.000Z", "2026-11-25T09:06:00.000Z", "2026-11-25T09:11:00.000Z"]);
  });
  it("part après les mails déjà prévus de la boîte", () => {
    const t = planifier(1, at("2026-11-25T09:00:00Z"), [at("2026-11-25T11:00:00Z")], REGLES, fixe);
    expect(t[0].toISOString()).toBe("2026-11-25T11:03:00.000Z");
  });
  it("la nuit : le lendemain à 8 h 30", () => {
    expect(planifier(1, at("2026-11-25T22:00:00Z"), [], REGLES, fixe)[0].toISOString()).toBe("2026-11-26T07:30:00.000Z");
  });
  it("au-delà du plafond du jour : le jour ouvré suivant", () => {
    const r = { ...REGLES, parJour: 2 };
    const t = planifier(3, at("2026-11-27T09:00:00Z"), [], r, fixe).map((d) => d.toISOString());
    expect(t).toEqual(["2026-11-27T09:01:00.000Z", "2026-11-27T09:06:00.000Z", "2026-11-30T07:30:00.000Z"]);
    const plein = planifier(1, at("2026-11-25T09:00:00Z"), [at("2026-11-25T08:00:00Z"), at("2026-11-25T08:10:00Z")], r, fixe);
    expect(plein[0].toISOString()).toBe("2026-11-26T07:30:00.000Z");
  });
  it("tous les envois restent dans la fenêtre", () => {
    const t = planifier(120, at("2026-11-25T16:50:00Z"), [], REGLES);
    expect(t.every((d) => dansLaFenetre(d))).toBe(true);
    expect(new Set(t.map((d) => d.toISOString())).size).toBe(120);
  });
});

describe("file d'envoi : ce qui bloque un mail", () => {
  const base = { reponse: false, liste: [], enErreur: [], recents: [], maintenant: at("2026-11-25T10:00:00Z") };
  it("lit les adresses et la société", () => {
    expect(adresses("Julie <Julie@Nova.fr>, presse@nova.fr, julie@nova.fr")).toEqual(["julie@nova.fr", "presse@nova.fr"]);
    expect(cleSociete("Julie@Nova.fr")).toBe("nova.fr");
    expect(cleSociete("novaparis@gmail.com")).toBe("novaparis@gmail.com");
  });
  it("la liste « ne plus contacter », par adresse ou par domaine", () => {
    expect(raisonDeBloquer({ ...base, destinataires: ["julie@nova.fr"], liste: [{ email: "Julie@Nova.fr", domaine: null, raison: "refus" }] })).toBe("julie@nova.fr est dans la liste « ne plus contacter » (refus)");
    expect(raisonDeBloquer({ ...base, destinataires: ["presse@nova.fr"], liste: [{ email: null, domaine: "@nova.fr", raison: "arret" }] })).toContain("ne plus contacter");
    expect(raisonDeBloquer({ ...base, reponse: true, destinataires: ["presse@nova.fr"], liste: [{ email: null, domaine: "nova.fr", raison: "arret" }] })).toContain("ne plus contacter");
  });
  it("l'adresse en erreur", () => {
    expect(raisonDeBloquer({ ...base, destinataires: ["julie@nova.fr"], enErreur: ["JULIE@nova.fr"] })).toBe("julie@nova.fr est marquée « adresse en erreur » sur sa fiche");
  });
  it("un premier mail à la même société depuis moins de 30 jours, pas une réponse", () => {
    const recents = [{ email: "contact@nova.fr", at: "2026-11-10T09:00:00Z" }];
    expect(raisonDeBloquer({ ...base, destinataires: ["julie@nova.fr"], recents })).toBe("un premier mail est déjà parti chez nova.fr le 10 nov. (contact@nova.fr) : pas de nouveau premier mail à la même société avant 30 jours");
    expect(raisonDeBloquer({ ...base, reponse: true, destinataires: ["julie@nova.fr"], recents })).toBeNull();
    expect(raisonDeBloquer({ ...base, destinataires: ["julie@nova.fr"], recents: [{ email: "contact@nova.fr", at: "2026-10-20T09:00:00Z" }] })).toBeNull();
    expect(raisonDeBloquer({ ...base, destinataires: ["a@gmail.com"], recents: [{ email: "b@gmail.com", at: "2026-11-20T09:00:00Z" }] })).toBeNull();
  });
  it("les adresses de l'agence ne bloquent jamais", () => {
    expect(raisonDeBloquer({ ...base, destinataires: ["talent@ttpcreators.pro"], recents: [{ email: "partnerships@ttpcreators.pro", at: "2026-11-24T09:00:00Z" }] })).toBeNull();
  });
  it("sans règle des 30 jours (envoi direct, brouillon) : la liste et les erreurs comptent encore", () => {
    const recents = [{ email: "contact@nova.fr", at: "2026-11-10T09:00:00Z" }];
    expect(raisonDeBloquer({ ...base, doublon: false, destinataires: ["julie@nova.fr"], recents })).toBeNull();
    expect(raisonDeBloquer({ ...base, doublon: false, destinataires: ["julie@nova.fr"], liste: [{ email: "julie@nova.fr", domaine: null, raison: "refus" }] })).toContain("ne plus contacter");
  });
  it("la réponse dans un fil : la liste bloque tout tant que Marc n'a pas choisi la règle", () => {
    const liste = [{ email: "julie@nova.fr", domaine: null, raison: "refus" }, { email: "paul@nova.fr", domaine: null, raison: "arret" }];
    expect(REGLES.reponseMalgreListe).toEqual([]);
    expect(raisonDeBloquer({ ...base, reponse: true, destinataires: ["julie@nova.fr"], liste })).toContain("(refus)");
    // Une règle possible : « refus » et « autre » laissent passer une réponse, « arret » et « rebond » non.
    const r = { ...REGLES, reponseMalgreListe: ["refus", "autre"] };
    expect(raisonDeBloquer({ ...base, r, reponse: true, destinataires: ["julie@nova.fr"], liste })).toBeNull();
    expect(raisonDeBloquer({ ...base, r, reponse: true, destinataires: ["paul@nova.fr"], liste })).toContain("(arret)");
    expect(raisonDeBloquer({ ...base, r, reponse: false, destinataires: ["julie@nova.fr"], liste })).toContain("(refus)");
    expect(raisonDeBloquer({ ...base, r, doublon: false, destinataires: ["julie@nova.fr"], liste })).toContain("(refus)");
  });
  it("un rebond du journal bloque l'adresse, réponse comprise", () => {
    const rebonds = [{ email: "Jean@Marque-Exemple.fr", at: "2026-11-24T07:35:00Z" }];
    expect(raisonDeBloquer({ ...base, destinataires: ["jean@marque-exemple.fr"], rebonds })).toBe("jean@marque-exemple.fr a renvoyé un rebond le 24 nov. (adresse refusée par son serveur, pas revérifiée depuis)");
    expect(raisonDeBloquer({ ...base, reponse: true, destinataires: ["jean@marque-exemple.fr"], rebonds })).toContain("rebond");
    expect(raisonDeBloquer({ ...base, destinataires: ["autre@marque-exemple.fr"], rebonds })).toBeNull();
  });
  it("un rebond compte tant que la fiche n'a pas été revérifiée depuis", () => {
    const rebonds = [{ email: "jean@marque-exemple.fr", at: "2026-11-26T07:35:00Z" }];
    // Sans fiche, ou fiche créée ensuite sans vérification : le rebond compte.
    expect(rebondsQuiComptent(rebonds, [])).toEqual(rebonds);
    expect(rebondsQuiComptent(rebonds, [{ email: "Jean@Marque-Exemple.fr", le: null }])).toEqual(rebonds);
    // Vérifiée avant le rebond (mail parti à 8 h 30) : il compte encore.
    expect(rebondsQuiComptent(rebonds, [{ email: "jean@marque-exemple.fr", le: "2026-11-26T07:30:00Z" }])).toEqual(rebonds);
    // Revérifiée après le rebond : la fiche fait foi.
    expect(rebondsQuiComptent(rebonds, [{ email: "jean@marque-exemple.fr", le: "2026-11-27T09:00:00Z" }])).toEqual([]);
    expect(rebondsQuiComptent(rebonds, [{ email: "jean@marque-exemple.fr", le: "hier" }])).toEqual(rebonds);
  });
});

describe("file d'envoi : rebonds lus dans le journal des mails reçus", () => {
  const robot = { contact_email: "mailer-daemon@googlemail.com", contact_name: "Mail Delivery Subsystem", created_at: "2026-11-26T07:35:00Z" };
  it("un message de robot qui annonce un échec donne l'adresse refusée", () => {
    expect(rebondsDuJournal([
      { ...robot, subject: "Delivery Status Notification (Failure)", snippet: "Address not found Your message wasn't delivered to jean@marque-exemple.fr because the address couldn't be found" },
      { ...robot, subject: "Delivery Status Notification (Delay)", snippet: "temporary problem delivering your message to paul@marque-exemple.fr" },
      { contact_email: "julie@nova.fr", contact_name: "Julie", subject: "Undeliverable", snippet: "x@y.fr", created_at: "2026-11-26T08:00:00Z" },
      { ...robot, subject: "Delivery Status Notification (Failure)", snippet: "wasn't delivered to talent@ttpcreators.pro" },
    ], "ttpcreators.pro")).toEqual([{ email: "jean@marque-exemple.fr", at: "2026-11-26T07:35:00Z" }]);
  });
  it("une ligne incomplète ne casse rien", () => {
    expect(rebondsDuJournal([{}, { contact_email: null, subject: null }], "ttpcreators.pro")).toEqual([]);
  });
});

describe("file d'envoi : description de la liste", () => {
  it("dit toujours ce que fait le code", () => {
    expect(texteListe()).toContain("réponses dans un fil existant comprises");
    expect(texteListe({ ...REGLES, reponseMalgreListe: ["refus", "autre"] })).toContain("passe seulement pour la raison refus ou autre");
  });
});

describe("file d'envoi : coupe-circuit et affichage", () => {
  it("s'arrête au-delà de 3 rebonds et 5 % des envois", () => {
    expect(coupeCircuit(40, 2)).toBeNull();
    expect(coupeCircuit(100, 3)).toBeNull();
    expect(coupeCircuit(40, 3)).toContain("la file est en pause");
    expect(coupeCircuit(0, 3)).toContain("3 rebond(s) sur 0");
  });
  it("écrit une ligne lisible", () => {
    expect(quandCourt("2026-11-25T08:42:00Z")).toBe("mer. 25 nov. à 9 h 42");
    expect(ligneFile({ id: "0123456789abcdef", boite: "talent", destinataires: "julie@nova.fr", objet: "Nova × Léa", statut: "en_attente", prevu_a: "2026-11-25T08:42:00Z", envoye_at: null, erreur: null, lot: "25/11" }))
      .toBe("- prévu · mer. 25 nov. à 9 h 42 · talent@ → julie@nova.fr · « Nova × Léa » · lot 25/11 [01234567]");
  });
});
