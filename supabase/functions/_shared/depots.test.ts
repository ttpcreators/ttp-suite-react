import { describe, expect, it } from "vitest";
import { depotSuivi, depotsEnAttente, estDepotCreateur, joursDepuis, type Depot } from "./depots.ts";

const depot = (o: Partial<Depot>): Depot => ({
  id: "d1",
  creator: "CRÉATRICE A",
  type: "contenu",
  name: "Contenu Marque X · 20 nov.",
  path: "creator-uploads/0000/contenu-1.mp4",
  created_at: "2026-11-20T10:00:00+00:00",
  collab_id: "c1",
  ...o,
});

describe("estDepotCreateur", () => {
  it("un dépôt du créateur : son dossier et un type connu", () => {
    expect(estDepotCreateur(depot({}))).toBe(true);
    expect(estDepotCreateur(depot({ type: "facture" }))).toBe(true);
    expect(estDepotCreateur(depot({ type: "brief" }))).toBe(false);
    expect(estDepotCreateur(depot({ path: "1700000000-contrat.pdf" }))).toBe(false);
    expect(estDepotCreateur(depot({ path: "creator-uploads/0000/todo-attachments/t1/a.png" }))).toBe(false);
  });
});

describe("depotsEnAttente", () => {
  const collabs = [{ id: "c1", brand: "Marque X", creator: "Créatrice A" }];
  it("sans repère non lu (avant le SQL, ou déjà vu) : rien n'attend", () => {
    expect(depotsEnAttente({ depots: [depot({})], nonLus: new Set() })).toEqual([]);
  });
  it("repère non lu : le dépôt attend, regroupé par type, collab et créateur", () => {
    const out = depotsEnAttente({
      depots: [depot({}), depot({ id: "d2", created_at: "2026-11-21T08:00:00+00:00", name: "" }), depot({ id: "d3", type: "facture", collab_id: null })],
      nonLus: new Set(["d1", "d2", "d3"]),
      collabs,
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ type: "contenu", collabId: "c1", brand: "Marque X", ids: ["d1", "d2"], noms: ["Contenu Marque X · 20 nov.", "Fichier"], depuis: "2026-11-20T10:00:00+00:00", dernier: "2026-11-21T08:00:00+00:00" });
    expect(out[1]).toMatchObject({ type: "facture", collabId: null, brand: null, ids: ["d3"] });
  });
  it("sans collab_id (avant le SQL) : un groupe par créateur et par type", () => {
    const out = depotsEnAttente({ depots: [depot({ collab_id: undefined }), depot({ id: "d2", collab_id: undefined, creator: "Créatrice A" })], nonLus: new Set(["d1", "d2"]) });
    expect(out).toHaveLength(1);
    expect(out[0].ids).toEqual(["d1", "d2"]);
  });
  it("contenu : sort quand la collab atteint « Validation marque » après le dépôt", () => {
    const apres = [{ collab_id: "c1", step: 5, reached_at: "2026-11-22T09:00:00+00:00" }];
    const avant = [{ collab_id: "c1", step: 5, reached_at: "2026-11-01T09:00:00+00:00" }];
    expect(depotsEnAttente({ depots: [depot({})], nonLus: new Set(["d1"]), steps: apres })).toEqual([]);
    // Une V2 déposée alors que la collab était déjà à l'étape 5 attend toujours.
    expect(depotsEnAttente({ depots: [depot({})], nonLus: new Set(["d1"]), steps: avant })).toHaveLength(1);
  });
  it("facture : sort quand un versement au créateur est noté depuis le dépôt", () => {
    const d = depot({ type: "facture" });
    expect(depotSuivi(d, { payouts: { "Créatrice A": [{ date: "2026-11-20", amount: 100 }] } })).toBe(true);
    expect(depotSuivi(d, { payouts: { "Créatrice A": [{ date: "2026-11-19", amount: 100 }] } })).toBe(false);
    expect(depotSuivi(d, { payouts: null })).toBe(false);
    expect(depotSuivi(d, { steps: [{ collab_id: "c1", step: 10, reached_at: "2026-11-23T09:00:00+00:00" }] })).toBe(true);
  });
  it("stats : seul le repère compte (les stats d'un post font avancer la collab toutes seules)", () => {
    const d = depot({ type: "stats" });
    expect(depotSuivi(d, { steps: [{ collab_id: "c1", step: 7, reached_at: "2026-11-23T09:00:00+00:00" }] })).toBe(false);
  });
});

describe("joursDepuis", () => {
  it("jours entiers jusqu'à aujourd'hui", () => {
    expect(joursDepuis("2026-11-20T10:00:00+00:00", "2026-11-23")).toBe(3);
    expect(joursDepuis("2026-11-23", "2026-11-23")).toBe(0);
    expect(joursDepuis("2026-11-25", "2026-11-23")).toBe(0);
  });
});
