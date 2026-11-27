import { describe, expect, it } from "vitest";
import {
  activeByCreator, addToIso, blockedCreators, conflictsFor, daysLeft, excluLine, excluState, findDuration, firstDate,
  fromAppContract, readContract, readExclusivites, type Exclusivite,
} from "./exclusivites.ts";

const today = "2026-10-29";
const ex = (o: Partial<Exclusivite>): Exclusivite => ({
  id: "e1", creator: "lena test", brand: "Nike", scope: "", competitors: [], start: "2026-10-01", end: "2026-12-12",
  points: [], source: "manuel", createdAt: 0, ...o,
});

describe("exclusivités : état et conflits", () => {
  it("état, jours restants, ligne pour Claude", () => {
    expect(excluState(ex({}), today)).toBe("en_cours");
    expect(excluState(ex({ start: "2026-11-05" }), today)).toBe("a_venir");
    expect(excluState(ex({ end: "2026-10-28" }), today)).toBe("terminee");
    expect(excluState(ex({ end: null }), today)).toBe("en_cours");
    expect(daysLeft(ex({}), today)).toBe(44);
    expect(excluLine(ex({ competitors: ["Adidas", "Puma"], scope: "sport" }))).toBe("exclu Nike jusqu'au 2026-12-12 (secteur sport, concurrents Adidas, Puma)");
  });
  it("une marque concurrente citée ou du même secteur bloque le créateur, jamais la marque elle-même", () => {
    const list = [ex({ competitors: ["Adidas", "Puma"], scope: "vêtements de sport" })];
    expect(conflictsFor(list, "LENA TEST", "adidas", today)).toHaveLength(1);
    expect(conflictsFor(list, "Lena Test", "Adidas France", today)).toHaveLength(1);
    expect(conflictsFor(list, "Lena Test", "Nike", today)).toHaveLength(0);
    expect(conflictsFor(list, "Lena Test", "Sephora", today)).toHaveLength(0);
    expect(conflictsFor(list, "Lena Test", "Decathlon", today, ["Sport"])).toHaveLength(1);
    expect(conflictsFor(list, "Autre", "Adidas", today)).toHaveLength(0);
    expect(conflictsFor([ex({ competitors: ["Adidas"], end: "2026-10-01" })], "Lena Test", "Adidas", today)).toHaveLength(0);
    const blocked = blockedCreators(list, "Puma", today);
    expect(blocked.get("lena test")).toBe("Exclu Nike · 2026-12-12");
    expect(activeByCreator(list, today).get("lena test")).toHaveLength(1);
  });
  it("lecture tolérante du blob", () => {
    expect(readExclusivites([ex({}), null, { id: 3 }, { id: "x", creator: "a", brand: "b", competitors: "Adidas" }])).toHaveLength(2);
    expect(readExclusivites("rien")).toEqual([]);
  });
});

describe("dates et durées", () => {
  it("durées écrites en chiffres ou en lettres", () => {
    expect(findDuration("pendant trente (30) jours")).toEqual({ n: 30, unit: "jours" });
    expect(findDuration("for a period of 6 months")).toEqual({ n: 6, unit: "mois" });
    expect(findDuration("pendant deux semaines")).toEqual({ n: 14, unit: "jours" });
    expect(findDuration("pendant 1 an")).toEqual({ n: 12, unit: "mois" });
    expect(findDuration("rien")).toBeNull();
    expect(addToIso("2026-01-31", 1, "mois")).toBe("2026-02-28");
    expect(firstDate("Fait à Lyon le 12 novembre 2026")).toBe("2026-11-12");
    expect(firstDate("signé le 03/11/2026")).toBe("2026-11-03");
  });
});

describe("contrats", () => {
  it("contrat fait dans l'app : exclusivité catégorie 90 jours", () => {
    const d = fromAppContract({ id: "h1", ctName: "lena test", brand: "Nike", ref: "TTP-2026-101", ts: Date.UTC(2026, 9, 1), form: { exclScope: "cat90", deliverables: "2 reels", value: "1 500 €" } });
    expect(d).toMatchObject({ start: "2026-10-01", end: "2026-12-30", scope: "même catégorie de produits", source: "contrat" });
    expect(d?.points).toEqual(["Livrables : 2 reels", "Montant : 1 500 €"]);
    expect(fromAppContract({ id: "h2", ctName: "x", brand: "y", ts: 0, form: { exclScope: "non" } })).toBeNull();
  });
  it("contrat PDF : créateur, marque, clause d'exclusivité et points clés", () => {
    const text = `CONTRAT DE PARTENARIAT. Entre la société NIKE France et Lena Test, créatrice de contenu. Fait à Paris le 1 octobre 2026.
      Article 3 – Livrables. La créatrice réalisera 2 reels Instagram et 3 stories.
      Article 4 – Rémunération. En contrepartie, la marque versera la somme de 2 500 € HT, payable à 30 jours fin de mois.
      Article 6 – Exclusivité. Pendant une durée de trois (3) mois à compter de la publication, la créatrice s'interdit toute collaboration avec une marque concurrente du secteur des vêtements de sport, notamment Adidas, Puma et Under Armour.
      Article 7 – Droits d'utilisation. Les droits d'usage sont cédés pour 6 mois sur les réseaux sociaux de la marque.`;
    const r = readContract(text, { creators: ["lena test", "Margaux Test"], brands: ["Nike", "Sephora"] }, today);
    expect(r.creator).toBe("lena test");
    expect(r.brand).toBe("Nike");
    expect(r.exclusivity).toMatchObject({ start: "2026-10-01", end: "2027-01-01", competitors: ["Adidas", "Puma", "Under Armour"] });
    expect(r.exclusivity?.scope).toContain("vetements de sport");
    expect(r.points.map((p) => p.split(" : ")[0])).toEqual(["Montant", "Livrables", "Droits d'usage", "Paiement"]);
  });
  it("contrat sans exclusivité", () => {
    expect(readContract("Contrat simple. La marque paie 500 € pour 1 post.", { creators: [], brands: [] }, today).exclusivity).toBeNull();
  });
});

