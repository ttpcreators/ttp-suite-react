import { describe, expect, it } from "vitest";
import {
  TITRE_MAX, collabEnCours, collabOuverte, controler, court, createursSousContrat, dateIso, lectureCachet, ligneProbleme, lireIgnores, sansIgnores, urlDe, versementDepuis,
  type ControleInput, type CtrlCollab, type CtrlCreator,
} from "./controle.ts";

const TODAY = "2026-11-23";
const complet: CtrlCreator = { name: "LEA TEST", status: "actif", email: "lea@exemple.test", phone: "0600000000", photo_url: "https://x.test/p.jpg", platform: "Instagram" };
const collab = (o: Partial<CtrlCollab>): CtrlCollab => ({ id: "c1", brand: "Marque Alpha", creator: "Lea Test", step: 3, status: "active", brief_id: null, cachet: "800 €", ...o });
const base = (o: Partial<ControleInput> = {}): ControleInput => ({
  aujourdhui: TODAY,
  collabs: [],
  collabSteps: [],
  invoices: [],
  creators: [complet],
  briefs: [],
  prospects: [],
  todos: [],
  contacts: [],
  payouts: {},
  cashModes: {},
  contractHistory: [{ creator: "LEA TEST", config: {} }],
  details: {},
  taux: { roster: { "LEA TEST": 20 }, memorises: {} },
  ...o,
});
const regles = (o: Partial<ControleInput>) => controler(base(o)).map((p) => p.regle);

describe("controler : rien à signaler", () => {
  it("des données propres ne donnent aucun problème", () => {
    expect(controler(base({ collabs: [collab({})] }))).toEqual([]);
  });
});

describe("créateur hors roster", () => {
  it("une ligne par nom absent, même avec plusieurs collabs", () => {
    const out = controler(base({ collabs: [collab({ id: "a", creator: "Zoe Fictive" }), collab({ id: "b", creator: "ZOÉ FICTIVE" })] }));
    expect(out).toHaveLength(1);
    expect(out[0].regle).toBe("createur_hors_roster");
    expect(out[0].detail).toContain("2 collabs");
    expect(out[0].decision).toBe(true);
  });
  it("roster illisible : règle sautée (jamais « tout est cassé »)", () => {
    expect(regles({ creators: null, collabs: [collab({ creator: "Zoe Fictive" })] })).toEqual([]);
  });
  it("collab archivée ou sans créateur : rien", () => {
    expect(regles({ collabs: [collab({ creator: "Zoe Fictive", status: "archivee" }), collab({ id: "x", creator: null })] })).toEqual([]);
  });
});

describe("brief supprimé", () => {
  it("lien cassé : correction sûre qui retire le lien", () => {
    const out = controler(base({ collabs: [collab({ brief_id: "b-old" })], briefs: [{ id: "b-ok" }] }));
    expect(out[0].regle).toBe("brief_casse");
    expect(out[0].correction).toMatchObject({ type: "brief_delier", collabId: "c1", briefId: "b-old" });
    expect(out[0].decision).toBe(false);
  });
  it("brief présent, ou briefs illisibles : rien", () => {
    expect(regles({ collabs: [collab({ brief_id: "b-ok" })], briefs: [{ id: "b-ok" }] })).toEqual([]);
    expect(regles({ collabs: [collab({ brief_id: "b-old" })], briefs: null })).toEqual([]);
  });
});

describe("facture en brouillon échue", () => {
  it("échéance passée (ISO ou jj/mm/aaaa) : signalée", () => {
    const out = controler(base({ invoices: [{ id: "i1", ref: "2026-101", status: "brouillon", date: "2026-11-20" }, { id: "i2", ref: "2026-102", status: "brouillon", date: "01/11/2026" }] }));
    expect(out.map((p) => p.id)).toEqual(["brouillon_echu:i1", "brouillon_echu:i2"]);
    expect(out[0].gravite).toBe("haute");
    expect(out[0].lien).toEqual({ vue: "facturation", recherche: "2026-101" });
  });
  it("échéance future, aujourd'hui, ou facture émise : rien", () => {
    expect(regles({ invoices: [{ id: "i1", status: "brouillon", date: "2026-11-23" }, { id: "i2", status: "brouillon", date: "2026-12-01" }, { id: "i3", status: "attente", date: "2026-11-01" }] })).toEqual([]);
  });
  it("membre (factures non lues) : rien", () => {
    expect(regles({ invoices: null })).toEqual([]);
  });
});

