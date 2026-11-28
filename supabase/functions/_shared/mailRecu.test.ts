import { describe, expect, it } from "vitest";
import {
  SOURCE_RECU, adresseDe, authentificationGoogle, estAvisDeNonRemise, estRobot, expediteurAuthentifie, formatAvis, lireAuthentification, nomAffiche, prouveAdresse,
  rebondDuJournal, sourceDuJournal,
} from "./mailRecu.ts";

// Données fictives : domaines d'exemple et adresses IP de documentation (192.0.2.0/24).
const AUTH_OK = [
  "mx.google.com;",
  "       dkim=pass header.i=@marque-exemple.fr header.s=s1 header.b=AbCd;",
  "       spf=pass (google.com: domain of jean@marque-exemple.fr designates 192.0.2.10 as permitted sender) smtp.mailfrom=jean@marque-exemple.fr;",
  "       dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=marque-exemple.fr",
].join("\r\n");

describe("adresseDe : la vraie adresse de l'expéditeur", () => {
  it("formes courantes", () => {
    expect(adresseDe("Jean Martin <Jean@Marque-Exemple.fr>")).toBe("jean@marque-exemple.fr");
    expect(adresseDe("\"Martin, Jean\" <jean@marque-exemple.fr>")).toBe("jean@marque-exemple.fr");
    expect(adresseDe("jean@marque-exemple.fr")).toBe("jean@marque-exemple.fr");
    expect(adresseDe("  jean@marque-exemple.fr (Jean Martin) ")).toBe("jean@marque-exemple.fr");
    expect(adresseDe("=?UTF-8?B?SsOpcsO0bWU=?= <jerome@marque-exemple.fr>")).toBe("jerome@marque-exemple.fr");
    expect(adresseDe("Mail Delivery Subsystem <mailer-daemon@googlemail.com>")).toBe("mailer-daemon@googlemail.com");
  });
  it("une adresse écrite dans le nom affiché ne compte jamais", () => {
    expect(adresseDe("\"<jean@marque-exemple.fr>\" <autre@autre-exemple.fr>")).toBe("autre@autre-exemple.fr");
    expect(adresseDe("\"Jean <jean@marque-exemple.fr>\" <autre@autre-exemple.fr>")).toBe("autre@autre-exemple.fr");
    expect(adresseDe("jean@marque-exemple.fr <autre@autre-exemple.fr>")).toBe("autre@autre-exemple.fr");
    expect(adresseDe("<jean@marque-exemple.fr> <autre@autre-exemple.fr>")).toBe("autre@autre-exemple.fr");
    expect(adresseDe("(<jean@marque-exemple.fr>) autre@autre-exemple.fr")).toBe("autre@autre-exemple.fr");
    expect(adresseDe("\"Jean \\\"<jean@marque-exemple.fr>\\\"\" <autre@autre-exemple.fr>")).toBe("autre@autre-exemple.fr");
  });
  it("illisible : rien plutôt qu'une adresse devinée", () => {
    expect(adresseDe("")).toBe("");
    expect(adresseDe("Jean Martin")).toBe("");
    expect(adresseDe("Jean <jean@marque-exemple.fr")).toBe("");
    expect(adresseDe("a@marque-exemple.fr, b@marque-exemple.fr")).toBe("");
    expect(adresseDe("\"jean@marque-exemple.fr\"")).toBe("");
    expect(adresseDe("Jean <pas une adresse>")).toBe("");
  });
  it("en-tête mal formé : guillemet, commentaire ou chevron resté ouvert à la fin", () => {
    expect(adresseDe("<jean@marque-exemple.fr> ( <autre@autre-exemple.fr>")).toBe("");
    expect(adresseDe("<jean@marque-exemple.fr> \" <autre@autre-exemple.fr>")).toBe("");
    expect(adresseDe("<jean@marque-exemple.fr> <autre@autre-exemple.fr")).toBe("");
  });
  it("plusieurs adresses (virgule hors guillemets, commentaires et <…>) : aucune n'est choisie", () => {
    expect(adresseDe("<autre@autre-exemple.fr>, <jean@marque-exemple.fr>")).toBe("");
    expect(adresseDe("Autre <autre@autre-exemple.fr>, Jean <jean@marque-exemple.fr>")).toBe("");
    expect(adresseDe("Martin, Jean <jean@marque-exemple.fr>")).toBe("");
    expect(adresseDe("Jean (Martin, Jean) <jean@marque-exemple.fr>")).toBe("jean@marque-exemple.fr");
  });
  it("« * » reste lisible ici : c'est la recherche (ilikeExact) qui le refuse", () => {
    expect(adresseDe("<a*@marque-exemple.fr>")).toBe("a*@marque-exemple.fr");
  });
});