import { looksLikeContract, proposalFromMail } from "./exclusivites.ts";

describe("contrats reçus par mail", () => {
  it("repère un PDF de contrat par son nom ou l'objet du mail", () => {
    expect(looksLikeContract("Contrat_Solvi_Lena.pdf", "Documents")).toBe(true);
    expect(looksLikeContract("Agreement-Kora-Zoe.pdf", "")).toBe(true);
    expect(looksLikeContract("Doc 2026.pdf", "Contrat de collaboration à signer")).toBe(true);
    expect(looksLikeContract("Brief Nova.pdf", "Brief de la campagne")).toBe(false);
    expect(looksLikeContract("Contrat.docx", "Contrat")).toBe(false);
  });

  it("propose une exclusivité à confirmer, qui ne bloque personne tant qu'elle n'est pas confirmée", () => {
    const text = "Contrat de collaboration entre Solvi et Léna Morel, signé le 1er octobre 2026. Le Talent s'engage à ne pas collaborer avec une marque concurrente du secteur de la nutrition sportive, notamment Myprotein, Bulk et Foodspring, pendant une durée de 3 mois à compter du 1er octobre 2026. Rémunération : 900 € HT.";
    const r = readContract(text, { creators: ["LÉNA MOREL"], brands: ["Solvi"] }, "2026-11-04");
    const p = proposalFromMail(r, { creatorHint: null, brandHint: null, fileName: "Contrat.pdf", docPath: "contrats/x.pdf", mail: { threadId: "t1", box: "talent" }, today: "2026-11-04" });
    expect(p).toMatchObject({ creator: "LÉNA MOREL", brand: "Solvi", pending: true, source: "mail", start: "2026-10-01", end: "2027-01-01" });
    expect(p?.competitors).toEqual(["Myprotein", "Bulk", "Foodspring"]);
    expect(p?.scope).toBe("nutrition sportive");
    const e = { ...p!, id: "x", createdAt: 0 };
    expect(conflictsFor([e], "LÉNA MOREL", "Myprotein", "2026-11-04")).toEqual([]);
    expect(conflictsFor([{ ...e, pending: false }], "LÉNA MOREL", "Myprotein", "2026-11-04")).toHaveLength(1);
  });

  it("pas de clause d'exclusivité : pas de proposition", () => {
    const r = readContract("Contrat de cession de droits. Rémunération : 500 €.", { creators: [], brands: [] }, "2026-11-04");
    expect(proposalFromMail(r, { creatorHint: "Zoé", brandHint: "Kora", fileName: "c.pdf", docPath: null, mail: { threadId: "t", box: "talent" }, today: "2026-11-04" })).toBeNull();
  });
});

import {
  A_VERIFIER, aVerifierCreators, alertesExclu, clauseExclusivite, estAVerifier, fusionnerProposition, hitsBrand, memeAffaire, memeCreateur, nieExclusivite,
  phraseDouteuse, secteurDansNom, termesSecteur, texteAlerte, trouverCreateur,
} from "./exclusivites.ts";

