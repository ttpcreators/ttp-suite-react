import { describe, expect, it } from "vitest";
import { langueAVerifier, parleFrancais, raisonPasRecrutable } from "./recrutement.ts";

// Comptes fictifs, inspirés des cas réels rencontrés dans la Base créateurs.
describe("parleFrancais", () => {
  it("reconnaît une bio française, un drapeau, une ville ou un site en .fr", () => {
    expect(parleFrancais({ bio: "Je cuisine pour vous : recettes et menus chaque semaine" })).toBe(true);
    expect(parleFrancais({ bio: "Architect & creator 🇫🇷" })).toBe(true);
    expect(parleFrancais({ bio: "Sport | travel | lifestyle\n📍 Lyon" })).toBe(true);
    expect(parleFrancais({ bio: "Hello", website: "https://exemple-creatrice.fr" })).toBe(true);
  });
  it("reconnaît une bio étrangère", () => {
    expect(parleFrancais({ bio: "Fashion and travel for your daily life, based in Munich" })).toBe(false);
    expect(parleFrancais({ bio: "Open worldwide for collaborations" })).toBe(false);
    expect(parleFrancais({ bio: "Мода и путешествия" })).toBe(false);
  });
  it("ne tranche pas quand rien ne le dit", () => {
    expect(parleFrancais({ bio: "Pro surfer 🏄 Olympic medalist" })).toBe(null);
    expect(langueAVerifier({ bio: "Pro surfer 🏄 Olympic medalist" })).toBe(true);
  });
});

describe("raisonPasRecrutable", () => {
  const creatrice = { name: "Léa Martin", bio: "Je partage mes recettes et ma vie de maman 📍Nantes", followers: 250_000 };
  it("garde une créatrice francophone sans agence", () => {
    expect(raisonPasRecrutable("lea.martin", creatrice)).toBe(null);
    expect(raisonPasRecrutable("maisonlea", { ...creatrice, name: "Léa | MAISON LÉA" })).toBe(null);
    expect(raisonPasRecrutable("lea.surf", { name: "Léa Surf", bio: "Pro surfer 🏄 Olympic medalist", followers: 200_000 })).toBe(null);
  });
  it("écarte les comptes trop gros", () => {
    expect(raisonPasRecrutable("lea.martin", { ...creatrice, followers: 2_500_000 })).toMatch(/2 millions/);
  });
  it("écarte marques, médias et lieux", () => {
    expect(raisonPasRecrutable("marque_fictive", { name: "Marque Fictive", bio: "Livraison offerte dès 50 €, nouvelle collection", followers: 300_000 })).toMatch(/marque/);
    expect(raisonPasRecrutable("fictif_officiel", { name: "Fictif", bio: "Le compte", followers: 300_000 })).toMatch(/marque/);
    expect(raisonPasRecrutable("courir_media", { name: "Courir Média", bio: "Le média n°1 de la course à pied", followers: 300_000 })).toMatch(/marque/);
    expect(raisonPasRecrutable("grandmagasin", { name: "Grandmagasin", bio: "Tout commence au Grandmagasin 💚", followers: 600_000 })).toMatch(/marque/);
    expect(raisonPasRecrutable("leamartin", { name: "Léa Martin", bio: "Je cuisine pour vous chez Léa", followers: 200_000 })).toBe(null);
    expect(raisonPasRecrutable("ciné_fictif", { name: "Cinémas Fictifs", bio: "Sorties et avant-premières", followers: 300_000 })).toMatch(/marque/);
  });
  it("écarte artistes et comptes déjà représentés", () => {
    expect(raisonPasRecrutable("chanteuse", { name: "Chanteuse", bio: "Nouvel album, en tournée", followers: 300_000 })).toMatch(/artiste/);
    expect(raisonPasRecrutable("lea.martin", { ...creatrice, email: "lea@talents-fictifs.com" })).toMatch(/agence/);
    expect(raisonPasRecrutable("lea.martin", { ...creatrice, bio: `${creatrice.bio}\nManagement @agence_fictive` })).toMatch(/représenté|agence/);
  });
  it("écarte une bio étrangère", () => {
    expect(raisonPasRecrutable("anna", { name: "Anna", bio: "Fashion and travel for your daily life, based in Munich", followers: 300_000 })).toMatch(/français/);
  });
});
