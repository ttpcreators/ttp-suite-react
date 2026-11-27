import { describe, expect, it } from "vitest";
import vague from "../../supabase/sql/2026-11-27-reperes-depots-infos.sql?raw";
import avant from "../../supabase/sql/2026-11-27-securite-14.sql?raw";

/*
 * « Stats du mois à jour » (creators.stats_month) est le relevé de l'agence : seule l'agence
 * ou une synchro le coche, jamais l'espace créateur (monthlyStatsSent, creatorNextStep.ts).
 * La vague 1 recopie la garde creators_guard (2026-11-27-securite-14.sql) et y ajoute
 * stats_month (2026-11-27-reperes-depots-infos.sql, constat W17). La copie ne doit rien
 * perdre de l'ancienne garde : tarifs du media kit, commission, statut…
 */

/** Corps de creators_guard dans un fichier SQL, blancs ramenés à un espace. */
function garde(sql: string): string {
  const debut = sql.indexOf("create or replace function public.creators_guard()");
  const fin = sql.indexOf("end $$;", debut);
  expect(debut).toBeGreaterThanOrEqual(0);
  expect(fin).toBeGreaterThan(debut);
  return sql.slice(debut, fin).replace(/\s+/g, " ").trim();
}

describe("garde de la fiche créateur : le mois des stats reste à l'agence", () => {
  it("la vague remet la valeur d'avant pour stats_month", () => {
    expect(garde(vague)).toContain("new.stats_month := old.stats_month;");
  });

  it("la copie garde tout le reste de l'ancienne garde, à l'identique", () => {
    const sansStats = garde(vague).replace(" new.stats_month := old.stats_month;", "");
    expect(sansStats).toBe(garde(avant));
  });
});