// Phrases fictives, écrites comme dans les contrats reçus par l'agence (aucune vraie marque).
describe("lecture des contrats : ce qui dit le contraire n'est pas une exclusivité", () => {
  const contraires = [
    "Licence d'exploitation : le Créateur accorde à la Marque une licence d'exploitation non exclusive sur ce contenu pour une durée stricte de 3 mois à compter de la première diffusion de la publicité.",
    "Licence d'exploitation : le Créateur accorde à la Marque une licence d'exploitation non exclusive (sans aucune exclusivité sur le secteur des cosmétiques pour le Créateur) pour une durée de 3 mois.",
    "Rémunération : la présente collaboration est réalisée exclusivement sous la forme d'un produit offert, également appelée gifting.",
    "Le Créateur n'est soumis à aucune exclusivité et reste libre de collaborer avec d'autres marques, y compris concurrentes.",
    "Pas d'exclusivité : le Talent peut travailler avec toute autre marque pendant la campagne.",
    "Exclusivité : non.",
    "Exclusivité : non exclusif.",
    "Le contrat est conclu à titre non-exclusif pour une durée de 2 mois.",
    "Absence d'exclusivité.",
    "Le Talent reste libre de toute exclusivité.",
    "Il n'y a pas de clause de non-concurrence entre les parties.",
    "This agreement is non-exclusive and the Creator remains free to work with other brands, including competitors.",
    "No exclusivity is granted to the Brand.",
    "Les tribunaux de Lyon auront une compétence exclusive pour tout litige.",
    "La Marque bénéficie à titre exclusif d'une licence d'exploitation des contenus pendant 6 mois.",
    "Le Talent s'interdit tout propos dénigrant envers la Marque.",
  ];
  it.each(contraires)("« %s »", (phrase) => {
    expect(clauseExclusivite(phrase)).toBeNull();
  });
  it("la négation est repérée telle quelle", () => {
    expect(nieExclusivite("une licence non exclusive")).toBe(true);
    expect(nieExclusivite("sans aucune exclusivité sur le secteur")).toBe(true);
    expect(nieExclusivite("Le Talent s'interdit toute collaboration avec une marque concurrente.")).toBe(false);
  });
  it("phrase douteuse à confirmer (page Exclusivités) : elle dit le contraire ou ne parle de rien", () => {
    expect(phraseDouteuse("Licence d'exploitation non exclusive (sans aucune exclusivité sur le secteur du parfum).")).toBe(true);
    expect(phraseDouteuse("La collaboration est réalisée exclusivement sous la forme d'un produit offert.")).toBe(true);
    expect(phraseDouteuse("Le Talent s'interdit toute collaboration avec une marque concurrente.")).toBe(false);
    // Phrase d'un article « Exclusivité » : une interdiction, sans le mot.
    expect(phraseDouteuse("Pendant le contrat, le Créateur ne fera la promotion d'aucune marque de soins capillaires.")).toBe(false);
  });
  it("un contrat de licence non exclusive ne donne aucune proposition", () => {
    const text = `CONTRAT DE COLLABORATION entre la société Atelier Brume et Iris Essai, créatrice de contenu. Fait à Lyon le 4 novembre 2026.
      Article 2 – Livrables. La Créatrice réalisera 1 reel Instagram.
      Article 3 – Licence d'exploitation. La Créatrice accorde à la Marque une licence d'exploitation non exclusive (sans aucune exclusivité sur le secteur du parfum pour la Créatrice) sur ce contenu pour une durée stricte de 3 mois à compter de la première diffusion.
      Article 4 – Rémunération. La collaboration est rémunérée exclusivement en produits offerts.`;
    const r = readContract(text, { creators: ["Iris Essai"], brands: ["Atelier Brume"] }, today);
    expect(r.exclusivity).toBeNull();
    expect(proposalFromMail(r, { creatorHint: null, brandHint: null, fileName: "Contrat_Iris.pdf", docPath: null, mail: { threadId: "t", box: "talent" }, today })).toBeNull();
  });
});

describe("lecture des contrats : une vraie clause, même sans le mot", () => {
  it.each([
    ["Exclusivité : aucune marque concurrente pendant 3 mois.", "forte"],
    ["Le Talent ne pourra pas, pendant la durée de l'exclusivité, collaborer avec une marque concurrente.", "forte"],
    ["Clause de non-concurrence : pendant 60 jours, le Créateur ne travaillera avec aucun concurrent.", "forte"],
    ["Le Créateur s'engage à ne promouvoir aucune autre marque de soins capillaires pendant la durée du contrat.", "faible"],
    ["During the term, the Creator shall not promote any competing brand.", "faible"],
    ["Le Talent reste libre de ses choix éditoriaux mais s'interdit toute collaboration avec une marque concurrente.", "faible"],
    ["Aucun concurrent minceur, digestion ou sommeil pendant le contrat.", "faible"],
    ["Sans préjudice de l'exclusivité consentie à la Marque, le Talent choisit ses formats.", "forte"],
    ["Le Talent ne pourra pas rompre l'exclusivité avant son terme.", "forte"],
  ])("« %s » : %s", (phrase, k) => {
    expect(clauseExclusivite(phrase)).toBe(k);
  });
  it("dans un article « Exclusivité », la phrase qui interdit en fait partie", () => {
    const text = "Article 5 – Exclusivité. Pendant toute la durée du contrat et 30 jours après, le Créateur ne fera la promotion d'aucune marque de soins capillaires. Article 6 – Paiement. La Marque paie à 30 jours.";
    const r = readContract(text, { creators: [], brands: [] }, today);
    expect(r.exclusivity?.quote).toMatch(/^Pendant toute la durée du contrat/);
    expect(r.exclusivity?.scope).toBe("soins capillaires");
  });
  it("un article « Exclusivité » qui dit « aucune exclusivité » n'en donne pas, sauf vraie clause dedans", () => {
    const nie = "Article 7 – Exclusivité. Le présent contrat n'emporte aucune exclusivité. La durée du contrat est de 3 mois. Article 8 – Paiement. À 30 jours.";
    expect(readContract(nie, { creators: [], brands: [] }, today).exclusivity).toBeNull();
    const sauf = "Article 7 – Exclusivité. Aucune exclusivité générale. Toutefois, le Talent s'interdit toute collaboration avec une marque concurrente du secteur du parfum pendant 30 jours.";
    const r = readContract(sauf, { creators: [], brands: [] }, today);
    expect(r.exclusivity).toMatchObject({ scope: "parfum", start: today, end: "2026-11-28" });
    expect(r.exclusivity?.quote).toMatch(/^Toutefois/);
  });
});