describe("étapes en retard sur l'argent", () => {
  // 750 € HT, commission 20 % (fiche roster) : 600 € dus au créateur.
  const payee = { id: "i1", ref: "2026-90", status: "payee", amount: "750 €", collab_id: "c1", paid_at: "2026-11-10T10:00:00Z", creator: "LEA TEST" };
  it("facture payée, collab publiée mais avant l'étape 9", () => {
    const out = controler(base({ collabs: [collab({ step: 6 })], invoices: [payee] }));
    expect(out.map((p) => p.regle)).toEqual(["etape_paiement"]);
    expect(out[0].detail).toContain("étape 9");
  });
  it("payée avant la publication (acompte) : ligne à part, gravité basse, pas de décision", () => {
    const out = controler(base({ collabs: [collab({ step: 4 })], invoices: [payee] }));
    expect(out.map((p) => p.regle)).toEqual(["paiement_avant_publication"]);
    expect(out[0].gravite).toBe("basse");
    expect(out[0].decision).toBe(false);
  });
  it("part du créateur entièrement versée, collab à l'étape 9 : étape 10 attendue (une seule ligne)", () => {
    const out = controler(base({ collabs: [collab({ step: 9 })], invoices: [payee], payouts: { "LEA TEST": [{ date: "2026-11-15", amount: 600 }] } }));
    expect(out.map((p) => p.regle)).toEqual(["etape_reversement"]);
    expect(out[0].detail).toContain("entièrement versée");
  });
  it("versement noté mais collab avant l'étape 9 : seulement l'étape 9 réclamée", () => {
    const out = controler(base({ collabs: [collab({ step: 8 })], invoices: [payee], payouts: { "LEA TEST": [{ date: "2026-11-15", amount: 600 }] } }));
    expect(out.map((p) => p.regle)).toEqual(["etape_paiement"]);
  });
  it("le versement solde une facture plus ancienne, pas celle-ci : pas d'étape 10 (constat D4)", () => {
    const ancienne = { id: "i0", ref: "2026-50", status: "payee", amount: "750 €", collab_id: "c0", paid_at: "2026-10-01T10:00:00Z", creator: "LEA TEST" };
    expect(regles({ collabs: [collab({ step: 9 })], invoices: [ancienne, payee], payouts: { "LEA TEST": [{ date: "2026-11-15", amount: 600 }] } })).toEqual([]);
  });
  it("part versée en partie : pas d'étape 10", () => {
    expect(regles({ collabs: [collab({ step: 9 })], invoices: [payee], payouts: { "LEA TEST": [{ date: "2026-11-15", amount: 300 }] } })).toEqual([]);
  });
  it("sans les détails des factures ni les taux (connecteur) : l'étape 10 n'est jamais proposée", () => {
    expect(regles({ collabs: [collab({ step: 9 })], invoices: [payee], payouts: { "LEA TEST": [{ date: "2026-11-15", amount: 600 }] }, details: null })).toEqual([]);
    expect(regles({ collabs: [collab({ step: 9 })], invoices: [payee], payouts: { "LEA TEST": [{ date: "2026-11-15", amount: 600 }] }, taux: undefined })).toEqual([]);
  });
  it("la marque paie le créateur : rien à reverser", () => {
    expect(regles({ collabs: [collab({ step: 9 })], invoices: [payee], payouts: { "LEA TEST": [{ date: "2026-11-15", amount: 600 }] }, cashModes: { c1: "createur" } })).toEqual([]);
  });
  it("déjà à l'étape 10 ou plus : rien", () => {
    expect(regles({ collabs: [collab({ step: 10 })], invoices: [payee], payouts: { "LEA TEST": [{ date: "2026-11-15", amount: 600 }] } })).toEqual([]);
  });
});

