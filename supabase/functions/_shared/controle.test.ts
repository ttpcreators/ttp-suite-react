import { describe, expect, it } from "vitest";
import {
  TITRE_MAX, controler, court, createursSousContrat, dateIso, lectureCachet, ligneProbleme, lireIgnores, sansIgnores, urlDe, versementDepuis,
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
  const payee = { id: "i1", ref: "2026-90", status: "payee", collab_id: "c1", paid_at: "2026-11-10T10:00:00Z", creator: "LEA TEST" };
  it("facture payée, collab avant l'étape 9", () => {
    const out = controler(base({ collabs: [collab({ step: 8 })], invoices: [payee] }));
    expect(out.map((p) => p.regle)).toEqual(["etape_paiement"]);
    expect(out[0].detail).toContain("étape 9");
  });
  it("versement noté depuis le paiement : étape 10 attendue (une seule ligne)", () => {
    const out = controler(base({ collabs: [collab({ step: 8 })], invoices: [payee], payouts: { "LÉA TEST": [{ date: "2026-11-15", amount: 600 }] } }));
    expect(out.map((p) => p.regle)).toEqual(["etape_reversement"]);
  });
  it("versement plus ancien que le paiement : pas compté", () => {
    expect(regles({ collabs: [collab({ step: 9 })], invoices: [payee], payouts: { "LEA TEST": [{ date: "2026-10-01", amount: 600 }] } })).toEqual([]);
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
  it("une seule collab de la marque : correction sûre « Signé »", () => {
    const out = controler(base({ collabs: [collab({ status: "gagnee" })], prospects: [{ id: "p1", brand: "marque alpha", stage: "Négociation" }] }));
    expect(out[0].regle).toBe("prospect_ouvert");
    expect(out[0].correction).toMatchObject({ type: "prospect_signe", prospectId: "p1", collabId: "c1" });
    expect(out[0].decision).toBe(false);
  });
  it("plusieurs collabs possibles : pas de correction, décision de Marc", () => {
    const out = controler(base({ collabs: [collab({}), collab({ id: "c2" })], prospects: [{ id: "p1", brand: "Marque Alpha", stage: "Contact" }] }));
    expect(out[0].correction).toBeNull();
    expect(out[0].decision).toBe(true);
  });
  it("prospect signé ou perdu, autre créateur, collab perdue : rien", () => {
    expect(regles({ collabs: [collab({})], prospects: [{ id: "p1", brand: "Marque Alpha", stage: "Signé" }, { id: "p2", brand: "Marque Alpha", stage: "Perdue" }] })).toEqual([]);
    expect(regles({ collabs: [collab({})], prospects: [{ id: "p1", brand: "Marque Alpha", stage: "Contact", creator: "Autre Nom" }] })).toEqual([]);
    expect(regles({ collabs: [collab({ status: "perdue" })], prospects: [{ id: "p1", brand: "Marque Alpha", stage: "Contact" }] })).toEqual([]);
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
    expect(lectureCachet("affiliation")).toBe("illisible");
    expect(lectureCachet("10 % des ventes")).toBe("illisible");
    expect(lectureCachet("800 € x 2")).toBe("illisible");
    expect(lectureCachet("2000 AED")).toBe("devise");
  });
  it("une ligne par collab vivante au cachet illisible", () => {
    const out = controler(base({ collabs: [collab({ cachet: "affiliation" }), collab({ id: "c2", cachet: "2000 AED" }), collab({ id: "c3", cachet: "affiliation", status: "archivee" })] }));
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
    const out = controler(base({ contacts: [{ id: "1", tag: "Marque" }, { id: "2", tag: "marque" }, { id: "3", tag: "influence" }, { id: "4", tag: "marque" }, { id: "5", tag: null }] }));
    expect(out).toHaveLength(1);
    expect(out[0].titre).toBe("3 contacts avec une étiquette libre");
    expect(out[0].detail).toContain("« marque » (2)");
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