describe("catégorie interdite : lue dans le nom de la marque, jamais dans une catégorie de fiche contact", () => {
  it("le mot qui dit chaque secteur", () => {
    expect(termesSecteur("nutrition sportive et compléments alimentaires")).toEqual(["nutrition", "complement"]);
    expect(termesSecteur("produits de beauté")).toEqual(["beaute"]);
    expect(termesSecteur("même catégorie de produits")).toEqual([]);
    expect(termesSecteur("")).toEqual([]);
  });
  it("le nom de la marque dit la catégorie", () => {
    expect(secteurDansNom("parfum", "Maison Lumen Parfums")).toBe("parfum");
    expect(secteurDansNom("parfum", "Lumenparfum")).toBe("parfum");
    expect(secteurDansNom("nutrition sportive", "Sport Fictif 2000")).toBeNull();
    expect(secteurDansNom("même catégorie de produits", "Nova Produits")).toBeNull();
  });
  it("une exclusivité confirmée sans concurrents bloque la marque dont le nom dit la catégorie", () => {
    const parfum = ex({ creator: "Zoé Test", brand: "Atelier Brume", scope: "parfum", competitors: [] });
    expect(hitsBrand(parfum, "Maison Lumen Parfums")).toBe(true);
    expect(hitsBrand(parfum, "Atelier Brume Parfums")).toBe(false); // la marque de l'exclusivité elle-même
    expect(conflictsFor([parfum], "Zoé Test", "Maison Lumen Parfums", today)).toHaveLength(1);
  });
  it("« Marque », « Agence » (catégorie de fiche contact) ne sont jamais un secteur", () => {
    const large = ex({ scope: "toute marque concurrente", competitors: [] });
    expect(hitsBrand(large, "Kora", ["Marque"])).toBe(false);
    expect(hitsBrand(large, "Kora", ["Agence"])).toBe(false);
    expect(hitsBrand(ex({ scope: "vêtements de sport" }), "Kora", ["Sport"])).toBe(true); // un vrai secteur
  });
});

describe("alertes : bloque, à vérifier, jamais passé sous silence", () => {
  const nike = ex({ id: "c1", creator: "Zoé Test", brand: "Nova", competitors: ["Kora"], scope: "nutrition sportive" });
  const sansConc = ex({ id: "c2", creator: "Noa Exemple", brand: "Atelier Brume", scope: "parfum", competitors: [] });
  const aConfirmer = ex({ id: "p1", creator: "Iris Essai", brand: "Velours", scope: "", competitors: [], pending: true, source: "mail", quote: "Licence non exclusive de 3 mois." });
  const sansCreateur = ex({ id: "p2", creator: "", brand: "Velours", scope: "parfum", competitors: [], pending: true, source: "mail" });
  const autreListe = ex({ id: "p3", creator: "Iris Essai", brand: "Solvi", competitors: ["Orbe"], pending: true, source: "mail" });
  const list = [nike, sansConc, aConfirmer, sansCreateur, autreListe];
  const niveaux = (xs: ReturnType<typeof alertesExclu>) => xs.map((a) => `${a.e.id}:${a.niveau}:${a.pourquoi}`);

  it("pour un créateur : concurrent cité bloque, la catégorie seule se vérifie", () => {
    expect(niveaux(alertesExclu(list, "Kora", today, { creator: "ZOÉ TEST" }))).toEqual(["c1:bloque:concurrent", "p2:a_verifier:a_confirmer"]);
    expect(niveaux(alertesExclu(list, "Sablé Bio", today, { creator: "Zoe Test" }))).toEqual(["p2:a_verifier:a_confirmer"]);
    expect(niveaux(alertesExclu(list, "Sablé Bio", today, { creator: "Zoé Test", categories: true }))).toEqual(["c1:a_verifier:categorie", "p2:a_verifier:a_confirmer"]);
  });
  it("exclusivité confirmée sans concurrents : bloque si le nom dit la catégorie, sinon à vérifier", () => {
    expect(niveaux(alertesExclu([sansConc], "Maison Lumen Parfums", today))).toEqual(["c2:bloque:nom"]);
    expect(niveaux(alertesExclu([sansConc], "Kora", today))).toEqual(["c2:a_verifier:sans_concurrents"]);
    expect(texteAlerte(alertesExclu([sansConc], "Kora", today)[0], "Kora")).toBe(
      "exclusivité Atelier Brume jusqu'au 2026-12-12 dans la catégorie « parfum », sans liste de concurrents : vérifier que Kora n'en fait pas partie",
    );
  });
  it("ligne « à confirmer » : à vérifier, jamais bloquante ; pas pour une marque hors de sa liste", () => {
    const a = alertesExclu(list, "Kora", today, { creator: "Iris Essai" });
    expect(niveaux(a)).toEqual(["p1:a_verifier:a_confirmer", "p2:a_verifier:a_confirmer"]);
    expect(texteAlerte(a[0], "Kora")).toMatch(/jamais confirmée : peut-être une erreur de lecture\. Phrase lue : « Licence non exclusive de 3 mois\. »$/);
    expect(alertesExclu([autreListe], "Kora", today)).toEqual([]);
    expect(niveaux(alertesExclu([autreListe], "Orbe", today))).toEqual(["p3:a_verifier:a_confirmer"]);
  });
  it("une ligne écrite au prénom seul compte pour le créateur", () => {
    expect(memeCreateur("Zoé", "ZOE TEST")).toBe(true);
    expect(memeCreateur("zoe test", "Zoé Test")).toBe(true);
    expect(memeCreateur("Zoé Autre", "Zoe Test")).toBe(false);
    expect(memeCreateur("", "Zoe Test")).toBe(false);
    expect(niveaux(alertesExclu([{ ...nike, creator: "Zoé" }], "Kora", today, { creator: "ZOÉ TEST" }))).toEqual(["c1:bloque:concurrent"]);
  });
  it("jamais pour la marque elle-même ni une exclusivité finie", () => {
    expect(alertesExclu(list, "Nova", today, { creator: "Zoé Test" }).map((a) => a.e.id)).toEqual(["p2"]);
    expect(alertesExclu([{ ...sansConc, end: "2026-10-01" }], "Kora", today)).toEqual([]);
    expect(alertesExclu(list, "  ", today)).toEqual([]);
  });
  it("listes de créateurs : les bloqués d'un côté, les « à vérifier » de l'autre", () => {
    const m = aVerifierCreators(list, "Kora", today);
    expect([...m]).toEqual([["noa exemple", "À vérifier : exclu Atelier Brume"], ["iris essai", "À vérifier : exclu Velours non confirmée"]]);
    expect(m.has("zoé test")).toBe(false); // déjà bloquée par blockedCreators
    expect(estAVerifier(m.get("iris essai"))).toBe(true);
    expect(estAVerifier(blockedCreators(list, "Kora", today).get("zoé test"))).toBe(false);
    expect(A_VERIFIER).toBe("À vérifier");
  });
});

