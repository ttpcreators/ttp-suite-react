import { describe, expect, it } from "vitest";
import { INVITATION_RDV, RDV_DEFAUT, creneauOk, creneauxLibres, instantParis, lireRdv, lireReservation, paris, mailRdv, occupeDepuisEvenements, quandFr, tacheRdv, texteTelegramRdv } from "./rdv.ts";

const cfg = { ...RDV_DEFAUT, actif: true }; // mardi 14 h-18 h, jeudi 9 h-12 h 30, 30 min, 20 h de délai
// Dimanche 22 novembre 2026, 16 h à Paris (15 h UTC).
const NOW = new Date("2026-11-22T15:00:00Z");

describe("heure de Paris", () => {
  it("instant d'une heure de Paris, hiver et été", () => {
    expect(new Date(instantParis("2026-11-24", "14:00")).toISOString()).toBe("2026-11-24T13:00:00.000Z");
    expect(new Date(instantParis("2027-06-15", "14:00")).toISOString()).toBe("2027-06-15T12:00:00.000Z");
  });
  it("jour de la semaine", () => {
    expect(paris(new Date("2026-11-24T13:00:00Z"))).toMatchObject({ jour: "2026-11-24", semaine: 2, heure: "14:00" });
  });
});

describe("creneauxLibres", () => {
  const c = creneauxLibres(cfg, NOW, []);
  it("mardi après-midi et jeudi matin, toutes les 30 min, dans l'ordre", () => {
    expect(c[0]).toMatchObject({ jour: "2026-11-24", heure: "14:00" });
    expect(c.filter((x) => x.jour === "2026-11-24").map((x) => x.heure)).toEqual(["14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30"]);
    expect(c.filter((x) => x.jour === "2026-11-26").map((x) => x.heure)).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00"]);
    expect(c.every((x) => ["2026-11-24", "2026-11-26", "2026-12-01", "2026-12-03"].includes(x.jour))).toBe(true);
  });
  it("retire les rendez-vous déjà pris (même partiellement)", () => {
    const occupe = [{ debut: instantParis("2026-11-24", "14:15"), fin: instantParis("2026-11-24", "15:00") }];
    const mardi = creneauxLibres(cfg, NOW, occupe).filter((x) => x.jour === "2026-11-24").map((x) => x.heure);
    expect(mardi).not.toContain("14:00");
    expect(mardi).not.toContain("14:30");
    expect(mardi[0]).toBe("15:00");
  });
  it("respecte le délai minimum", () => {
    const lundiSoir = new Date("2026-11-23T19:00:00Z"); // 20 h à Paris : mardi 14 h est à 18 h, sous 20 h
    expect(creneauxLibres(cfg, lundiSoir, [])[0]).toMatchObject({ jour: "2026-11-24", heure: "16:00" });
  });
  it("creneauOk", () => {
    expect(creneauOk(cfg, NOW, [], "2026-11-24", "14:30")).toBe(true);
    expect(creneauOk(cfg, NOW, [], "2026-11-24", "14:15")).toBe(false);
    expect(creneauOk(cfg, NOW, [], "2026-11-25", "14:00")).toBe(false);
  });
});