describe("nomAffiche", () => {
  it("le nom, sans guillemets ni chevrons", () => {
    expect(nomAffiche("\"Jean Martin\" <jean@marque-exemple.fr>")).toBe("Jean Martin");
    expect(nomAffiche("Jean Martin <jean@marque-exemple.fr>")).toBe("Jean Martin");
    expect(nomAffiche("\"Jean \\\"JM\\\" Martin\" <jean@marque-exemple.fr>")).toBe("Jean \"JM\" Martin");
    expect(nomAffiche("jean@marque-exemple.fr (Jean Martin)")).toBe("Jean Martin");
  });
  it("absent, ou qui contient une adresse : vide", () => {
    expect(nomAffiche("jean@marque-exemple.fr")).toBe("");
    expect(nomAffiche("<jean@marque-exemple.fr>")).toBe("");
    expect(nomAffiche("\"<jean@marque-exemple.fr>\" <autre@autre-exemple.fr>")).toBe("");
    expect(nomAffiche("jean@marque-exemple.fr <autre@autre-exemple.fr>")).toBe("");
  });
});

describe("avis de non-remise", () => {
  const robotGoogle = "Mail Delivery Subsystem <mailer-daemon@googlemail.com>";
  const authGoogle = "mx.google.com; dkim=pass header.i=@googlemail.com header.s=s2 header.b=XyZ; dmarc=pass (p=QUARANTINE sp=QUARANTINE dis=NONE) header.from=googlemail.com";
  const dsn = "multipart/report; boundary=\"00000000000000abc\"; report-type=delivery-status";
  it("robot : l'adresse réelle, jamais le nom affiché", () => {
    expect(estRobot("mailer-daemon@googlemail.com")).toBe(true);
    expect(estRobot("MAILER-DAEMON@mx.exemple.fr")).toBe(true);
    expect(estRobot("postmaster@outlook.com")).toBe(true);
    expect(estRobot("jean@postmaster.exemple.fr")).toBe(false);
    expect(estRobot("jean.mailer-daemon@exemple.fr")).toBe(false);
  });
  it("format des avis", () => {
    expect(formatAvis(dsn)).toBe(true);
    expect(formatAvis("Multipart/Report;\r\n\tReport-Type=\"Delivery-Status\"; boundary=x")).toBe(true);
    expect(formatAvis("multipart/report; report-type=disposition-notification")).toBe(false);
    expect(formatAvis("multipart/mixed; boundary=x")).toBe(false);
    expect(formatAvis("text/plain")).toBe(false);
    expect(formatAvis(undefined)).toBe(false);
  });
  it("un avis de robot au format des avis compte", () => {
    expect(estAvisDeNonRemise({ from: "MAILER-DAEMON@mx.exemple.fr", contentType: dsn })).toBe(true);
    expect(estAvisDeNonRemise({ from: "Microsoft Outlook <postmaster@outlook.com>", contentType: dsn })).toBe(true);
    expect(estAvisDeNonRemise({ from: robotGoogle, contentType: dsn, auth: authGoogle })).toBe(true);
  });
  it("Google : X-Failed-Recipients suffit, s'il est signé par Google", () => {
    expect(estAvisDeNonRemise({ from: robotGoogle, contentType: "text/plain", failed: "jean@marque-exemple.fr", auth: authGoogle })).toBe(true);
    expect(estAvisDeNonRemise({ from: robotGoogle, contentType: dsn, failed: "jean@marque-exemple.fr", auth: "" })).toBe(false);
    expect(estAvisDeNonRemise({ from: robotGoogle, contentType: dsn, auth: "mx.google.com; dmarc=fail (p=QUARANTINE) header.from=googlemail.com" })).toBe(false);
    // L'en-tête X-Failed-Recipients d'un autre serveur ne suffit pas.
    expect(estAvisDeNonRemise({ from: "Mail Delivery System <Mailer-Daemon@mx.exemple.fr>", contentType: "text/plain", failed: "jean@marque-exemple.fr" })).toBe(false);
  });
  it("le nom affiché, l'objet ou un format ordinaire ne suffisent jamais", () => {
    expect(estAvisDeNonRemise({ from: "Mail Delivery Subsystem <jean@autre-exemple.fr>", contentType: dsn })).toBe(false);
    expect(estAvisDeNonRemise({ from: "\"<mailer-daemon@googlemail.com>\" <jean@autre-exemple.fr>", contentType: dsn, auth: authGoogle })).toBe(false);
    expect(estAvisDeNonRemise({ from: "MAILER-DAEMON@mx.exemple.fr", contentType: "multipart/alternative; boundary=x" })).toBe(false);
    expect(estAvisDeNonRemise({ from: "", contentType: dsn })).toBe(false);
  });
});

