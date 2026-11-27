import { describe, expect, it } from "vitest";
import {
  accountTokens, disclosureAt, hasPromoCode, incidentCompte, incidentsConformite, journalEntry, journalStale, readJournal, tacheBloc, tacheTitre,
  type ConformiteIn, type ConformitePost,
} from "./conformite.ts";
import type { Exclusivite } from "./exclusivites.ts";

const NOW = new Date("2026-11-22T08:00:00Z");
let n = 0;
const post = (caption: string, extra: Partial<ConformitePost> = {}): ConformitePost => ({
  id: `p${++n}`, url: `https://www.instagram.com/reel/x${n}/`, at: "2026-11-19T12:00:00+0000", caption, product: "REELS", ...extra,
});
const exclu = (e: Partial<Exclusivite>): Exclusivite => ({
  id: "ex1", creator: "ZOÉ TEST", brand: "Nutripure", scope: "nutrition sportive et compléments alimentaires",
  competitors: ["Myprotein", "Prozis", "Bulk"], start: "2026-10-01", end: "2026-12-31", points: [], source: "pdf", createdAt: 0, ...e,
});
const base = (posts: ConformitePost[], over: Partial<ConformiteIn> = {}): ConformiteIn => ({
  creator: "ZOÉ TEST", posts, collabs: [], exclusivites: [], now: NOW,
  marques: [{ brand: "Teveo", tags: ["sport"] }, { brand: "Brushhoo", tags: ["Marque"] }, { brand: "Agence Lune", tags: ["Agence"] }, { brand: "Soon", tags: ["Marque"] }, { brand: "Airup", tags: ["nutrition"] }],
  ...over,
});

describe("signaux", () => {
  it("code promo", () => {
    expect(hasPromoCode("Tenue : teveo -10% code ZOETEST10")).toBe(true);
    expect(hasPromoCode("-10% avec ZOEPSL10 mes stars")).toBe(true);
    expect(hasPromoCode("* collaboration commerciale* -10% ZOELB10 Teveo")).toBe(true);
    expect(hasPromoCode("avec le code BLACKNOVEMBRE")).toBe(true);
    expect(hasPromoCode("Le code de la route, ça s'apprend")).toBe(false);
    expect(hasPromoCode("Ironman 2026, 180 km de vélo")).toBe(false);
  });
  it("comptes cités sans @", () => {
    expect(accountTokens("Unboxing des dernières holosport.official Swim 3")).toEqual(["holosport.official"]);
    expect(accountTokens("Photo: studio.lune et monsite.fr, 2.5 km")).toEqual(["studio.lune"]);
  });
  it("mention et sa position", () => {
    expect(disclosureAt("Collaboration commerciale avec Teveo")).toBe(0);
    expect(disclosureAt("Merci brushhoo *produit offert")).toBeGreaterThan(10);
    expect(disclosureAt("#Publicité")).toBe(1);
    expect(disclosureAt("Rien à signaler")).toBe(-1);
  });
});

