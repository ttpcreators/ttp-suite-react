import { describe, expect, it } from "vitest";
import { lireConnexion, origineProposition, prenom, titreConnexion, trierConnexions, type ConnexionClaude } from "./connexionsClaude.ts";

const MARC = "11111111-1111-1111-1111-111111111111";
const ASSOCIE = "33333333-3333-3333-3333-333333333333";
const G1 = "aaaaaaaa-0000-0000-0000-000000000001";
const G2 = "aaaaaaaa-0000-0000-0000-000000000002";
const G3 = "aaaaaaaa-0000-0000-0000-000000000003";

const c = (x: Partial<ConnexionClaude>): ConnexionClaude => ({
  id: G1, nom: "Claude", compte: MARC, compteNom: "Marc.M", creeLe: "2026-10-28T11:49:00Z", dernierUsage: null,
  coupeeLe: null, agent: false, valideur: null, appels7j: 0, ...x,
});

describe("connexions : lecture de connexions_claude()", () => {
  it("lit une ligne complète", () => {
    expect(lireConnexion({
      id: G2, nom: "Claude", compte: ASSOCIE, compte_nom: "Zoé.T", cree_le: "2026-10-30T22:43:00Z", dernier_usage: "2026-11-27T20:06:00Z",
      coupee_le: null, agent: true, valideur: MARC, appels_7j: "619",
    })).toEqual({
      id: G2, nom: "Claude", compte: ASSOCIE, compteNom: "Zoé.T", creeLe: "2026-10-30T22:43:00Z", dernierUsage: "2026-11-27T20:06:00Z",
      coupeeLe: null, agent: true, valideur: MARC, appels7j: 619,
    });
  });
  it("refuse une ligne sans id, sans compte ou sans date ; complète le reste", () => {
    expect(lireConnexion(null)).toBeNull();
    expect(lireConnexion({ id: "x", compte: MARC, cree_le: "2026-10-28T11:49:00Z" })).toBeNull();
    expect(lireConnexion({ id: G1, compte: MARC, cree_le: "hier" })).toBeNull();
    expect(lireConnexion({ id: G1, compte: MARC, cree_le: "2026-10-28T11:49:00Z", nom: " ", agent: "true", valideur: "Marc", appels_7j: -3 }))
      .toMatchObject({ nom: "Claude", compteNom: null, agent: false, valideur: null, appels7j: 0, dernierUsage: null });
  });
  it("les actives d'abord, la dernière utilisée en tête, puis les coupées", () => {
    const xs = trierConnexions([
      c({ id: G1, coupeeLe: "2026-11-01T10:00:00Z" }),
      c({ id: G2, dernierUsage: "2026-11-20T10:00:00Z" }),
      c({ id: G3, dernierUsage: "2026-11-27T10:00:00Z" }),
    ]);
    expect(xs.map((x) => x.id)).toEqual([G3, G2, G1]);
  });
  it("le titre et le prénom", () => {
    expect(prenom("Zoé.T")).toBe("Zoé");
    expect(prenom("  ")).toBe("compte sans nom");
    expect(titreConnexion({ nom: "ChatGPT", compteNom: "Zoé.T" })).toBe("ChatGPT de Zoé");
  });
});

describe("origine d'une proposition d'agent", () => {
  const connexions = new Map([
    [G1, c({ id: G1, agent: true, valideur: MARC })],
    [G2, c({ id: G2, compte: ASSOCIE, compteNom: "Zoé.T" })],
  ]);
  const noms = new Map([[MARC, "Marc.M"], [ASSOCIE, "Zoé.T"]]);
  it("par une connexion connue : agent autonome ou Claude de quelqu'un", () => {
    expect(origineProposition({ cree_par: MARC, grant_id: G1 }, connexions, noms)).toEqual({ texte: "l'agent autonome de Marc", agent: true, valideur: MARC });
    expect(origineProposition({ cree_par: ASSOCIE, grant_id: G2 }, connexions, noms)).toEqual({ texte: "Claude de Zoé", agent: false, valideur: null });
  });
  it("connexion inconnue de la liste, ou écrite depuis l'app", () => {
    expect(origineProposition({ cree_par: ASSOCIE, grant_id: G3 }, connexions, noms)?.texte).toBe("Claude de Zoé");
    expect(origineProposition({ cree_par: ASSOCIE, grant_id: null }, connexions, noms)?.texte).toBe("Zoé dans l'app");
  });
  it("proposition d'avant le 27/11 : on ne sait pas", () => {
    expect(origineProposition({}, connexions, noms)).toBeNull();
    expect(origineProposition({ cree_par: null, grant_id: null }, connexions, noms)).toBeNull();
  });
});
