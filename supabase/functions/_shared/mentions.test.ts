import { describe, expect, it } from "vitest";
import { brandAccountOk, citesHandle, handleCandidates, isCommonWord, ownsName, proseWords } from "./mentions.ts";

const none = new Set<string>();
const weights = (caption: string, paid = false, prose?: Set<string>, known = none) =>
  Object.fromEntries(handleCandidates(caption, known, paid, prose).map((c) => [c.u, c.w]));
/** Noms qui atteignent le seuil du radar (2) dans un seul post. */
const strong = (caption: string, paid = false, prose?: Set<string>) => Object.keys(weights(caption, paid, prose)).filter((u) => weights(caption, paid, prose)[u] >= 2);

describe("mots courants pris pour des marques (vraies légendes du radar, 2026-11-20)", () => {
  it("une préposition suivie d'un mot ne fait plus un compte", () => {
    expect(weights("the place where you have built your life, with every surge making the walls feel")).toEqual({});
    expect(weights("audiences have been absolutely obsessed with her. Known for her acting talent")).not.toHaveProperty("her");
    expect(weights("I loved the feeling of connecting with people and making them happy")).not.toHaveProperty("people");
    expect(weights("Une sacré saison de triathlon s’annonce avec non pas un, mais deux Ironman")).not.toHaveProperty("non");
  });
  it("un mot long de la langue ne fait plus un compte", () => {
    expect(weights("Faites très attention à ces red flags les amis")).toEqual({});
    expect(weights("Parce que les toppings c’est très important et ça pimp tout de suite un bowl")).toEqual({});
    expect(weights("one of the most remarkable Thracian finds in Bulgaria")).toEqual({});
    expect(weights("every girl’s signature move")).toEqual({});
    expect(weights("Haworth’s newsletter for the architecture and design community", true)).not.toHaveProperty("architecture");
    // Hors liste : un mot long reste un indice faible (1), jamais assez dans un seul post…
    expect(strong("a specification that perfectly highlights the aggressive yet elegant character")).toEqual([]);
    // … et rien du tout quand les légendes l'écrivent aussi avec une majuscule.
    const prose = proseWords(["Character is everything", "Perfectly imperfect", "Character study", "Perfectly done"]);
    expect(weights("perfectly balanced, with character", false, prose)).toEqual({});
  });
  it("mesures, heures et rangs ne sont pas des comptes", () => {
    expect(weights("Départ à 09h30 pour 10km, 3rd place, 100g de protéines, cadre 70x100, 1.5km de plus")).toEqual({});
    expect(weights("Sortie longue #100km #10k #ad", true)).toEqual({});
    expect(weights("merci 226ers et 111skin")).toMatchObject({ "226ers": 3, "111skin": 3 }); // de vraies marques
  });
  it("un hashtag de sujet dans un post payé n'est pas une marque", () => {
    expect(weights("exfrance 🤍 Collaboration commerciale #run #sport", true)).toEqual({});
    expect(strong("exfrance 🤍 Collaboration commerciale #run #sport #CookeoSimplicity", true)).toEqual([]);
  });
  it("ces mots sont dans la liste des mots courants", () => {
    for (const w of ["every", "attention", "important", "signature", "highlights", "people", "her", "non", "adventure", "remarkable"]) {
      expect(isCommonWord(w)).toBe(true);
    }
  });
});

describe("mots de la langue repérés dans les légendes elles-mêmes (proseWords)", () => {
  const caps = ["Serenity now, let's go", "Serenity is the key to a good morning", "louisvuitton show tonight", "Merci à la ffcyclisme"];
  const prose = proseWords(caps);
  it("un mot écrit au moins deux fois avec une majuscule est un mot", () => {
    expect(prose.has("serenity")).toBe(true);
    expect(prose.has("louisvuitton")).toBe(false);
    expect(proseWords(["Serenity now"]).has("serenity")).toBe(false); // une fois ne suffit pas
  });
  it("un mot de la langue ne compte qu'avec un indice fort", () => {
    expect(weights("le calme et la serenity retrouvée", false, prose)).toEqual({});
    expect(weights("one week with serenity in the mountains", false, prose)).toEqual({});
    expect(weights("one week with serenity in the mountains")).toEqual({ serenity: 1 }); // sans la liste : indice faible
    expect(weights("merci serenity pour ce cadeau", false, prose)).toEqual({ serenity: 3 });
  });
});