describe("mention manquante", () => {
  it("code promo sans mention : incident, marque du carnet", () => {
    const r = incidentsConformite(base([post("C'était vide aujourd'hui 🤭 Tenue : teveo -10% code ZOETEST10 🧸 #gym")]));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ type: "mention", brand: "Teveo", creator: "ZOÉ TEST" });
    expect(r[0].detail).toMatch(/code promo/);
  });
  it("mention en tête : conforme", () => {
    expect(incidentsConformite(base([post("* collaboration commerciale* -10% ZOELB10 Teveo depuis des années")]))).toEqual([]);
    expect(incidentsConformite(base([post("Produit offert · Merci brushhoo pour ce porte-bébé")]))).toEqual([]);
    expect(incidentsConformite(base([post("#ad Ma tenue teveo code ZOE10")]))).toEqual([]);
  });
  it("mention en fin de légende d'un Reel : incident « trop loin »", () => {
    const r = incidentsConformite(base([post("Des portes bébés pensés pour le quotidien 💙 Merci brushhoo 🫰🏻 *produit offert")]));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ type: "mention", brand: "Brushhoo" });
    expect(r[0].detail).toMatch(/trop loin/);
  });
  it("même légende sur un post (pas un Reel) : visible avant « plus »", () => {
    expect(incidentsConformite(base([post("Des portes bébés pensés pour le quotidien 💙 Merci brushhoo 🫰🏻 *produit offert", { product: "FEED" })]))).toEqual([]);
  });
  it("marque d'une collab en cours, sans mention : incident même sans code", () => {
    const r = incidentsConformite(base([post("Ma routine du matin avec Kosbiotic, je ne m'en passe plus")], { collabs: [{ brand: "Kosbiotic", since: "2026-11-10T00:00:00Z" }] }));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ brand: "Kosbiotic" });
  });
  it("marque de collab citée avant la collab : pas un incident", () => {
    expect(incidentsConformite(base([post("Ma routine avec Kosbiotic", { at: "2026-11-09T10:00:00+0000" })], { collabs: [{ brand: "Kosbiotic", since: "2026-11-20T00:00:00Z" }] }))).toEqual([]);
  });
  it("« en collaboration avec » en fin de légende : incident", () => {
    const r = incidentsConformite(base([post("Fan de la nouvelle co ! Dispo dimanche à 11h 👀 #fyp #fitness En collaboration avec teveo")]));
    expect(r[0]).toMatchObject({ type: "mention", brand: "Teveo" });
  });
  it("unboxing d'un compte : incident avec le compte comme marque", () => {
    const r = incidentsConformite(base([post("Unboxing des dernières holosport.official Swim 3 🏊🏼‍♂️ J'ai toujours hésité")]))[0];
    expect(r).toMatchObject({ type: "mention", brand: "holosport" });
  });
  it("pas de faux positif : pas de marque, ou « lien en bio » sans marque", () => {
    expect(incidentsConformite(base([
      post("Podcast complet sur ma chaîne. Lien dans ma bio"),
      post("Vive la vie de femme triathlète 🩷 #triathlon"),
      post("Run to zara"),
      post("See you soon, lien en bio pour la vidéo"),
      post("Merci à l'Agence Lune pour la soirée, lien en bio"),
    ]))).toEqual([]);
  });
  it("posts trop anciens ignorés", () => {
    expect(incidentsConformite(base([post("teveo code ZOE10", { at: "2026-10-01T10:00:00+0000" })]))).toEqual([]);
  });
});

