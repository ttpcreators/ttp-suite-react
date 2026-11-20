import { describe, expect, it } from "vitest";
import { lundiDe, montantCachet, tableauLundi, tableauTexte, type TableauIn } from "./tableauLundi.ts";

// Jeudi 19 novembre 2026, 15 h à Paris : semaine du 16 au 22, la précédente du 9 au 15.
const NOW = new Date("2026-11-19T14:00:00Z");

describe("montantCachet", () => {
  it("lit les vrais cachets de l'app", () => {
    expect(montantCachet("400 € HT tout compris")).toBe(400);
    expect(montantCachet("500€")).toBe(500);
    expect(montantCachet("550 usd")).toBe(550);
    expect(montantCachet("1 500 €")).toBe(1500);
    expect(montantCachet("1.500 €")).toBe(1500);
    expect(montantCachet("1,5k €")).toBe(1500);
    expect(montantCachet("1200")).toBe(1200);
  });
  it("gifting et affiliation seule : 0", () => {
    expect(montantCachet("Gifting, pas de rémunération fixe (code perso et commission à préciser)")).toBe(0);
    expect(montantCachet("Affiliation seule, 30 % sur l'abonnement annuel à 69,99 €")).toBe(0);
    expect(montantCachet("Affiliation + Repas")).toBe(0);
    expect(montantCachet("Produits offert")).toBe(0);
    expect(montantCachet("")).toBe(0);
  });
});

describe("lundiDe", () => {
  it("donne le lundi de la semaine", () => {
    expect(lundiDe("2026-11-19")).toBe("2026-11-16");
    expect(lundiDe("2026-11-16")).toBe("2026-11-16");
    expect(lundiDe("2026-11-22")).toBe("2026-11-16");
  });
});

describe("tableauLundi", () => {
  const d: TableauIn = {
    contacts: [
      { tag: "Marque", touches: [
        { date: "2026-11-17", canal: "email", kind: "contact" },
        { date: "2026-11-18", canal: "email", kind: "reponse" },
        { date: "2026-11-18", canal: "linkedin", kind: "contact" },
        { date: "2026-11-10", canal: "email", kind: "relance" },
      ] },
      { tag: "Agence", touches: [{ date: "2026-11-02", canal: "whatsapp", kind: "reponse" }] },
      { tag: "Agence", touches: [] },
      { tag: "Marque", touches: null, last_contacted: "2026-09-01" },
    ],
    creatorPool: [{ last_contacted: "2026-11-17" }, { last_contacted: "2026-11-01" }],
    todos: [{ text: "Visio : Nakd × Léna", created_at: "2026-11-18T10:00:00Z" }, { text: "Relancer Teveo", created_at: "2026-11-18T10:00:00Z" }],
    events: [
      { date: "2026-11-17", type: "call" },
      { date: "2026-11-20", type: "reunion" },
      { date: "2026-11-12", type: "reunion" },
      { date: "2026-11-17", type: "shoot" },
      { date: "2026-11-18", type: "call", deleted: true },
    ],
    quotes: [{ issueDate: "2026-11-18", status: "envoye" }, { issueDate: "2026-11-18", status: "brouillon" }],
    signatures: [
      { reached_at: "2026-11-17T09:00:00Z", cachet: "1 000 €", creator: "LÉNA PASQUALE" },
      { reached_at: "2026-11-18T09:00:00Z", cachet: "Produits offert", creator: "Pierre" },
      { reached_at: "2026-11-10T09:00:00Z", cachet: "400 € HT", creator: "Justine" },
      { reached_at: "2026-10-27T09:00:00Z", cachet: "500€", creator: "LÉNA PASQUALE" },
    ],
  };
  const t = tableauLundi(d, NOW);

  it("Gianni cette semaine : envois et réponses par canal, passés à Marc, créatrices", () => {
    const g = t.maintenant.gianni;
    expect(t.maintenant.du).toBe("2026-11-16");
    expect(g.parCanal.email).toEqual({ envois: 1, reponses: 1 });
    expect(g.parCanal.linkedin.envois).toBe(1);
    expect(g).toMatchObject({ envois: 2, reponses: 1, tauxReponse: 50, contactsTouches: 1, passesAMarc: 1, creatricesApprochees: 1 });
  });

  it("Marc cette semaine : visios passées seulement, devis envoyés, deals et montant", () => {
    expect(t.maintenant.marc).toEqual({ visios: 1, devisEnvoyes: 1, dealsSignes: 2, dealsPayes: 1, montantHT: 1000, montantMoyen: 1000 });
  });

  it("semaine précédente", () => {
    expect(t.precedente.gianni.parCanal.email.envois).toBe(1);
    expect(t.precedente.marc).toMatchObject({ visios: 1, dealsSignes: 1, montantHT: 400 });
  });

  it("mois : montant, part de Léna, carnet, agences actives", () => {
    expect(t.mois).toMatchObject({
      mois: "2026-11", montantHT: 1400, cible: null, deals: 3, dealsPayes: 2, montantMoyen: 700,
      partLena: 71, creatricesQuiSignent: 2, carnetTraite: 3, carnetTotal: 4, agencesActives: 1,
    });
  });

  it("devis illisibles : non mesuré", () => {
    expect(tableauLundi({ ...d, quotes: null }, NOW).maintenant.marc.devisEnvoyes).toBeNull();
  });

  it("texte pour Alfred", () => {
    const s = tableauTexte(t);
    expect(s).toMatch(/Mails 1 \/ 145/);
    expect(s).toMatch(/passés à Marc 1/);
    expect(s).toMatch(/Montant HT signé 1 400 €/);
    expect(s).not.toMatch(/undefined|NaN/);
  });
});