describe("vraies marques qui doivent rester", () => {
  it("indices forts : crédit, remerciement, forme d'un nom de compte", () => {
    expect(weights("Narrated by auliicravalho")).toEqual({ auliicravalho: 3 });
    expect(weights("Photo by jean.dupont — dress by sezane")).toMatchObject({ "jean.dupont": 3, sezane: 3 });
    expect(weights("Merci à la ffcyclisme pour le week-end ! 📸 tomcard__")).toMatchObject({ ffcyclisme: 1, tomcard__: 3 });
    expect(weights("wearing jacquemus today")).toEqual({ jacquemus: 3 });
    expect(weights("Maquillage sur lebonlebon avec diorbeauty coiffure alexgloaguen")).toMatchObject({ diorbeauty: 1, alexgloaguen: 1 });
  });
  it("une marque connue compte toujours, même si c'est un mot", () => {
    expect(weights("Une journée avec gymshark", false, new Set(["gymshark"]), new Set(["gymshark"]))).toEqual({ gymshark: 6 });
  });
  it("hashtag de marque dans un post payé : indice faible, à confirmer", () => {
    expect(weights("my lorealparis skin 🤍 #lorealparispartner #ad", true)).toEqual({ lorealparis: 1, lorealparispartner: 1 });
    expect(weights("Code LEA10 #alo_yoga #ad", true)).toEqual({ alo_yoga: 2 });
  });
});

describe("le compte Meta porte-t-il ce nom (ownsName, brandAccountOk) ?", () => {
  it("vraies marques : nom affiché ou site", () => {
    expect(ownsName("louisvuitton", "Louis Vuitton")).toBe(true);
    expect(ownsName("chanelofficial", "CHANEL")).toBe(true);
    expect(ownsName("asicstrail", "", "http://likeshop.me/asicstrail")).toBe(true);
    expect(ownsName("laregionoccitanie", "Région Occitanie")).toBe(true);
    expect(ownsName("ffcyclisme", "Fédération 🇫🇷 de Cyclisme")).toBe(true);
    expect(ownsName("patmcgrathreal", "", "https://www.patmcgrath.com")).toBe(true);
    expect(ownsName("overstims", "OVERSTIM.s officiel", "https://www.overstims.com")).toBe(true);
    expect(ownsName("acg", "All Conditions Gear", "https://empli.fi/acg/")).toBe(true);
    expect(ownsName("recettevegetarienne", "Recettes Végétariennes", "https://www.recette-vegetarienne.fr")).toBe(true);
  });
  it("un mot pris par une personne ou une autre page : non", () => {
    expect(ownsName("every", "leif gann-matzen", "http://leifgannmatzen.com")).toBe(false);
    expect(ownsName("architecture", "StudioArchis", "http://www.studioarchis.com/")).toBe(false);
    expect(ownsName("production", "Niels Bor", "http://darkmatterworks.com")).toBe(false);
    expect(ownsName("authentique", "Linda Chrisnach✨🪷", "https://www.chogangroupspa.com/registration")).toBe(false);
    expect(ownsName("intention", "Katie", "https://macrameforest.etsy.com")).toBe(false);
  });
  it("brandAccountOk : un @ fait d'un mot doit porter ce nom, avec 1 000 abonnés ou un site à son nom", () => {
    expect(brandAccountOk("louisvuitton", { name: "Louis Vuitton", website: "http://on.louisvuitton.com/x", followers: 55105676 })).toBe(true);
    expect(brandAccountOk("every", { name: "leif gann-matzen", website: "http://leifgannmatzen.com", followers: 3624 })).toBe(false);
    expect(brandAccountOk("attention", { name: "ATTENTION", website: "https://www.attentionglobal.com/", followers: 889 })).toBe(false);
    expect(brandAccountOk("memorable", { name: "memorable", website: "http://starbeam.world", followers: 631 })).toBe(false);
    expect(brandAccountOk("people", { name: "People Magazine", website: "http://people.com", followers: 15013265 })).toBe(false); // mot courant
    expect(brandAccountOk("jean.dupont", { name: "Jean", website: "", followers: 200 })).toBe(true); // pas un mot : règle habituelle
    // Petite marque avec son propre site : gardée.
    expect(brandAccountOk("cutisparis", { name: "Lingerie nude pour toutes les carnations.", website: "https://www.cutisparis.fr/", followers: 187 })).toBe(true);
    // Petite page dont le site n'est pas à son nom : non.
    expect(brandAccountOk("horizontales", { name: "Yoko Iijima", website: "http://yokoiijima.tumblr.com/", followers: 160 })).toBe(false);
  });
});

describe("citesHandle (inchangé)", () => {
  it("mot entier seulement", () => {
    expect(citesHandle("Merci sezane pour la robe", "sezane")).toBe(true);
    expect(citesHandle("sezaneparis", "sezane")).toBe(false);
  });
});