describe("créateur demandé : prénom seul, autre casse, sans accents", () => {
  const noms = ["Nora Fictive", "INÈS TESTEUSE", "Delia", "Lia Exemple", "Hugo Essai", "Iris Essai", "Noé Un", "Noe Deux"];
  it.each([
    ["Nora", "Nora Fictive"],
    ["ines", "INÈS TESTEUSE"],
    ["Inès testeuse", "INÈS TESTEUSE"],
    ["Lia", "Lia Exemple"],
    ["delia", "Delia"],
    ["testeuse", "INÈS TESTEUSE"],
    ["Inès Testeuse (Lyon)", "INÈS TESTEUSE"],
  ])("« %s » → %s", (saisie, nom) => {
    expect(trouverCreateur(noms, saisie)).toEqual({ nom });
  });
  it("plusieurs fiches : il faut le nom complet ; aucune : rien n'est deviné", () => {
    expect(trouverCreateur(noms, "Noé")).toEqual({ plusieurs: ["Noé Un", "Noe Deux"] });
    expect(trouverCreateur(noms, "Essai")).toEqual({ plusieurs: ["Hugo Essai", "Iris Essai"] });
    expect(trouverCreateur(noms, "Zelda")).toEqual({ aucun: true });
    expect(trouverCreateur(noms, " ")).toEqual({ aucun: true });
    expect(trouverCreateur(["Nora Fictive", "NORA FICTIVE"], "nora")).toEqual({ nom: "Nora Fictive" });
  });
});

describe("contrats reçus par mail : modèles vierges et même fil", () => {
  it("un modèle vierge n'est pas lu", () => {
    expect(looksLikeContract("Contrat_Createur_Couple_Template.pdf", "")).toBe(false);
    expect(looksLikeContract("CONTRAT DE COLLABORATION PDF Vierge.pdf", "Contrat")).toBe(false);
    expect(looksLikeContract("Contrat_Iris_ESSAI.pdf", "")).toBe(true);
  });
  it("un nouveau message du même fil met à jour la ligne au lieu d'en ajouter une", () => {
    const avant = ex({ id: "p1", creator: "", brand: "Velours Parfums", scope: "parfum", pending: true, source: "mail", mail: { threadId: "fil1", box: "talent" }, createdAt: 5 });
    const p = { ...avant, creator: "Iris Essai", brand: "Veloursparfum", scope: "", end: null, mail: { threadId: "fil1", box: "talent" } };
    expect(memeAffaire(avant, p)).toBe(true);
    expect(memeAffaire(avant, { ...p, mail: { threadId: "fil2", box: "talent" } })).toBe(false);
    expect(memeAffaire(avant, { ...p, brand: "Kora" })).toBe(false);
    expect(memeAffaire({ ...avant, pending: false }, p)).toBe(false); // déjà confirmée : on n'y touche pas
    const { id: _id, createdAt: _c, ...proposition } = p;
    const apres = fusionnerProposition(avant, proposition);
    expect(apres).toMatchObject({ id: "p1", createdAt: 5, creator: "Iris Essai", brand: "Veloursparfum", scope: "parfum", end: "2026-12-12" });
  });
});