describe("lireRdv et lireReservation", () => {
  it("réglages tolérants, inactif par défaut", () => {
    expect(lireRdv(null)).toEqual(RDV_DEFAUT);
    expect(lireRdv({ actif: true, plages: [{ jour: 9, debut: "x", fin: "y" }], duree: 5 })).toMatchObject({ actif: true, plages: [], duree: 30 });
  });
  it("réservation nettoyée, robot ignoré", () => {
    expect(lireReservation({ jour: "2026-11-24", heure: "14:30", nom: "Julie", email: "Julie@Nakd.com", marque: "Nakd<b>", message: "Campagne janvier" }))
      .toEqual({ r: { jour: "2026-11-24", heure: "14:30", nom: "Julie", email: "julie@nakd.com", marque: "Nakd b", message: "Campagne janvier" } });
    expect(lireReservation({ site: "x" })).toEqual({ robot: true });
    expect(lireReservation({ jour: "2026-11-24", heure: "14:30", nom: "J", email: "pas-un-mail", marque: "N" })).toEqual({ erreur: "email" });
  });
  it("adresse avec « * » refusée (joker d'ilike que rien n'échappe)", () => {
    const base = { jour: "2026-11-24", heure: "14:30", nom: "Julie", marque: "Nova" };
    expect(lireReservation({ ...base, email: "a*@marque.fr" })).toEqual({ erreur: "email" });
    expect(lireReservation({ ...base, email: "*@marque.fr" })).toEqual({ erreur: "email" });
    expect(lireReservation({ ...base, email: "julie@*.fr" })).toEqual({ erreur: "email" });
    expect(lireReservation({ ...base, email: "julie_martin@marque.fr" })).toMatchObject({ r: { email: "julie_martin@marque.fr" } });
  });
  it("quandFr", () => {
    expect(quandFr("2026-11-24", "14:30")).toBe("mardi 24 novembre à 14 h 30");
    expect(quandFr("2026-11-24", "14:00")).toBe("mardi 24 novembre à 14 h");
  });
  it("occupeDepuisEvenements : ce qui occupe l'agenda, comme freeBusy", () => {
    const h = (iso: string) => Date.parse(iso);
    expect(occupeDepuisEvenements([
      { start: { dateTime: "2026-11-24T14:00:00+01:00" }, end: { dateTime: "2026-11-24T15:00:00+01:00" } },
      { status: "cancelled", start: { dateTime: "2026-11-24T16:00:00+01:00" }, end: { dateTime: "2026-11-24T17:00:00+01:00" } },
      { transparency: "transparent", start: { dateTime: "2026-11-24T16:00:00+01:00" }, end: { dateTime: "2026-11-24T17:00:00+01:00" } },
      { eventType: "workingLocation", start: { date: "2026-11-24" }, end: { date: "2026-11-25" } },
      { attendees: [{ self: true, responseStatus: "declined" }], start: { dateTime: "2026-11-24T18:00:00+01:00" }, end: { dateTime: "2026-11-24T19:00:00+01:00" } },
      { attendees: [{ self: true, responseStatus: "accepted" }, { responseStatus: "declined" }], start: { dateTime: "2026-11-24T20:00:00+01:00" }, end: { dateTime: "2026-11-24T20:30:00+01:00" } },
      { start: { date: "2026-11-26" }, end: { date: "2026-11-27" } },
      { start: { dateTime: "pas une date" }, end: { dateTime: "2026-11-24T15:00:00+01:00" } },
      { start: { dateTime: "2026-11-24T15:00:00+01:00" }, end: { dateTime: "2026-11-24T15:00:00+01:00" } },
    ])).toEqual([
      { debut: h("2026-11-24T13:00:00Z"), fin: h("2026-11-24T14:00:00Z") },
      { debut: h("2026-11-24T19:00:00Z"), fin: h("2026-11-24T19:30:00Z") },
      { debut: h("2026-11-25T23:00:00Z"), fin: h("2026-11-26T23:00:00Z") },
    ]);
    expect(occupeDepuisEvenements(null)).toEqual([]);
  });
  it("mailRdv : qui, quand, le lien, et le texte du visiteur échappé", () => {
    const m = mailRdv({ nom: "Julie Martin", email: "julie@nova.fr", marque: "Nova", message: "Campagne janvier\n<script>x</script>", jour: "2026-11-24", heure: "14:30", duree: 30, meet: "https://meet.google.com/abc-defg-hij" });
    expect(m.subject).toBe("Visio réservée : Nova, mardi 24 novembre à 14 h 30");
    expect(m.html).toContain("<b>Visio réservée : mardi 24 novembre à 14 h 30 (30 min)</b>");
    expect(m.html).toContain("Julie Martin, Nova<br>julie@nova.fr");
    expect(m.html).toContain('<a href="https://meet.google.com/abc-defg-hij">');
    expect(m.html).toContain("Campagne janvier<br>&#60;script&#62;x&#60;/script&#62;");
    expect(m.html).not.toContain("<script>");
  });
  it("mailRdv : objet sur une ligne, sans lien ni message si absents", () => {
    const m = mailRdv({ nom: "Zoé", email: "zoe@exemple.fr", marque: "Maison\r\nBcc: x@y.fr", jour: "2026-11-24", heure: "14:00", duree: 45 });
    expect(m.subject).toBe("Visio réservée : Maison Bcc: x@y.fr, mardi 24 novembre à 14 h");
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.html).not.toContain("Lien Meet");
    expect(m.html).not.toContain("Son message");
  });
  it("texteTelegramRdv : le créneau, sans texte du visiteur", () => {
    expect(texteTelegramRdv("2026-11-24", "14:30", 30)).toBe("Visio réservée : mardi 24 novembre à 14 h 30 (30 min). La fiche du contact est dans la to-do de l'app.");
  });
});

