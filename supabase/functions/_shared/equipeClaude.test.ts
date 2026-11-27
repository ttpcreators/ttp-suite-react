import { describe, expect, it } from "vitest";
import { ligneActionEquipe, OUTILS_EQUIPE } from "./equipeClaude.ts";

describe("ce que l'équipe fait par son Claude", () => {
  it("résume un brouillon de mail", () => {
    const s = JSON.stringify({ a: "adele@exemple.fr", boite: "partnerships", message: "Hello Adèle,\n\nJ'espère que tu vas bien." });
    expect(ligneActionEquipe("creer_brouillon_mail", s)).toBe("brouillon (partnerships) à adele@exemple.fr · Hello Adèle, J'espère que tu vas bien.…");
  });
  it("lit un résumé coupé en plein milieu", () => {
    const s = '{"a":"mandy@exemple.fr","boite":"talent","message":"Hello Mandy, C\'est Marc, de TTP Cre';
    expect(ligneActionEquipe("creer_brouillon_mail", s)).toContain("brouillon (talent) à mandy@exemple.fr");
  });
  it("résume un contact et une tâche", () => {
    expect(ligneActionEquipe("ajouter_contact", JSON.stringify({ nom: "Louna Test", marque: "Agence Test" }))).toBe("contact ajouté : Louna Test, Agence Test");
    expect(ligneActionEquipe("creer_tache", JSON.stringify({ texte: "Relancer Nova" }))).toBe("tâche créée : Relancer Nova");
  });
  it("compte la prospection et le recrutement de l'équipe", () => {
    for (const t of ["programmer_envoi", "ajouter_contacts", "ne_plus_contacter", "noter_contact_createur"]) expect(OUTILS_EQUIPE).toContain(t);
  });
  it("résume un envoi programmé : boîte, nombre de mails, lot", () => {
    const s = JSON.stringify({ boite: "partnerships", brouillons: ["r1", "r2", "r3"], demarrer_sequence: true, lot: "prospection 25/11" });
    expect(ligneActionEquipe("programmer_envoi", s)).toBe("envoi programmé (partnerships) : 3 mails · lot « prospection 25/11 »");
    expect(ligneActionEquipe("programmer_envoi", '{"boite":"talent","brouillons":["r1","r2","r3')).toBe("envoi programmé (talent) : 2 mails ou plus");
  });
  it("résume un lot de contacts : nombre de fiches et premières marques", () => {
    const s = JSON.stringify({ contacts: [{ marque: "Nova", email: "a@nova.example" }, { marque: "Kora" }, { marque: "Solvi" }, { marque: "Lumo" }] });
    expect(ligneActionEquipe("ajouter_contacts", s)).toBe("contacts ajoutés en lot : 4 fiches (Nova, Kora, Solvi…)");
    expect(ligneActionEquipe("ajouter_contacts", '{"contacts":[{"marque":"Nova","email":"a@nova.example"},{"marque":"Kora","nom":"Mar')).toBe("contacts ajoutés en lot : 2 fiches ou plus (Nova, Kora…)");
  });
  it("résume la liste « ne plus contacter » : adresse ou domaine", () => {
    expect(ligneActionEquipe("ne_plus_contacter", JSON.stringify({ action: "ajouter", email: "contact@exemple.fr", raison: "refus" }))).toBe("ne plus contacter : contact@exemple.fr (refus)");
    expect(ligneActionEquipe("ne_plus_contacter", JSON.stringify({ action: "ajouter", domaine: "exemple.fr", raison: "arret" }))).toBe("ne plus contacter : @exemple.fr (demande d'arrêt)");
    expect(ligneActionEquipe("ne_plus_contacter", JSON.stringify({ action: "retirer", domaine: "exemple.fr" }))).toBe("retiré de « ne plus contacter » : @exemple.fr");
    expect(ligneActionEquipe("ne_plus_contacter", JSON.stringify({ action: "lister" }))).toBe("liste « ne plus contacter » consultée");
  });
  it("résume un contact créateur noté : nom, canal", () => {
    expect(ligneActionEquipe("noter_contact_createur", JSON.stringify({ profil: "Zoé Martin", canal: "dm" }))).toBe("contact créateur noté (DM) : Zoé Martin");
    const id = "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0";
    expect(ligneActionEquipe("noter_contact_createur", JSON.stringify({ profil: id, canal: "email" }))).toBe(`contact créateur noté (mail) : fiche Scouting ${id}`);
  });
});

import { doublonEquipe } from "./equipeClaude.ts";

describe("pas de doublon de message dans l'équipe", () => {
  const l = (summary: object | string, qui = "Gianni") => ({ tool: "creer_brouillon_mail", summary: typeof summary === "string" ? summary : JSON.stringify(summary), at: "2026-11-25T20:00:00Z", qui });
  it("trouve un nouveau mail au même destinataire", () => {
    expect(doublonEquipe([l({ a: "Adele@Exemple.fr", boite: "partnerships" })], ["adele@exemple.fr"], "")?.qui).toBe("Gianni");
  });
  it("lit un résumé coupé", () => {
    expect(doublonEquipe([l('{"a":"mandy@exemple.fr","boite":"talent","message":"Hello Ma')], ["mandy@exemple.fr"], "")).not.toBeNull();
  });
  it("ne confond pas une réponse dans un fil avec un premier mail", () => {
    expect(doublonEquipe([l({ a: "adele@exemple.fr", fil: "abc123" })], ["adele@exemple.fr"], "")).toBeNull();
    expect(doublonEquipe([l({ a: "adele@exemple.fr", fil: "abc123" })], ["adele@exemple.fr"], "abc123")).not.toBeNull();
    expect(doublonEquipe([l({ a: "autre@exemple.fr" })], ["adele@exemple.fr"], "")).toBeNull();
  });
});