import { ligneDeProposition, pourquoiBloque, raisonBloque, raisonPour } from "./exclusivites.ts";

// Relecture du 27/11 : phrases et noms fictifs, sur le modèle des cas trouvés.
describe("lecture des contrats : une négation ne compte que collée au mot", () => {
  // L'ancien lecteur les laissait passer : un faux « libre », sans ligne, sans tâche, sans « à vérifier ».
  const vraies = [
    "Le Créateur s'engage à collaborer exclusivement avec la Marque pour la catégorie parfum pendant 3 mois.",
    "Le Créateur ne pourra pas, pendant l'exclusivité, travailler avec les marques suivantes : Orbe, Kolibri et Velours.",
    "En contrepartie de la cession des droits d'exploitation, le Créateur accorde une exclusivité de 3 mois.",
    "Le Créateur ne peut en aucun cas rompre l'exclusivité.",
    "The Influencer shall not, during the exclusivity period, promote competing brands.",
    "Le Créateur ne pourra pas, pendant l'exclusivité, collaborer avec une marque concurrente.",
    "Le Créateur ne pourra pas, pendant l'exclusivité, promouvoir une marque de soins capillaires.",
    "En contrepartie de la cession, le Créateur accepte une exclusivité de 3 mois.",
    "Exclusivité : aucune collaboration possible avec des sociétés concurrentes.",
    // Une exclusivité tournée vers les autres : une interdiction, pas une négation.
    "Le Créateur ne prendra aucun engagement d'exclusivité avec une autre marque.",
    "The Creator shall not, during the Term, enter into any exclusivity with a competitor.",
  ];
  it.each(vraies)("« %s » : une clause, jamais niée", (phrase) => {
    expect(clauseExclusivite(phrase)).toBe("forte");
    expect(nieExclusivite(phrase)).toBe(false);
    expect(phraseDouteuse(phrase)).toBe(false);
  });
  it("« exclusivement » au sens de « seulement » ne compte pas ; « exclusivement avec la Marque » est une clause", () => {
    expect(clauseExclusivite("La collaboration est payée exclusivement en produits offerts.")).toBeNull();
    expect(nieExclusivite("La collaboration est payée exclusivement en produits offerts.")).toBe(false);
    expect(clauseExclusivite("Le Talent travaillera exclusivement avec Nova pendant la campagne.", "Nova")).toBe("forte");
    expect(phraseDouteuse("Le Talent travaillera exclusivement avec Nova pendant la campagne.", "Nova")).toBe(false);
    expect(clauseExclusivite("Le Talent ne travaille pas exclusivement avec la Marque.")).toBeNull();
  });
  it.each([
    "La Marque dispose d'une licence gratuite, mondiale et exclusive sur les contenus.",
    "La Marque dispose d'un droit exclusif d'exploitation des contenus.",
    "Exclusivité : Non applicable.",
    "Exclusivité : non prévue.",
    "This license will not be exclusive.",
    "La licence n'est pas consentie à titre exclusif.",
    "Le Créateur n'est pas tenu à une exclusivité.",
    "This Agreement does not grant any exclusivity.",
  ])("« %s » : pas une exclusivité du créateur", (phrase) => {
    expect(clauseExclusivite(phrase)).toBeNull();
  });
  it("contrats fictifs : chaque vraie clause donne une ligne « à confirmer »", () => {
    const tete = "CONTRAT DE COLLABORATION entre la société Atelier Brume et Iris Essai, créatrice de contenu. Fait à Lyon le 4 novembre 2026. Article 2 – Livrables. La Créatrice réalisera 1 reel Instagram. ";
    const lire = (clause: string) => {
      const r = readContract(tete + clause, { creators: ["Iris Essai"], brands: ["Atelier Brume"] }, today);
      return proposalFromMail(r, { creatorHint: null, brandHint: null, fileName: "Contrat_Iris.pdf", docPath: null, mail: { threadId: "t", box: "talent" }, today });
    };
    expect(lire("Article 5 – Engagements. Le Créateur s'engage à collaborer exclusivement avec la Marque pour la catégorie parfum pendant 3 mois.")).toMatchObject({ creator: "Iris Essai", brand: "Atelier Brume", scope: "parfum", start: "2026-11-04", end: "2027-02-04", pending: true });
    expect(lire("Article 5 – Engagements. Le Créateur ne pourra pas, pendant l'exclusivité, travailler avec les marques suivantes : Orbe, Kolibri et Velours.")?.competitors).toEqual(["Orbe", "Kolibri", "Velours"]);
    expect(lire("Article 5 – Contreparties. En contrepartie de la cession des droits d'exploitation, le Créateur accorde une exclusivité de 3 mois.")).toMatchObject({ end: "2027-02-04" });
    expect(lire("Article 5 – Engagements. Le Créateur ne peut en aucun cas rompre l'exclusivité pendant 60 jours.")).toMatchObject({ end: "2027-01-03" });
    expect(lire("Article 5 – Obligations. The Influencer shall not, during the exclusivity period, promote competing brands for 3 months.")).toMatchObject({ end: "2027-02-04" });
    expect(lire("Article 5 – Exclusivité : aucune collaboration possible avec des sociétés concurrentes pendant 2 mois.")).toMatchObject({ end: "2027-01-04" });
  });
  it("un article suivant sans titre court change d'article : il ne nie pas l'exclusivité et n'ajoute pas de concurrents", () => {
    const exclu = "Article 5 – Exclusivité. Pendant toute la durée du contrat et 30 jours après, le Créateur ne fera la promotion d'aucune marque de soins capillaires.";
    const licence = readContract(`${exclu} Article 6 – Licence : la Créatrice accorde à la Marque une licence d'exploitation non exclusive sur ce contenu pour une durée de 3 mois à compter de la première diffusion.`, { creators: [], brands: [] }, today);
    expect(licence.exclusivity).toMatchObject({ scope: "soins capillaires", end: "2026-11-28" });
    const droits = readContract(`${exclu} Article 6 – Droits d'utilisation : la Marque peut utiliser le contenu 12 mois sur ses réseaux, notamment Instagram, TikTok et YouTube.`, { creators: [], brands: [] }, today);
    expect(droits.exclusivity).toMatchObject({ competitors: [], end: "2026-11-28" });
  });
  it("concurrents : « comme » ne se lit pas dans « commerciale »", () => {
    const r = readContract("Article 4 – Exclusivité. Le Talent s'interdit toute collaboration commerciale avec une marque concurrente, notamment Orbe et Kolibri, pendant 30 jours.", { creators: [], brands: [] }, today);
    expect(r.exclusivity?.competitors).toEqual(["Orbe", "Kolibri"]);
  });
});

