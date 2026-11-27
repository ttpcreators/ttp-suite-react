import { describe, expect, it } from "vitest";
import { DEAL_MINIMUM_HT, REGLES_OFFRE, alerteDealMinimum, strategieTexte, tempsFortsDuMoment } from "./strategie.ts";
import { rcDefaultConfig } from "./representation.ts";

describe("tempsFortsDuMoment", () => {
  it("fin novembre : résolutions de janvier et Saint-Valentin", () => {
    const t = tempsFortsDuMoment("2026-11-20");
    expect(t).toHaveLength(2);
    expect(t[0]).toMatch(/Résolutions/);
    expect(t[1]).toMatch(/Saint-Valentin/);
  });
  it("une fenêtre qui passe le 31 décembre", () => {
    expect(tempsFortsDuMoment("2027-01-10")).toEqual([expect.stringMatching(/Résolutions/)]);
    expect(tempsFortsDuMoment("2026-12-20")).toEqual([expect.stringMatching(/Résolutions/)]);
  });
  it("printemps, été, rentrée ; rien en juin", () => {
    expect(tempsFortsDuMoment("2027-02-01")[0]).toMatch(/Printemps/);
    expect(tempsFortsDuMoment("2027-04-01")[0]).toMatch(/Été/);
    expect(tempsFortsDuMoment("2027-07-14")[0]).toMatch(/Rentrée/);
    expect(tempsFortsDuMoment("2027-06-15")).toEqual([]);
  });
});

describe("alerteDealMinimum", () => {
  it("signale un deal sous 500 € HT, pas au-dessus", () => {
    expect(alerteDealMinimum(300)).toMatch(/sous le deal minimum de 500 € HT/);
    expect(alerteDealMinimum(DEAL_MINIMUM_HT)).toBeNull();
    expect(alerteDealMinimum(0)).toBeNull();
    expect(alerteDealMinimum(Number.NaN)).toBeNull();
  });
});

describe("strategieTexte", () => {
  const t = strategieTexte("2026-11-20");
  it("contient les décisions, l'organisation et ce qui s'applique maintenant", () => {
    expect(t).toMatch(/Commission de 25 % pour les nouveaux contrats/);
    expect(t).toMatch(/au nom de Marc/);
    expect(t).toMatch(/lien pour réserver une visio/);
    expect(t).toMatch(/Ce qui s'applique maintenant \(2026-11-20\)/);
    expect(t).toMatch(/Saint-Valentin/);
    expect(t).toContain(REGLES_OFFRE);
  });
  it("qui valide : Gianni pour la prospection, Marc pour le reste ; Alfred en soutien de Gianni", () => {
    expect(t).toMatch(/la prospection \([^)]*\) sur le oui de Gianni/);
    expect(t).toMatch(/tout le reste \([^)]*\) sur le oui de Marc/);
    expect(t).not.toMatch(/Rien ne part sans le oui de Marc/);
    expect(t).toMatch(/Alfred ne prépare plus de mails de prospection/);
    expect(t).not.toMatch(/Séquence multicanal|marques neuves par jour/);
  });
  it("reste lisible par un agent (taille raisonnable)", () => {
    expect(t.length).toBeLessThan(16000);
    expect(t).not.toMatch(/undefined|NaN/);
  });
});

describe("contrats : 25 % pour les nouveaux non exclusifs", () => {
  it("taux uniforme par défaut", () => {
    expect(rcDefaultConfig("nonexclusif").commUniforme).toBe("25");
  });
});