describe("expéditeur authentifié", () => {
  it("lecture de l'en-tête : serveur, méthodes, propriétés, commentaires retirés", () => {
    const a = lireAuthentification(AUTH_OK);
    expect(a.serveur).toBe("mx.google.com");
    expect(a.resultats.map((r) => `${r.methode}=${r.resultat}`)).toEqual(["dkim=pass", "spf=pass", "dmarc=pass"]);
    expect(a.resultats[2].props["header.from"]).toBe("marque-exemple.fr");
    expect(lireAuthentification("")).toEqual({ serveur: "", resultats: [] });
    expect(lireAuthentification("mx.google.com; none").resultats).toEqual([]);
  });
  it("DMARC « pass » pour le domaine de l'adresse", () => {
    expect(expediteurAuthentifie(AUTH_OK, "jean@marque-exemple.fr")).toBe(true);
    expect(expediteurAuthentifie(AUTH_OK, "Jean@Marque-Exemple.fr")).toBe(true);
    expect(expediteurAuthentifie(AUTH_OK, "jean@autre-exemple.fr")).toBe(false);
  });
  it("DMARC en échec : jamais rattrapé par SPF ou DKIM", () => {
    const auth = "mx.google.com; dkim=pass header.i=@marque-exemple.fr; spf=pass smtp.mailfrom=jean@marque-exemple.fr; dmarc=fail (p=NONE sp=NONE dis=NONE) header.from=marque-exemple.fr";
    expect(expediteurAuthentifie(auth, "jean@marque-exemple.fr")).toBe(false);
  });
  it("le résultat cité dans un commentaire (arc=…) ne compte pas", () => {
    const auth = "mx.google.com; arc=pass (i=1 spf=pass spfdomain=autre-exemple.fr dkim=pass dkdomain=autre-exemple.fr dmarc=pass fromdomain=marque-exemple.fr); spf=pass (google.com: domain of x@autre-exemple.fr designates 192.0.2.20 as permitted sender) smtp.mailfrom=x@autre-exemple.fr";
    expect(expediteurAuthentifie(auth, "jean@marque-exemple.fr")).toBe(false);
  });
  it("domaine sans règle DMARC : SPF ou DKIM « pass » aligné", () => {
    expect(expediteurAuthentifie("mx.google.com; spf=pass (google.com: domain of jean@marque-exemple.fr designates 192.0.2.10 as permitted sender) smtp.mailfrom=jean@marque-exemple.fr", "jean@marque-exemple.fr")).toBe(true);
    expect(expediteurAuthentifie("mx.google.com; spf=pass smtp.mailfrom=rebond@envoi.marque-exemple.fr", "jean@marque-exemple.fr")).toBe(true);
    expect(expediteurAuthentifie("mx.google.com; dkim=pass header.d=marque-exemple.fr header.s=s1", "jean@news.marque-exemple.fr")).toBe(true);
    expect(expediteurAuthentifie("mx.google.com; dkim=pass header.i=@marque-exemple-fr.20230601.gappssmtp.com", "jean@marque-exemple.fr")).toBe(false);
    expect(expediteurAuthentifie("mx.google.com; spf=pass smtp.mailfrom=x@autremarque-exemple.fr", "jean@marque-exemple.fr")).toBe(false);
    expect(expediteurAuthentifie("mx.google.com; spf=softfail smtp.mailfrom=jean@marque-exemple.fr", "jean@marque-exemple.fr")).toBe(false);
    expect(expediteurAuthentifie("mx.google.com; spf=neutral smtp.mailfrom=jean@marque-exemple.fr", "jean@marque-exemple.fr")).toBe(false);
  });
  it("« bestguesspass » (estimation de Google, domaine sans DMARC publié) : comme sans DMARC", () => {
    const base = "mx.google.com; dmarc=bestguesspass header.from=marque-exemple.fr";
    expect(expediteurAuthentifie(`${base}; dkim=pass header.d=marque-exemple.fr`, "jean@marque-exemple.fr")).toBe(true);
    expect(expediteurAuthentifie(`${base}; spf=pass smtp.mailfrom=jean@marque-exemple.fr`, "jean@marque-exemple.fr")).toBe(true);
    expect(expediteurAuthentifie(base, "jean@marque-exemple.fr")).toBe(false);
    expect(expediteurAuthentifie(`${base}; dkim=pass header.d=autre-exemple.fr`, "jean@marque-exemple.fr")).toBe(false);
  });
  it("en-tête d'un autre serveur, absent, ou adresse illisible : non", () => {
    expect(expediteurAuthentifie("relais.exemple.net; dmarc=pass header.from=marque-exemple.fr", "jean@marque-exemple.fr")).toBe(false);
    expect(expediteurAuthentifie(undefined, "jean@marque-exemple.fr")).toBe(false);
    expect(expediteurAuthentifie(AUTH_OK, "")).toBe(false);
  });
  it("authentificationGoogle : le premier en-tête posé par Google", () => {
    const faux = "mx.google.com; dmarc=pass header.from=autre-exemple.fr";
    expect(authentificationGoogle([AUTH_OK, faux])).toBe(AUTH_OK);
    expect(authentificationGoogle(["relais.exemple.net; dmarc=pass header.from=marque-exemple.fr", AUTH_OK])).toBe(AUTH_OK);
    expect(authentificationGoogle(["relais.exemple.net; spf=pass"])).toBe("");
    expect(authentificationGoogle([])).toBe("");
  });
});

