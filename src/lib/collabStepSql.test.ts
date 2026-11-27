import { describe, expect, it } from "vitest";
import { AUTO_TASKS, autoTaskFor } from "./collabLinks";
import sql from "../../supabase/sql/2026-11-27-etape-collab-auto.sql?raw";

/*
 * La tâche de l'étape est aussi posée par la base (déclencheur collabs_step_task,
 * supabase/sql/2026-11-27-etape-collab-auto.sql), qui recopie AUTO_TASKS. Les deux doivent
 * rester identiques : sinon l'anti-doublon ne reconnaît plus la tâche de l'autre, et la
 * collab reçoit deux tâches au texte différent.
 */

/** Modèles écrits dans le SQL : (étape, 'texte', jours). */
function modelesSql(): Record<number, { text: string; days: number }> {
  const bloc = sql.slice(sql.indexOf("from (values"), sql.indexOf(") as m(etape, texte, jours)"));
  const out: Record<number, { text: string; days: number }> = {};
  for (const m of bloc.matchAll(/\((\d+),\s*'((?:[^']|'')*)',\s*(\d+)\)/g)) {
    out[Number(m[1])] = { text: m[2].replace(/''/g, "'"), days: Number(m[3]) };
  }
  return out;
}

describe("tâche de l'étape : la base et l'app disent la même chose", () => {
  it("mêmes étapes, mêmes textes, mêmes échéances", () => {
    expect(Object.keys(modelesSql()).length).toBeGreaterThan(0);
    expect(modelesSql()).toEqual(AUTO_TASKS);
  });

  it("mêmes mots de repli sans créateur ni marque", () => {
    const now = new Date(2026, 10, 27, 10).getTime();
    expect(autoTaskFor(9, { brand: "Marque X", creator: null }, now)?.text).toBe("Reverser le créateur");
    expect(autoTaskFor(7, { brand: "  ", creator: "Créatrice A" }, now)?.text).toBe("Créer la facture la marque");
    expect(sql).toContain("'le créateur'");
    expect(sql).toContain("'la marque'");
  });

  it("même anti-doublon : même texte sans casse, pour la collab, ou sans collab et pas faite", () => {
    expect(sql).toContain("lower(t.text) = lower(v_texte)");
    expect(sql).toContain("t.collab_id = new.id or (t.collab_id is null and not coalesce(t.done, false))");
  });
});
