import { describe, expect, it } from "vitest";
import { appendPoint } from "./todoProgress";
import sql from "../../supabase/sql/2026-11-27-taches-pour-createur.sql?raw";

/*
 * Sur une tâche de l'agence, la base n'accepte qu'un ajout dans « Où j'en suis »
 * (todos_creators_guard, supabase/sql/2026-11-27-taches-pour-createur.sql) : le nouveau texte
 * doit commencer par l'ancien, aux blancs du début et de la fin près. appendPoint rogne
 * l'ancien texte avec String.trim() : la base doit retirer exactement les mêmes blancs, sinon
 * la réponse du créateur est refusée (une espace insécable en fin de point suffisait).
 */

/** Les blancs que la base retire (constante `rogne` du SQL), en RegExp d'un caractère. */
function blancsSql(): RegExp {
  const m = /rogne constant text := '\^\[([^\]]+)\]\+\|\[([^\]]+)\]\+\$';/.exec(sql);
  expect(m).not.toBeNull();
  expect(m?.[1]).toBe(m?.[2]);
  return new RegExp(`^[${m?.[1] ?? ""}]$`, "u");
}

/** Le texte rogné comme le fait la base. */
function rogneSql(texte: string, blanc: RegExp): string {
  let s = texte;
  while (s && blanc.test(s[0])) s = s.slice(1);
  while (s && blanc.test(s[s.length - 1])) s = s.slice(0, -1);
  return s;
}

describe("« Où j'en suis » : la base et l'app rognent les mêmes blancs", () => {
  it("mêmes caractères que String.trim(), sur tout le plan de base", () => {
    const blanc = blancsSql();
    const ecarts: string[] = [];
    for (let c = 0; c <= 0xffff; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue;
      const ch = String.fromCharCode(c);
      const pourApp = `a${ch}`.trim() === "a";
      if (pourApp !== blanc.test(ch)) ecarts.push(c.toString(16));
    }
    expect(ecarts).toEqual([]);
  });

  it("un point ajouté après une espace insécable commence par l'ancien texte", () => {
    const blanc = blancsSql();
    const ancien = "21/11/2026 · Agence : note\u00a0";
    const nouveau = appendPoint(ancien, "vu", new Date(2026, 10, 22), "Créateur");
    expect(rogneSql(nouveau, blanc).startsWith(rogneSql(ancien, blanc))).toBe(true);
  });
});