describe("collab publiée sans facture", () => {
  const steps = [{ collab_id: "c1", step: 6, reached_at: "2026-11-01T09:00:00Z" }];
  it("plus de 14 jours après la publication, sans facture : signalée", () => {
    const out = controler(base({ collabs: [collab({ step: 7 })], collabSteps: steps }));
    expect(out.map((p) => p.regle)).toEqual(["publiee_sans_facture"]);
    expect(out[0].detail).toContain("22 j");
  });
  it("14 jours tout juste, gifting, ou facture reliée : rien", () => {
    expect(regles({ collabs: [collab({ step: 6 })], collabSteps: [{ collab_id: "c1", step: 6, reached_at: "2026-11-09T09:00:00Z" }] })).toEqual([]);
    expect(regles({ collabs: [collab({ step: 6, cachet: "gifting" })], collabSteps: steps })).toEqual([]);
    expect(regles({ collabs: [collab({ step: 6 })], collabSteps: steps, invoices: [{ id: "i", status: "attente", collab_id: "c1" }] })).toEqual([]);
  });
  it("facture sans collab_id mais même créateur et même marque : comptée", () => {
    expect(regles({ collabs: [collab({ step: 6 })], collabSteps: steps, invoices: [{ id: "i", status: "attente", party: "Marque Alpha x Léa", creator: "LEA TEST" }] })).toEqual([]);
  });
  it("facture annulée : ne compte pas", () => {
    expect(regles({ collabs: [collab({ step: 6 })], collabSteps: steps, invoices: [{ id: "i", status: "annulee", collab_id: "c1" }] })).toEqual(["publiee_sans_facture"]);
  });
});

describe("prospect resté ouvert", () => {
  const datee = (o: Partial<CtrlCollab>) => collab({ created_at: "2026-11-10T10:00:00Z", ...o });
  it("une seule collab en cours, prospect créé avant : correction sûre « Signé »", () => {
    const out = controler(base({ collabs: [datee({ status: "gagnee" })], prospects: [{ id: "p1", brand: "marque alpha", stage: "Négociation", created_at: "2026-11-01T09:00:00Z" }] }));
    expect(out[0].regle).toBe("prospect_ouvert");
    expect(out[0].correction).toMatchObject({ type: "prospect_signe", prospectId: "p1", collabId: "c1" });
    expect(out[0].decision).toBe(false);
  });
  it("dates inconnues : signalé, mais pas de « Corriger »", () => {
    const out = controler(base({ collabs: [collab({})], prospects: [{ id: "p1", brand: "Marque Alpha", stage: "Contact" }] }));
    expect(out[0].correction).toBeNull();
    expect(out[0].decision).toBe(true);
  });
  it("plusieurs collabs possibles : pas de correction, décision de Marc", () => {
    const out = controler(base({ collabs: [datee({}), datee({ id: "c2" })], prospects: [{ id: "p1", brand: "Marque Alpha", stage: "Contact", created_at: "2026-11-01" }] }));
    expect(out[0].correction).toBeNull();
    expect(out[0].decision).toBe(true);
  });
  it("prospect créé après la collab (renouvellement) : rien", () => {
    expect(regles({ collabs: [datee({})], prospects: [{ id: "p1", brand: "Marque Alpha", stage: "Contact", created_at: "2026-11-20T09:00:00Z" }] })).toEqual([]);
  });
  it("collab bouclée (étape 11, terminée, archivée, perdue) : rien", () => {
    for (const c of [datee({ step: 11 }), datee({ status: "terminee" }), datee({ status: "archivee" }), datee({ status: "perdue" })]) {
      expect(regles({ collabs: [c], prospects: [{ id: "p1", brand: "Marque Alpha", stage: "Contact", created_at: "2026-11-01" }] })).toEqual([]);
    }
  });
  it("prospect proposé pour un autre créateur (colonne ou proposition) : rien", () => {
    expect(regles({ collabs: [datee({})], prospects: [{ id: "p1", brand: "Marque Alpha", stage: "Contact", creator: "Autre Nom" }] })).toEqual([]);
    expect(regles({ collabs: [datee({})], prospects: [{ id: "p1", brand: "Marque Alpha", stage: "Contact", proposal: { creator: "Autre Nom" } }] })).toEqual([]);
  });
  it("prospect relié à une collab bouclée : rien", () => {
    expect(regles({ collabs: [datee({ step: 11 })], prospects: [{ id: "p1", brand: "Marque Alpha", stage: "Négociation", collab_id: "c1" }] })).toEqual([]);
  });
  it("prospect signé ou perdu : rien", () => {
    expect(regles({ collabs: [datee({})], prospects: [{ id: "p1", brand: "Marque Alpha", stage: "Signé" }, { id: "p2", brand: "Marque Alpha", stage: "Perdue" }] })).toEqual([]);
  });
});