describe("conflit d'exclusivité", () => {
  it("concurrent cité pendant l'exclusivité", () => {
    const r = incidentsConformite(base([post("Une journée avec moi !! Mes snacks viennent de chez prozisfrance prozis 👀")], { exclusivites: [exclu({})] }));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ type: "exclusivite", brand: "Prozis" });
    expect(r[0].detail).toMatch(/exclusivité Nutripure \(jusqu'au 31 décembre 2026\)/);
  });
  it("la marque de l'exclusivité elle-même : rien", () => {
    expect(incidentsConformite(base([post("Collaboration commerciale : ma whey Nutripure")], { exclusivites: [exclu({})] }))).toEqual([]);
  });
  it("secteur : une marque « nutrition » du carnet tombe sous « nutrition sportive », pas une marque « sport »", () => {
    const r = incidentsConformite(base([post("Ma gourde airup au quotidien"), post("Ma tenue teveo du jour")], { exclusivites: [exclu({})] }));
    expect(r.map((i) => [i.type, i.brand])).toEqual([["exclusivite", "Airup"]]);
  });
  it("marque d'une collab du créateur : jamais en conflit", () => {
    const r = incidentsConformite(base([post("Collaboration commerciale · ma gourde airup")], { exclusivites: [exclu({})], collabs: [{ brand: "Airup", since: "2026-11-01" }] }));
    expect(r).toEqual([]);
  });
  it("exclusivité finie, ou d'un autre créateur : rien", () => {
    const p = [post("Mes snacks prozis")];
    expect(incidentsConformite(base(p, { exclusivites: [exclu({ end: "2026-11-01" })] }))).toEqual([]);
    expect(incidentsConformite(base(p, { exclusivites: [exclu({ creator: "Autre" })] }))).toEqual([]);
  });
  it("exclusivité à confirmer : incident « à vérifier », jamais un vrai conflit", () => {
    // Marques fictives.
    const lue = exclu({ brand: "Orbe", scope: "snacks protéinés", competitors: ["Kolibri"], pending: true });
    const r = incidentsConformite(base([post("Mes snacks kolibri du matin")], { exclusivites: [lue] }));
    expect(r.map((i) => [i.type, i.brand])).toEqual([["exclusivite_a_verifier", "Kolibri"]]);
    expect(r[0].id).toMatch(/:exclusivite_a_verifier$/);
    expect(r[0].detail).toMatch(/pas encore confirmée/);
    expect(r[0].correction).toMatch(/page Exclusivités/);
    expect(tacheTitre(r[0])).toBe("Conformité : Zoé Test · Kolibri · exclusivité à vérifier");
    expect(incidentCompte(r[0].type)).toBe(false);
    // Même marque déjà en conflit avec une exclusivité confirmée : un seul incident, le vrai.
    const sure = exclu({ id: "ex2", brand: "Atelier Brume", competitors: ["Kolibri"] });
    const deux = incidentsConformite(base([post("Mes snacks kolibri du matin")], { exclusivites: [sure, { ...lue, id: "ex3" }] }));
    expect(deux.map((i) => i.type)).toEqual(["exclusivite"]);
  });
  it("catégorie lue dans le nom d'une marque du carnet ; une catégorie de fiche contact n'est pas un secteur", () => {
    const parfum = exclu({ brand: "Atelier Brume", scope: "parfum", competitors: [] });
    const marques = [{ brand: "Maison Lumen Parfums", tags: ["Marque"] }, { brand: "Kora", tags: ["Marque"] }];
    const r = incidentsConformite(base([post("Ma routine avec maison lumen parfums"), post("Ma tenue kora du jour")], { exclusivites: [parfum], marques }));
    expect(r.map((i) => [i.type, i.brand])).toEqual([["exclusivite", "Maison Lumen Parfums"]]);
    const large = exclu({ brand: "Atelier Brume", scope: "toute marque concurrente", competitors: [] });
    expect(incidentsConformite(base([post("Ma tenue kora du jour")], { exclusivites: [large], marques }))).toEqual([]);
  });
  it("un post peut avoir les deux incidents", () => {
    const r = incidentsConformite(base([post("Mes snacks prozis -10% code ZOE10")], { exclusivites: [exclu({})] }));
    expect(r.map((i) => i.id.split(":")[1]).sort()).toEqual(["exclusivite", "mention"]);
  });
});

describe("tâche et journal", () => {
  const [i] = incidentsConformite(base([post("Tenue teveo code ZOE10", { id: "123", url: "https://www.instagram.com/reel/abc/" })]));
  it("titre et description", () => {
    expect(tacheTitre(i)).toBe("Conformité : Zoé Test · Teveo · mention manquante");
    expect(tacheBloc(i)).toContain("https://www.instagram.com/reel/abc/");
    expect(tacheBloc(i)).toContain("Collaboration commerciale");
    expect(tacheBloc(i)).not.toMatch(/[—–]/);
    expect(i.id).toBe("123:mention");
  });
  it("journal : lecture et ménage", () => {
    const j = readJournal({ a: journalEntry(i, NOW), b: { type: "mention", at: "2025-01-01", seen: "2025-01-01T00:00:00Z" }, c: "bizarre", d: null, e: { type: "exclusivite_a_verifier", at: "2026-11-20", seen: "2026-11-21T00:00:00Z" } });
    expect(Object.keys(j)).toEqual(["a", "b", "e"]); // l'incident « à vérifier » est gardé : sinon une tâche par passage
    expect(Object.values(j).filter((x) => incidentCompte(x.type))).toHaveLength(2);
    expect(journalStale(j, NOW)).toEqual(["b"]);
    expect(readJournal(undefined)).toEqual({});
  });
});
