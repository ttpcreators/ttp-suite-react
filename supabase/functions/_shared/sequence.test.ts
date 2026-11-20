import { describe, expect, it } from "vitest";
import { aRelancer, adresseEnRebond, apresMail, arreter, demarrerSequence, estReponseAuto, etapeFaite, etapesPour, lireSequence, tacheVisio } from "./sequence.ts";

const NOW = new Date("2026-11-20T10:00:00Z");
const tout = { linkedin: "https://linkedin.com/in/x", instagram: "@marque", phone: "+33600000000" };

describe("etapesPour", () => {
  it("toutes les étapes avec LinkedIn et Instagram", () => {
    expect(etapesPour(tout).map((e) => e.etape)).toEqual(["J0", "J+1", "J+3", "J+5", "J+10", "J+20"]);
  });
  it("mail seul : J0, J+5, J+20", () => {
    expect(etapesPour({}).map((e) => e.etape)).toEqual(["J0", "J+5", "J+20"]);
  });
  it("sans LinkedIn mais avec numéro : J+10 en WhatsApp", () => {
    const j10 = etapesPour({ phone: "06" }).find((e) => e.etape === "J+10");
    expect(j10?.canal).toBe("whatsapp");
  });
});

describe("séquence", () => {
  it("démarre au J0 fait, prochaine J+1 LinkedIn le lendemain", () => {
    const s = demarrerSequence(tout, "2026-11-20", NOW, "Léna");
    expect(s).toMatchObject({ debut: "2026-11-20", faites: ["J0"], etape: "J+1", canal: "linkedin", prochaine: "2026-11-21", statut: "en_cours", reponse: "aucune", createur: "Léna" });
  });
  it("mail seul : après le J0, le J+5 mail", () => {
    const s = demarrerSequence({}, "2026-11-20", NOW);
    expect(s).toMatchObject({ etape: "J+5", canal: "email", prochaine: "2026-11-25" });
    const s2 = apresMail(s, {}, NOW)!;
    expect(s2).toMatchObject({ faites: ["J0", "J+5"], etape: "J+20", prochaine: "2026-12-10" });
    const s3 = apresMail(s2, {}, NOW)!;
    expect(s3).toMatchObject({ statut: "finie", etape: null, prochaine: null });
  });
  it("un mail n'avance pas une étape LinkedIn", () => {
    const s = demarrerSequence(tout, "2026-11-20", NOW);
    expect(apresMail(s, tout, NOW)).toBeNull();
    expect(etapeFaite(s, tout, NOW)).toMatchObject({ etape: "J+3", canal: "instagram", prochaine: "2026-11-23" });
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
  const b = { id: "b", sequence: demarrerSequence(tout, "2026-11-20", NOW) }; // J+1 le 21
  const c = { id: "c", sequence: demarrerSequence({}, "2026-11-12", NOW), email_check: { statut: "erreur", raison: "rebond", le: "x" } };
  const d = { id: "d", sequence: arreter(demarrerSequence({}, "2026-11-01", NOW), "réponse", NOW) };
  it("date passée, en cours, adresse valable ; tri par date", () => {
    expect(aRelancer([b, a, c, d], "2026-11-20").map((r) => r.id)).toEqual(["a"]);
    expect(aRelancer([b, a], "2026-11-21").map((r) => r.id)).toEqual(["a", "b"]);
  });
  it("filtre par canal et par étape", () => {
    expect(aRelancer([b, a], "2026-11-21", { canal: "linkedin" }).map((r) => r.id)).toEqual(["b"]);
    expect(aRelancer([b, a], "2026-11-21", { etape: "J+5" }).map((r) => r.id)).toEqual(["a"]);
  });
});

describe("mails reçus", () => {
  it("réponse automatique", () => {
    expect(estReponseAuto("Réponse automatique : absente jusqu'au 25")).toBe(true);
    expect(estReponseAuto("Out of Office")).toBe(true);
    expect(estReponseAuto("Re: Collab Léna x Nakd")).toBe(false);
    expect(estReponseAuto("Re: x", "noreply@marque.fr")).toBe(true);
  });
  it("rebond : l'adresse en échec", () => {
    expect(adresseEnRebond({ from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>", subject: "Delivery Status Notification (Failure)", snippet: "Address not found Your message wasn't delivered to jean@marque-fausse.fr because", failed: "" }, "ttpcreators.pro")).toBe("jean@marque-fausse.fr");
    expect(adresseEnRebond({ from: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification (Failure)", snippet: "", failed: "Anne@Marque.fr" }, "ttpcreators.pro")).toBe("anne@marque.fr");
    expect(adresseEnRebond({ from: "jean@marque.fr", subject: "Delivery Status Notification", snippet: "x@y.fr" }, "ttpcreators.pro")).toBeNull();
    expect(adresseEnRebond({ from: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification (Failure)", snippet: "partnerships@ttpcreators.pro" }, "ttpcreators.pro")).toBeNull();
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