describe("tâche cochée", () => {
  it("done sans statut « Fait » : correction sûre", () => {
    const out = controler(base({ todos: [{ id: "t1", text: "Envoyer le devis", done: true, status: "À faire" }, { id: "t2", text: "Ok", done: true, status: "Fait" }, { id: "t3", text: "Ouverte", done: false, status: "À faire" }] }));
    expect(out.map((p) => p.id)).toEqual(["tache_cochee:t1"]);
    expect(out[0].correction).toMatchObject({ type: "tache_fait", todoId: "t1" });
    expect(out[0].lien).toEqual({ vue: "todo", item: "t1" });
  });
});

describe("cachet", () => {
  it("lecture", () => {
    expect(lectureCachet("1 500 € HT")).toBe("ok");
    expect(lectureCachet("550 $")).toBe("ok");
    expect(lectureCachet("300 € + produits offerts")).toBe("ok");
    expect(lectureCachet("gifting")).toBe("gifting");
    expect(lectureCachet("0 €")).toBe("gifting");
    expect(lectureCachet("")).toBe("vide");
    expect(lectureCachet("—")).toBe("vide");
    expect(lectureCachet("à définir")).toBe("illisible");
    expect(lectureCachet("affiliation")).toBe("ok");
    expect(lectureCachet("10 % des ventes")).toBe("illisible");
    expect(lectureCachet("800 € x 2")).toBe("illisible");
    expect(lectureCachet("2000 AED")).toBe("devise");
    // Formes standard du champ cachet de l'app : jamais illisibles.
    expect(lectureCachet("Affiliation seule")).toBe("ok");
    expect(lectureCachet("550 € + affiliation")).toBe("ok");
    expect(lectureCachet("1 500 $")).toBe("ok");
    expect(lectureCachet("300 £ + affiliation")).toBe("ok");
    expect(lectureCachet("800 CHF")).toBe("ok");
    expect(lectureCachet("Produits offerts")).toBe("gifting");
    expect(lectureCachet("produits offerts (2 x 50 €)")).toBe("gifting");
    expect(lectureCachet("Gifting")).toBe("gifting");
  });
  it("une ligne par collab vivante au cachet illisible", () => {
    const out = controler(base({ collabs: [collab({ cachet: "selon perfs" }), collab({ id: "c2", cachet: "2000 AED" }), collab({ id: "c3", cachet: "selon perfs", status: "archivee" }), collab({ id: "c4", cachet: "Affiliation seule" })] }));
    expect(out.map((p) => p.id)).toEqual(["cachet_illisible:c1", "cachet_illisible:c2"]);
    expect(out[1].titre.startsWith("Devise inconnue")).toBe(true);
  });
});

describe("fiche créateur incomplète", () => {
  it("une seule ligne qui liste ce qui manque", () => {
    const out = controler(base({ creators: [{ name: "NINA FICTIVE", status: "actif", email_pro: "n@exemple.test" }], contractHistory: [] }));
    expect(out).toHaveLength(1);
    expect(out[0].detail).toContain("téléphone, photo, plateforme, contrat de représentation");
    expect(out[0].lien).toEqual({ vue: "roster", createur: "NINA FICTIVE" });
  });
  it("contrats illisibles : le contrat n'est pas réclamé ; créateur inactif : rien", () => {
    expect(controler(base({ creators: [{ ...complet }], contractHistory: null }))).toEqual([]);
    expect(controler(base({ creators: [{ name: "X", status: "inactif" }] }))).toEqual([]);
  });
  it("contrat reconnu par le nom du talent", () => {
    expect([...createursSousContrat([{ config: { talentNom: "Léa Test" } }, null, "x"])]).toEqual(["lea test"]);
  });
});

describe("étiquettes de contacts", () => {
  it("une seule ligne, avec les étiquettes libres comptées", () => {
    const out = controler(base({ contacts: [{ id: "1", tag: "Marque" }, { id: "2", tag: "marque" }, { id: "3", tag: "influence" }, { id: "4", tag: "marque" }, { id: "5", tag: null }, { id: "6", tag: "Perso" }, { id: "7", tag: "Lead site" }] }));
    expect(out).toHaveLength(1);
    expect(out[0].titre).toBe("3 contacts avec une étiquette libre");
    expect(out[0].detail).toContain("« marque » (2)");
  });
});

