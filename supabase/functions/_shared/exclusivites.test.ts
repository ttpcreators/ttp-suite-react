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
