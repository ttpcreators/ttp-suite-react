import { describe, expect, it } from "vitest";
import { aRelancer, adresseEnRebond, apresMail, arreter, demarrerSequence, estReponseAuto, etapeFaite, etapesPour, lireSequence, tacheVisio } from "./sequence.ts";

const NOW = new Date("2026-11-20T10:00:00Z");
const tout = { linkedin: "https://linkedin.com/in/x", instagram: "@marque", phone: "+33600000000" };

describe("etapesPour", () => {
  it("100 % mail, même avec LinkedIn, Instagram et numéro", () => {
    expect(etapesPour(tout).map((e) => e.etape)).toEqual(["J0", "J+5", "J+12"]);
    expect(etapesPour({}).map((e) => e.etape)).toEqual(["J0", "J+5", "J+12"]);
    expect(etapesPour(tout).every((e) => e.canal === "email")).toBe(true);
  });
});

describe("séquence", () => {
  it("démarre au J0 fait, prochaine relance mail à J+5", () => {
    const s = demarrerSequence(tout, "2026-11-20", NOW, "Léna");
    expect(s).toMatchObject({ debut: "2026-11-20", faites: ["J0"], etape: "J+5", canal: "email", prochaine: "2026-11-25", statut: "en_cours", reponse: "aucune", createur: "Léna" });
  });
  it("J+5 puis J+12, puis finie", () => {
    const s = demarrerSequence({}, "2026-11-20", NOW);
    const s2 = apresMail(s, {}, NOW)!;
    expect(s2).toMatchObject({ faites: ["J0", "J+5"], etape: "J+12", prochaine: "2026-12-02" });
    const s3 = apresMail(s2, {}, NOW)!;
    expect(s3).toMatchObject({ statut: "finie", etape: null, prochaine: null });
  });
  it("une ancienne séquence arrêtée sur J+3 Instagram passe au J+5 mail", () => {
    const vieille = { ...demarrerSequence({}, "2026-11-25", NOW), etape: "J+3", canal: "instagram" as const, prochaine: "2026-11-28" };
    expect(etapeFaite(vieille, tout, NOW)).toMatchObject({ faites: ["J0", "J+3"], etape: "J+5", canal: "email", prochaine: "2026-11-30" });
  });
  it("arrêtée : plus rien n'avance", () => {
    const s = arreter(demarrerSequence({}, "2026-11-20", NOW), "réponse", NOW, "a_repondu");
    expect(s).toMatchObject({ statut: "arretee", reponse: "a_repondu", prochaine: null });
    expect(etapeFaite(s, {}, NOW)).toBeNull();
  });
  it("relit une séquence en base, refuse une valeur abîmée", () => {
    const s = demarrerSequence({}, "2026-11-20", NOW);
    expect(lireSequence(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(lireSequence({ debut: "hier" })).toBeNull();
    expect(lireSequence(null)).toBeNull();
  });
});

describe("aRelancer", () => {
  const a = { id: "a", sequence: demarrerSequence({}, "2026-11-10", NOW) }; // J+5 le 15
  const b = { id: "b", sequence: demarrerSequence(tout, "2026-11-16", NOW) }; // J+5 le 21
  const c = { id: "c", sequence: demarrerSequence({}, "2026-11-12", NOW), email_check: { statut: "erreur", raison: "rebond", le: "x" } };
  const d = { id: "d", sequence: arreter(demarrerSequence({}, "2026-11-01", NOW), "réponse", NOW) };
  it("date passée, en cours, adresse valable ; tri par date", () => {
    expect(aRelancer([b, a, c, d], "2026-11-20").map((r) => r.id)).toEqual(["a"]);
    expect(aRelancer([b, a], "2026-11-21").map((r) => r.id)).toEqual(["a", "b"]);
  });
  it("filtre par canal et par étape", () => {
    expect(aRelancer([b, a], "2026-11-21", { canal: "email" }).map((r) => r.id)).toEqual(["a", "b"]);
    expect(aRelancer([b, a], "2026-11-21", { etape: "J+5" }).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("mails reçus", () => {
  it("réponse automatique", () => {
    expect(estReponseAuto("Réponse automatique : absente jusqu'au 25")).toBe(true);
    expect(estReponseAuto("Out of Office")).toBe(true);
    expect(estReponseAuto("Merci pour votre message ! Re: Ana et votre matcha", "contact@marque.fr", "Bonjour, Merci pour votre message ! Nous avons bien pris en compte votre demande")).toBe(true);
    expect(estReponseAuto("Re: Ana et votre matcha", "camille@marque.fr", "Merci pour votre message, on adore Ana, vous avez ses tarifs ?")).toBe(false);
    expect(estReponseAuto("Re: Collab Léna x Nakd")).toBe(false);
    expect(estReponseAuto("Re: x", "noreply@marque.fr")).toBe(true);
  });
  it("rebond : l'adresse en échec", () => {
    expect(adresseEnRebond({ from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification (Failure)", snippet: "Address not found Your message wasn't delivered to jean@marque-fausse.fr because", failed: "" }, "ttpcreators.pro")).toBe("jean@marque-fausse.fr");
    expect(adresseEnRebond({ from: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification (Failure)", snippet: "", failed: "Anne@Marque.fr" }, "ttpcreators.pro")).toBe("anne@marque.fr");
    expect(adresseEnRebond({ from: "jean@marque.fr", subject: "Delivery Status Notification", snippet: "x@y.fr" }, "ttpcreators.pro")).toBeNull();
    expect(adresseEnRebond({ from: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification (Failure)", snippet: "partnerships@ttpcreators.pro" }, "ttpcreators.pro")).toBeNull();
  });
  it("un simple retard n'est pas un rebond (le serveur réessaie)", () => {
    const snippet = "Delivery incomplete There was a temporary problem delivering your message to jean@marque-exemple.fr";
    expect(adresseEnRebond({ from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification (Delay)", snippet }, "ttpcreators.pro")).toBeNull();
    expect(adresseEnRebond({ from: "MAILER-DAEMON@mx.exemple.fr", subject: "Undelivered Mail Returned to Sender", snippet }, "ttpcreators.pro")).toBe("jean@marque-exemple.fr");
    expect(adresseEnRebond({ from: "postmaster@mx.exemple.fr", subject: "Delivery delayed: Collab de janvier", snippet }, "ttpcreators.pro")).toBeNull();
  });
  it("un vrai rebond dont l'objet d'origine parle de retard (Outlook, Exchange recopient l'objet)", () => {
    const snippet = "Votre message à jean@marque-exemple.fr n'a pas pu être remis.";
    expect(adresseEnRebond({ from: "postmaster@outlook.com", subject: "Non remis : Retard de livraison du colis", snippet }, "ttpcreators.pro")).toBe("jean@marque-exemple.fr");
    expect(adresseEnRebond({ from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Undeliverable: Re: Sorry for the delay", snippet }, "ttpcreators.pro")).toBe("jean@marque-exemple.fr");
  });
  it("tâche Visio avec la fiche", () => {
    const s = demarrerSequence({}, "2026-11-10", NOW, "Ana");
    const t = tacheVisio({ brand: "Nakd", person: "Julie", email: "julie@nakd.com", touches: [{ date: "2026-11-10", canal: "email", kind: "contact" }] }, s, { subject: "Re: Ana x Nakd", snippet: "Avec plaisir, quel budget ?" });
    expect(t.text).toBe("Visio : Nakd");
    expect(t.descr).toMatch(/Créatrice proposée : Ana/);
    expect(t.descr).toMatch(/2026-11-10 · email · contact/);
    expect(t.descr).toMatch(/Avec plaisir/);
  });
});