describe("droits d'utilisation qui expirent", () => {
  // TODAY = 2026-11-23 : les dates sont calculées à partir de ce jour injecté, jamais de la vraie date.
  const jour = (n: number) => new Date(Date.UTC(2026, 10, 23 + n)).toISOString().slice(0, 10);
  const droit = (o: Record<string, unknown>) => ({ id: "d1", marque: "Marque Alpha", createur: "LEA TEST", type: "publicite", debut: "2026-06-01", fin: jour(10), ...o });
  const avec = (...droits: Record<string, unknown>[]) => controler(base({ droits }));

  it("finit dans 30 jours ou moins : proposer une prolongation", () => {
    const [p] = avec(droit({ fin: jour(10) }));
    expect(p).toMatchObject({ id: "droits_expirent:d1", regle: "droits_expirent", gravite: "moyenne", decision: true, correction: null });
    expect(p.detail.startsWith("Droits de Lea Test pour Marque Alpha expirent le 3 déc. : proposer une prolongation.")).toBe(true);
    expect(avec(droit({ fin: jour(0) }))[0]?.regle).toBe("droits_expirent");
    expect(avec(droit({ fin: jour(30) }))[0]?.regle).toBe("droits_expirent");
    expect(avec(droit({ fin: jour(31) }))).toEqual([]);
  });

  it("expirés depuis moins de 90 jours : vérifier si la pub tourne encore", () => {
    const [p] = avec(droit({ fin: jour(-8) }));
    expect(p).toMatchObject({ id: "droits_expires:d1", regle: "droits_expires", gravite: "haute", decision: true });
    expect(p.detail.startsWith("Droits expirés le 15 nov. : vérifier si la pub tourne encore.")).toBe(true);
    expect(avec(droit({ fin: jour(-89) }))[0]?.regle).toBe("droits_expires");
    expect(avec(droit({ fin: jour(-90) }))).toEqual([]);
    // Une autre année s'écrit en entier.
    expect(controler(base({ aujourdhui: "2027-01-10", droits: [droit({ fin: "2026-12-20" })] }))[0].detail).toContain("le 20 déc. 2026");
  });

  it("saute les droits clos, sans date, et un blob absent ou bizarre", () => {
    expect(avec(droit({ fin: jour(-5), clos: true }), droit({ id: "d2", fin: "" }), droit({ id: "d3", fin: "bientôt" }))).toEqual([]);
    expect(controler(base({ droits: null }))).toEqual([]);
    expect(controler(base({ droits: "x" }))).toEqual([]);
    expect(controler(base({ droits: [{ id: 3 }, null] }))).toEqual([]);
  });

  it("lien vers la collab (sinon une recherche de la marque) et pubs Meta pour un droit publicité", () => {
    const [p] = avec(droit({ collab_id: "c9" }));
    expect(p.lien).toEqual({ vue: "collabs", item: "c9" });
    expect(p.externe).toEqual({ texte: "Voir les pubs Meta", url: expect.stringContaining("&q=Marque%20Alpha&") });
    expect(ligneProbleme(p)).toContain("Voir les pubs Meta : https://www.facebook.com/ads/library/");
    const [q] = avec(droit({ type: "organique" }));
    expect(q.lien).toEqual({ vue: "collabs", recherche: "Marque Alpha" });
    expect(q.externe).toBeUndefined();
    expect(ligneProbleme(q)).not.toContain("facebook.com");
  });

  it("les expirés passent avant ceux qui finissent bientôt", () => {
    expect(avec(droit({ id: "a", fin: jour(5) }), droit({ id: "b", fin: jour(-5) })).map((p) => p.id)).toEqual(["droits_expires:b", "droits_expirent:a"]);
  });
});

describe("forme des problèmes", () => {
  const out = controler(base({
    collabs: [collab({ brand: "Une marque au nom vraiment très très long", creator: "Prénom Composé Très Long", cachet: "à voir", brief_id: "zz" })],
    briefs: [],
    invoices: [{ id: "i1", ref: "2026-1", status: "brouillon", date: "2026-01-02" }],
    todos: [{ id: "t", text: "x", done: true, status: null }],
  }));
  it("titres de 45 caractères au plus, ids uniques, tri par gravité", () => {
    expect(out.every((p) => p.titre.length <= TITRE_MAX)).toBe(true);
    expect(new Set(out.map((p) => p.id)).size).toBe(out.length);
    expect(out[0].gravite).toBe("haute");
    expect(out.at(-1)?.gravite).toBe("basse");
  });
  it("pas de tiret long ni demi-tiret dans les textes", () => {
    expect(out.some((p) => /[—–]/.test(p.titre + p.detail))).toBe(false);
  });
  it("lien profond de l'app", () => {
    expect(urlDe({ vue: "collabs", item: "c1" })).toBe("https://app.ttpcreators.pro/?open=view&view=collabs&item=c1");
    expect(out[0].url.startsWith("https://app.ttpcreators.pro/?open=view&view=")).toBe(true);
  });
  it("ligne texte du connecteur", () => {
    expect(ligneProbleme(out[0])).toContain("[controle brouillon_echu:i1]");
  });
});