describe("catégorie dans le nom de la marque : mot entier pour un terme court", () => {
  // Noms fictifs construits comme les faux blocages trouvés (un terme court lu au début d'un autre mot).
  it.each([
    ["mode", "Modernité Cuisine"],
    ["mode", "Modetrotteur Fictif"],
    ["tech", "Technogrid"],
    ["luxe", "Luxor Voyages"],
    ["auto", "Autodesign Test"],
    ["café", "Cafeine Fictive"],
    ["bien-être", "Bien Manger Fictif"],
    ["bien-être", "Bienvenue Fictif"],
    ["high-tech", "Highlands Fictif"],
    ["concurrents directs", "Direct Fictif"],
  ])("« %s » ne se lit pas dans « %s »", (scope, brand) => {
    expect(secteurDansNom(scope, brand)).toBeNull();
  });
  it("le mot entier (pluriel compris), un terme à trait d'union, un terme long au début d'un mot", () => {
    expect(secteurDansNom("mode", "Mode Atelier")).toBe("mode");
    expect(secteurDansNom("café", "Cafés Lumen")).toBe("cafe");
    expect(secteurDansNom("bijoux", "Bijou Fictif")).toBe("bijou");
    expect(secteurDansNom("bien-être", "Maison Bien-Être")).toBe("bien etre");
    expect(secteurDansNom("bien être", "Bienetre Shop")).toBe("bien etre");
    expect(secteurDansNom("high-tech", "HighTech Lumen")).toBe("high tech");
    expect(secteurDansNom("parfum", "Parfumerie Lumen")).toBe("parfum");
    // Conformité : le mot entier seulement.
    expect(secteurDansNom("parfum", "Parfumerie Lumen", { motEntier: true })).toBeNull();
    expect(secteurDansNom("parfum", "Maison Lumen Parfums", { motEntier: true })).toBe("parfum");
  });
  it("catégorie coupée aux virgules, « ; » et « / » ; mots qui qualifient sans dire un secteur", () => {
    expect(termesSecteur("minceur, digestion, probiotiques, stress ou sommeil")).toEqual(["minceur", "digestion", "probiotique", "stress", "sommeil"]);
    expect(termesSecteur("cosmétiques / maquillage ; soins")).toEqual(["cosmetique", "maquillage", "soin"]);
    expect(termesSecteur("concurrents directs")).toEqual([]);
    expect(termesSecteur("haut de gamme")).toEqual([]);
    expect(termesSecteur("bien-être")).toEqual(["bien etre"]);
    expect(secteurDansNom("minceur, digestion, probiotiques, stress ou sommeil", "Probiotiques Lumen")).toBe("probiotique");
  });
  it("exclusivité confirmée sans concurrents : un nom qui commence seulement par le terme reste « à vérifier »", () => {
    const mode = ex({ creator: "Zoé Test", brand: "Atelier Brume", scope: "mode", competitors: [] });
    expect(alertesExclu([mode], "Modernité Cuisine", today).map((a) => `${a.niveau}:${a.pourquoi}`)).toEqual(["a_verifier:sans_concurrents"]);
    expect(alertesExclu([mode], "Mode Atelier", today).map((a) => `${a.niveau}:${a.pourquoi}`)).toEqual(["bloque:nom"]);
  });
});

