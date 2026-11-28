import { describe, expect, it } from "vitest";
import { AUTO_TASKS, VERIF_PAIEMENT, autoTaskFor, stepTaskTexts } from "./collabLinks";
import sql27 from "../../supabase/sql/2026-11-27-etape-collab-auto.sql?raw";
// Dernière version de collabs_step_task (l'étape 9 sans facture payée) : c'est elle qui fait foi.
import sql from "../../supabase/sql/2026-11-28-etape9-paiement.sql?raw";

/*
 * La tâche de l'étape est aussi posée par la base (déclencheur collabs_step_task,
 * supabase/sql/2026-11-27-etape-collab-auto.sql, refait par 2026-11-28-etape9-paiement.sql),
 * qui recopie AUTO_TASKS. Les deux doivent
 * rester identiques : sinon l'anti-doublon ne reconnaît plus la tâche de l'autre, et la
 * collab reçoit deux tâches au texte différent.
 */

/** Modèles écrits dans le SQL : (étape, 'texte', jours). */
function modelesSql(sql: string): Record<number, { text: string; days: number }> {
  const bloc = sql.slice(sql.indexOf("from (values"), sql.indexOf(") as m(etape, texte, jours)"));
  const out: Record<number, { text: string; days: number }> = {};
  for (const m of bloc.matchAll(/\((\d+),\s*'((?:[^']|'')*)',\s*(\d+)\)/g)) {
    out[Number(m[1])] = { text: m[2].replace(/''/g, "'"), days: Number(m[3]) };
  }
  return out;
}

describe("tâche de l'étape : la base et l'app disent la même chose", () => {
  it("mêmes étapes, mêmes textes, mêmes échéances", () => {
    expect(Object.keys(modelesSql(sql)).length).toBeGreaterThan(0);
    expect(modelesSql(sql)).toEqual(AUTO_TASKS);
    expect(modelesSql(sql27)).toEqual(AUTO_TASKS);
  });

  it("mêmes mots de repli sans créateur ni marque", () => {
    const now = new Date(2026, 10, 27, 10).getTime();
    expect(autoTaskFor(9, { brand: "Marque X", creator: null }, now)?.text).toBe("Reverser le créateur");
    expect(autoTaskFor(7, { brand: "  ", creator: "Créatrice A" }, now)?.text).toBe("Créer la facture la marque");
    expect(sql).toContain("'le créateur'");
    expect(sql).toContain("'la marque'");
  });

  it("étape 9 sans facture payée : même texte et même échéance que l'app, reconnue par l'app", () => {
    expect(sql).toContain(`v_modele := '${VERIF_PAIEMENT.text}';`);
    expect(sql).toContain(`v_jours := ${VERIF_PAIEMENT.days};`);
    expect(sql).toContain(`if new.step = ${VERIF_PAIEMENT.step} then`);
    expect(stepTaskTexts(9, { brand: "Marque X", creator: "Créatrice A" })).toEqual(["Reverser Créatrice", "Vérifier le paiement de Marque X"]);
    expect(stepTaskTexts(7, { brand: "Marque X", creator: "Créatrice A" })).toEqual(["Créer la facture Marque X"]);
    expect(stepTaskTexts(3, { brand: "Marque X", creator: null })).toEqual([]);
  });

  it("même anti-doublon : même texte sans casse, pour la collab, ou sans collab et pas faite", () => {
    expect(sql).toContain("lower(t.text) = lower(v_texte)");
    expect(sql).toContain("t.collab_id = new.id or (t.collab_id is null and not coalesce(t.done, false))");
  });
});