describe("réservation : invitation fixe, fiche et tâche jamais réécrites", () => {
  const r = { jour: "2026-11-24", heure: "14:30", nom: "Julie Martin", email: "julie@nova-exemple.fr", marque: "Nova", message: "Campagne janvier" };
  it("l'invitation Google a un titre et un texte fixes, sans rien du visiteur", () => {
    expect(INVITATION_RDV.titre).toBe("Visio TTP Creators");
    for (const t of [INVITATION_RDV.titre, INVITATION_RDV.texte]) {
      for (const v of [r.nom, r.email, r.marque, r.message]) expect(t).not.toContain(v);
    }
  });
  it("fiche existante : non modifiée, et la tâche dit quoi vérifier", () => {
    const t = tacheRdv({ r, duree: 30, meet: "https://meet.google.com/abc-defg-hij", carnet: { etat: "fiche", marque: "Nova", historique: "- 2026-11-10 · email · contact", sequenceEnCours: true }, visioOuverte: false });
    expect(t.text).toBe("Visio : Nova");
    expect(t.descr).toContain("Visio réservée par Julie Martin (julie@nova-exemple.fr) pour le mardi 24 novembre à 14 h 30 (30 min).");
    expect(t.descr).toContain("Lien Meet : https://meet.google.com/abc-defg-hij");
    expect(t.descr).toContain("Son besoin : Campagne janvier");
    expect(t.descr).toContain("fiche non modifiée, l'adresse n'a pas été confirmée par mail");
    expect(t.descr).toContain("Sa séquence de prospection continue : l'arrêter (sequence_contact) si c'est bien ce contact.");
    expect(t.descr).toContain("Historique :\n- 2026-11-10 · email · contact");
    const sansSequence = tacheRdv({ r, duree: 30, carnet: { etat: "fiche", marque: "", historique: "", sequenceEnCours: false }, visioOuverte: false });
    expect(sansSequence.descr).toContain("Déjà au carnet (sans marque)");
    expect(sansSequence.descr).not.toContain("séquence");
    expect(sansSequence.descr).not.toContain("Historique");
    expect(sansSequence.descr).not.toContain("Lien Meet");
  });
  it("nouveau contact, ou carnet raté", () => {
    expect(tacheRdv({ r, duree: 30, carnet: { etat: "nouveau" }, visioOuverte: false }).descr).toContain("Nouveau contact (ajouté au carnet, étiquette « Lead site »).");
    expect(tacheRdv({ r, duree: 30, carnet: { etat: "rate" }, visioOuverte: false }).descr).toContain("Contact pas ajouté au carnet");
  });
  it("une tâche « Visio : » déjà ouverte n'est pas réécrite : la réservation a sa propre tâche", () => {
    const t = tacheRdv({ r, duree: 45, carnet: { etat: "nouveau" }, visioOuverte: true });
    expect(t.text).toBe("Réservation : Nova");
    expect(t.descr).toContain("Une tâche « Visio : Nova » était déjà ouverte : elle n'a pas été modifiée.");
  });
});