describe("outils", () => {
  it("court", () => {
    expect(court("abc", 5)).toBe("abc");
    expect(court("abcdefgh", 5)).toBe("abcd…");
  });
  it("dateIso", () => {
    expect(dateIso("3/2", TODAY)).toBe("2026-02-03");
    expect(dateIso("2026-05-01T00:00", TODAY)).toBe("2026-05-01");
    expect(dateIso("bientôt", TODAY)).toBe("");
  });
  it("versementDepuis", () => {
    expect(versementDepuis({ "Lea Test": [{ date: "2026-11-02", amount: 10 }] }, "LÉA TEST", "2026-11-01")).toBe(true);
    expect(versementDepuis({ "Lea Test": [{ date: "2026-11-02", amount: 0 }] }, "LÉA TEST", null)).toBe(false);
  });
  it("ignorés", () => {
    const list = controler(base({ todos: [{ id: "t1", text: "a", done: true, status: "" }, { id: "t2", text: "b", done: true, status: "" }] }));
    expect(sansIgnores(list, lireIgnores({ "tache_cochee:t1": { at: "2026-11-23" } })).map((p) => p.id)).toEqual(["tache_cochee:t2"]);
    expect(lireIgnores(["x"])).toEqual({});
  });
});

describe("commission due quand la marque paie le créateur en direct (constat D6)", () => {
  const annulee = { id: "i9", ref: "2026-99", status: "annulee", amount: "900 €", collab_id: "c1", creator: "LEA TEST" };
  it("seule facture annulée, collab en cours : signalée, décision de Marc", () => {
    const out = controler(base({ collabs: [collab({ step: 5 })], invoices: [annulee] }));
    expect(out.map((p) => p.regle)).toEqual(["facture_annulee_seule"]);
    expect(out[0].detail).toContain("encaissement « créateur »");
    expect(out[0].decision).toBe(true);
  });
  it("plusieurs factures annulées : texte au pluriel", () => {
    const autre = { ...annulee, id: "i12", ref: "2026-102" };
    const out = controler(base({ collabs: [collab({ step: 5 })], invoices: [annulee, autre] }));
    expect(out.map((p) => p.regle)).toEqual(["facture_annulee_seule"]);
    expect(out[0].titre.startsWith("Factures annulées")).toBe(true);
    expect(out[0].detail).toContain("Les factures de la collab (2026-99, 2026-102) sont toutes annulées");
  });
  it("une autre facture vivante, une collab bouclée, déjà en encaissement « créateur », ou modes illisibles : rien", () => {
    const vivante = { id: "i10", ref: "2026-100", status: "attente", amount: "900 €", collab_id: "c1", creator: "LEA TEST" };
    expect(regles({ collabs: [collab({ step: 5 })], invoices: [annulee, vivante] })).toEqual([]);
    expect(regles({ collabs: [collab({ step: 11, status: "gagnee" })], invoices: [annulee] })).toEqual([]);
    expect(regles({ collabs: [collab({ step: 5 })], invoices: [annulee], cashModes: { c1: "createur" } })).toEqual([]);
    // Blob illisible (controleDb envoie null) : on ne sait pas qui encaisse, la règle est sautée.
    expect(regles({ collabs: [collab({ step: 5 })], invoices: [annulee], cashModes: null })).toEqual([]);
  });
  it("encaissement « créateur », marque payée (étape 9), aucune facture de commission : à facturer depuis la collab", () => {
    const out = controler(base({ collabs: [collab({ step: 9 })], cashModes: { c1: "createur" } }));
    expect(out.map((p) => p.regle)).toEqual(["commission_a_facturer"]);
    expect(out[0].lien).toEqual({ vue: "collabs", item: "c1" });
    expect(out[0].detail).toContain("« Créer la facture » dans la collab");
  });
  it("facture de commission déjà faite, avant l'étape 9, ou factures pas lues (membre) : rien", () => {
    const com = { id: "i11", ref: "2026-101", status: "attente", amount: "180 €", collab_id: "c1", creator: "LEA TEST" };
    expect(regles({ collabs: [collab({ step: 9 })], cashModes: { c1: "createur" }, invoices: [com], details: { i11: { kind: "commission" } } })).toEqual([]);
    expect(regles({ collabs: [collab({ step: 7 })], cashModes: { c1: "createur" } })).toEqual([]);
    expect(regles({ collabs: [collab({ step: 9 })], cashModes: { c1: "createur" }, invoices: null })).toEqual([]);
  });
});