describe("journal des mails reçus : la source garde le verdict", () => {
  it("source notée", () => {
    expect(sourceDuJournal({ avis: true, verifie: false })).toBe(SOURCE_RECU.rebond);
    expect(sourceDuJournal({ avis: false, verifie: true })).toBe(SOURCE_RECU.verifie);
    expect(sourceDuJournal({ avis: false, verifie: false })).toBe(SOURCE_RECU.douteux);
  });
  it("rebond : avis vérifié, ancienne ligne, ou non", () => {
    expect(rebondDuJournal("inbox-rebond")).toBe("avis");
    expect(rebondDuJournal("inbox")).toBe("ancienne");
    expect(rebondDuJournal(null)).toBe("ancienne");
    expect(rebondDuJournal(undefined)).toBe("ancienne");
    expect(rebondDuJournal("inbox-verifie")).toBe("non");
    expect(rebondDuJournal("inbox-douteux")).toBe("non");
  });
  it("adresse qui marche : jamais un avis ni un expéditeur douteux", () => {
    expect(prouveAdresse("inbox-verifie")).toBe(true);
    expect(prouveAdresse("inbox")).toBe(true);
    expect(prouveAdresse(null)).toBe(true);
    expect(prouveAdresse("inbox-douteux")).toBe(false);
    expect(prouveAdresse("inbox-rebond")).toBe(false);
  });
});
