import { describe, expect, it } from "vitest";
import { agenceDuProfil, cleCompte, decompte, jourCourt, ligneSansReponse, sansReponse, type Demande, type FilDm, type ProfilDm } from "./dmSansReponse.ts";

const now = new Date("2026-11-25T08:00:00Z");
const base: Demande = { now, joursMin: 7, type: "tous", abonnesMin: 0, sansContact: true, sansAgence: true };
const fil = (username: string, jours: number, plus: Partial<FilDm> = {}): FilDm => ({
  id: username, username, name: null, followers: null, updated_at: new Date(now.getTime() - jours * 86_400_000).toISOString(), emails: null, contact_id: null, ...plus,
});
const profil = (username: string, plus: Partial<ProfilDm> = {}): ProfilDm => ({ username, isBrand: null, website: null, email: null, followers: null, agency: null, agence: null, agence_nom: null, ...plus });

const fils = [
  fil("Nova.Paris", 30, { name: "Nova  Paris", followers: 1000 }),
  fil("zoe.creatrice", 12, { emails: ["Zoe@Exemple.fr", "zoe@exemple.fr"] }),
  fil("ines.mgmt", 20),
  fil("recent", 2),
  fil("inconnu.compte", 90, { followers: 250000 }),
  fil("deja.contact", 40, { contact_id: "c1" }),
  fil("au.carnet", 40),
  fil("nova.paris", 5),
  fil("", 50),
];
const profils = [
  profil("nova.paris", { isBrand: true, website: "https://nova.fr", email: "Hello@Nova.fr", followers: 84000 }),
  profil("zoe.creatrice", { isBrand: false, followers: 132000 }),
  profil("ines.mgmt", { isBrand: false, followers: 400000, agency: "Studio Mgmt" }),
  profil("au.carnet", { isBrand: true, followers: 5000 }),
];
const carnet = new Set(["au.carnet"]);

describe("conversations Instagram sans réponse", () => {
  it("garde nos messages restés sans réponse, les plus gros comptes d'abord", () => {
    const r = sansReponse(fils, profils, carnet, base);
    expect(r.map((l) => l.compte)).toEqual(["@inconnu.compte", "@zoe.creatrice", "@nova.paris"]);
    expect(r[2]).toEqual({ compte: "@nova.paris", nom: "Nova Paris", genre: "marque", abonnes: 84000, jours: 30, dernier: "26 oct.", site: "https://nova.fr", emailProfil: "hello@nova.fr", emailsDm: [], agence: "", auCarnet: false });
    expect(r[1].emailsDm).toEqual(["zoe@exemple.fr"]);
    expect(decompte(r)).toBe("1 marque(s), 1 créateur(s), 1 profil(s) jamais lu(s)");
  });

  it("filtre par genre, par abonnés, et peut montrer le carnet et les créateurs en agence", () => {
    expect(sansReponse(fils, profils, carnet, { ...base, type: "marques" }).map((l) => l.compte)).toEqual(["@nova.paris"]);
    expect(sansReponse(fils, profils, carnet, { ...base, type: "createurs" }).map((l) => l.compte)).toEqual(["@zoe.creatrice"]);
    expect(sansReponse(fils, profils, carnet, { ...base, type: "inconnus" }).map((l) => l.compte)).toEqual(["@inconnu.compte"]);
    expect(sansReponse(fils, profils, carnet, { ...base, abonnesMin: 100000 }).map((l) => l.compte)).toEqual(["@inconnu.compte", "@zoe.creatrice"]);
    expect(sansReponse(fils, profils, carnet, { ...base, type: "createurs", sansAgence: false }).map((l) => [l.compte, l.agence])).toEqual([["@ines.mgmt", "Studio Mgmt"], ["@zoe.creatrice", ""]]);
    expect(sansReponse(fils, profils, carnet, { ...base, type: "marques", sansContact: false }).map((l) => [l.compte, l.auCarnet])).toEqual([["@nova.paris", false], ["@au.carnet", true]]);
    expect(sansReponse(fils, profils, carnet, { ...base, joursMin: 0 }).map((l) => l.compte)).toContain("@recent");
  });

  it("écrit une ligne lisible", () => {
    const r = sansReponse(fils, profils, carnet, base);
    expect(ligneSansReponse(r[2])).toBe("- @nova.paris (Nova Paris) · marque · 84 000 abonnés · notre dernier message : 26 oct., il y a 30 j · e-mail du profil : hello@nova.fr · site : https://nova.fr".replace("84 000", (84000).toLocaleString("fr-FR")));
    expect(ligneSansReponse(r[0])).toContain("profil jamais lu");
    expect(ligneSansReponse(r[1])).toContain("e-mail donné en DM : zoe@exemple.fr");
  });

  it("lit un compte, une agence, une date", () => {
    expect(cleCompte("https://www.instagram.com/Nova.Paris/?hl=fr")).toBe("nova.paris");
    expect(cleCompte("@@Nova.Paris ")).toBe("nova.paris");
    expect(agenceDuProfil(profil("x", { agence: "oui", agence_nom: "Studio" }))).toBe("Studio");
    expect(agenceDuProfil(profil("x", { agence: "oui" }))).toBe("oui");
    expect(agenceDuProfil(profil("x", { agence: "non", agency: null }))).toBe("");
    expect(agenceDuProfil(undefined)).toBe("");
    expect(jourCourt("2026-10-26T08:00:00Z")).toBe("26 oct.");
    expect(jourCourt("pas une date")).toBe("");
  });
});