describe("dépôt d'un créateur sans suite (constat W5)", () => {
  const depot = { id: "d1", creator: "LEA TEST", type: "facture", name: "Facture", path: "creator-uploads/u1/facture-1.pdf", created_at: "2026-11-18T10:00:00Z", collab_id: null };
  it("plus de 3 jours, repère pas lu : signalé (facture : gravité haute)", () => {
    const out = controler(base({ depots: [depot], depotsNonLus: ["d1"] }));
    expect(out.map((p) => p.regle)).toEqual(["depot_sans_suite"]);
    expect(out[0].gravite).toBe("haute");
    expect(out[0].id).toBe("depot_sans_suite:d1");
    expect(out[0].lien).toEqual({ vue: "documents", recherche: "LEA TEST" });
  });
  it("vu, trop récent, versement noté depuis, ou dépôts pas lus : rien", () => {
    expect(regles({ depots: [depot], depotsNonLus: [] })).toEqual([]);
    expect(regles({ depots: [{ ...depot, created_at: "2026-11-21T10:00:00Z" }], depotsNonLus: ["d1"] })).toEqual([]);
    expect(regles({ depots: [depot], depotsNonLus: ["d1"], payouts: { "LEA TEST": [{ date: "2026-11-19", amount: 100 }] } })).toEqual([]);
    expect(regles({ depots: null, depotsNonLus: ["d1"] })).toEqual([]);
  });
});

describe("media kit incomplet (constat D5)", () => {
  it("créateur actif dont le kit en ligne n'a ni bio ni photos : signalé", () => {
    const out = controler(base({ creators: [{ ...complet, mediakit: { platforms: [{ name: "Instagram" }] } }] }));
    expect(out.map((p) => p.regle)).toEqual(["kit_incomplet"]);
    expect(out[0].detail).toContain("il manque : bio, photos.");
  });
  it("photos rangées comme dans la page Media kit (objet hero, contact…) mais toutes vides : « photos » manque", () => {
    const vide = { bio: "Texte", photos: { hero: null, contact: "", instagram: "  " } };
    const out = controler(base({ creators: [{ ...complet, mediakit: vide }] }));
    expect(out.map((p) => p.regle)).toEqual(["kit_incomplet"]);
    expect(out[0].detail).toContain("il manque : photos.");
    expect(regles({ creators: [{ ...complet, mediakit: { bio: "Texte", photos: {} } }] })).toEqual(["kit_incomplet"]);
  });
  it("kit complet avec ses photos en objet (forme réelle), sans « Lien » : aucune alerte", () => {
    expect(regles({ creators: [{ ...complet, mediakit: { bio: "Texte", photos: { hero: "https://exemple.test/photo.jpg", contact: null } } }] })).toEqual([]);
    // Ancienne forme en tableau : acceptée aussi.
    expect(regles({ creators: [{ ...complet, mediakit: { bio: "Texte", photos: ["https://exemple.test/photo.jpg"] } }] })).toEqual([]);
  });
  it("kit pas lu (connecteur) ou créateur inactif : rien", () => {
    expect(regles({ creators: [complet] })).toEqual([]);
    expect(regles({ creators: [{ ...complet, status: "inactif", mediakit: null }] })).toEqual([]);
  });
});

describe("collab en cours (constat W1, règle partagée avec le connecteur)", () => {
  it("gagnée avant le bilan = encore en cours", () => {
    expect(collabEnCours({ status: "gagnee" })).toBe(true);
    expect(collabOuverte({ status: "gagnee", step: 3 })).toBe(true);
    expect(collabOuverte({ status: "gagnee", step: 11 })).toBe(false);
    expect(collabOuverte({ status: "perdue", step: 3 })).toBe(false);
    expect(collabOuverte({ status: "active", step: null })).toBe(true);
  });
});
