import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENTETE_ACTEUR, valeurActeur } from "./acteurConnecteur.ts";

/*
 * La base lit l'en-tête du connecteur (supabase/sql/2026-11-27-acteur-connecteur.sql) : même
 * nom d'en-tête, et toute valeur produite ici doit passer son filtre. Sinon les écritures
 * d'Alfred restent muettes (aucun repère « nouveau »).
 */
const sql = readFileSync(new URL("../../sql/2026-11-27-acteur-connecteur.sql", import.meta.url), "utf8");
const motif = /v ~ '([^']+)'/.exec(sql)?.[1] ?? "";
const filtre = new RegExp(motif);
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("en-tête d'acteur : le connecteur et la base s'accordent", () => {
  it("la base lit le même nom d'en-tête", () => {
    expect(sql).toContain(`->> '${ENTETE_ACTEUR}'`);
  });

  it("toute valeur du connecteur passe le filtre de la base", () => {
    expect(motif).not.toBe("");
    for (const libelle of ["Alfred", "Tâches planifiées", null]) {
      for (const userId of [ID, ID.toUpperCase(), "", "Créatrice A"]) {
        expect(filtre.test(valeurActeur({ libelle, userId }))).toBe(true);
      }
    }
  });

  it("la base ignore une valeur inventée", () => {
    for (const v of ["admin", "alfred · marque x", "claude:créatrice-a", "alfred;drop", `agency:${ID}`, ""]) {
      expect(filtre.test(v)).toBe(false);
    }
  });
});