describe("ligne « à confirmer » avec une liste de concurrents : jamais « aucune exclusivité »", () => {
  // Liste lue après « notamment » : jamais complète. « Velours » est de la même catégorie sans y être.
  const lue = ex({ id: "p4", creator: "Lina Morelle", brand: "Solvi", scope: "nutrition sportive", competitors: ["Orbe", "Kolibri"], pending: true, source: "mail" });
  it("contrôle fait exprès (verifier_exclusivite, `categories`) : à vérifier, avec sa catégorie dans le texte", () => {
    const a = alertesExclu([lue], "Velours", today, { creator: "Lina Morelle", categories: true });
    expect(a.map((x) => `${x.e.id}:${x.niveau}:${x.pourquoi}`)).toEqual(["p4:a_verifier:a_confirmer"]);
    expect(texteAlerte(a[0], "Velours")).toContain("(catégorie « nutrition sportive »)");
  });
  it("listes de choix (sans `categories`) : seulement pour une marque citée", () => {
    expect(alertesExclu([lue], "Velours", today, { creator: "Lina Morelle" })).toEqual([]);
    expect(alertesExclu([lue], "Orbe", today, { creator: "Lina Morelle" }).map((x) => x.pourquoi)).toEqual(["a_confirmer"]);
  });
});

describe("contrats reçus par mail : quelle ligne mettre à jour", () => {
  const avant = ex({ id: "p1", creator: "Lina Morelle", brand: "Kora", scope: "parfum", pending: true, source: "mail", mail: { threadId: "fil1", box: "talent" }, quote: "Clause de Lina.", docPath: "contrats/lina.pdf", createdAt: 5 });
  const { id: _i, createdAt: _c, ...prop } = avant;
  const autre = { ...prop, creator: "", quote: "Clause d'un autre contrat.", docPath: "contrats/autre.pdf", end: "2027-03-01" };
  it("un contrat sans créateur lu ne prend jamais la ligne d'un créateur (il peut être celui d'un autre)", () => {
    expect(memeAffaire(avant, autre)).toBe(false);
    expect(memeAffaire({ ...avant, creator: "" }, prop)).toBe(true); // la ligne sans créateur reçoit le sien
    expect(memeAffaire(avant, { ...prop, creator: "Lina" })).toBe(true);
    expect(memeAffaire(avant, { ...prop, creator: "Iris Essai" })).toBe(false);
  });
  it("registre relu : mise à jour sans nouvelle tâche ; nouvelle ligne si la ligne a été confirmée entre-temps, pour un 2e PDF du même message, ou si la lecture a raté", () => {
    const id = () => "neuve";
    expect(ligneDeProposition([avant], { ...prop, quote: "Version signée." }, { id, now: 9 })).toMatchObject({ nouvelle: false, row: { id: "p1", createdAt: 5, quote: "Version signée.", creator: "Lina Morelle" } });
    expect(ligneDeProposition([{ ...avant, pending: false }], prop, { id, now: 9 })).toMatchObject({ nouvelle: true, row: { id: "neuve", createdAt: 9 } });
    expect(ligneDeProposition([avant], prop, { id, now: 9, exclus: new Set(["p1"]) })).toMatchObject({ nouvelle: true, row: { id: "neuve" } });
    expect(ligneDeProposition(null, prop, { id, now: 9 })).toMatchObject({ nouvelle: true, row: { id: "neuve" } });
    expect(ligneDeProposition([avant], autre, { id, now: 9 })).toMatchObject({ nouvelle: true, row: { id: "neuve", quote: "Clause d'un autre contrat." } });
  });
});

describe("créateur écrit au prénom seul ; raison d'un blocage en clair", () => {
  const ligne = ex({ id: "c9", creator: "Zoé", brand: "Atelier Brume", scope: "mode", competitors: ["Kora"] });
  it("conflictsFor et les listes de choix retrouvent la fiche « Zoé Test »", () => {
    expect(conflictsFor([ligne], "ZOÉ TEST", "Kora", today)).toHaveLength(1);
    const m = blockedCreators([ligne], "Kora", today);
    expect(raisonPour(m, "Zoé Test")).toBe("Exclu Atelier Brume · 2026-12-12");
    expect(raisonPour(m, "Iris Essai")).toBeUndefined();
    // Déjà bloquée par la ligne au prénom seul : pas aussi « à vérifier » sous son nom complet.
    const lue = ex({ id: "p9", creator: "Zoé Test", brand: "Velours", competitors: [], pending: true, source: "mail" });
    expect(aVerifierCreators([ligne, lue], "Kora", today).has("zoé test")).toBe(false);
  });
  it("la raison : marque citée parmi les concurrents, ou catégorie lue dans le nom", () => {
    expect(raisonBloque(ligne, "Kora", "concurrent")).toBe("Kora est cité parmi ses concurrents");
    expect(pourquoiBloque(ligne, "Mode Lumen")).toBe("nom");
    expect(raisonBloque(ligne, "Mode Lumen", "nom")).toBe("« mode » se lit dans le nom de Mode Lumen");
  });
});
