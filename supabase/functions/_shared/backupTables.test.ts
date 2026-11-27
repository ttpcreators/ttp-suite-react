import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  fichierCsv,
  nomTable,
  RAISONS_EXCLUSION,
  TABLES_EXCLUES,
  TABLES_SAUVEES,
  tablesDeLApi,
  tablesNonClassees,
  texteExclusions,
} from "./backupTables.ts";

/** Tous les « create table » des fichiers SQL du dépôt (commentaires retirés), au format de nomTable. */
function tablesDuDepot(): string[] {
  const racine = new URL("../../", import.meta.url); // supabase/
  const dossier = (d: string) => (existsSync(new URL(d, racine)) ? readdirSync(new URL(d, racine)).filter((f) => f.endsWith(".sql")).map((f) => new URL(`${d}${f}`, racine)) : []);
  const fichiers = [new URL("SETUP.sql", racine), new URL("PUSH_SETUP.sql", racine), ...dossier("sql/"), ...dossier("migrations/")].filter((u) => existsSync(u));
  const out = new Set<string>();
  for (const f of fichiers) {
    const sql = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?([a-z0-9_]+)"?\.)?"?([a-z0-9_]+)"?/gi)) {
      const schema = (m[1] ?? "public").toLowerCase();
      const table = m[2].toLowerCase();
      out.add(schema === "public" ? table : `${schema}.${table}`);
    }
  }
  return [...out].sort();
}

describe("sauvegarde mensuelle : toutes les tables sont classées", () => {
  it("chaque table créée par un SQL du dépôt est sauvegardée ou exclue exprès", () => {
    const tables = tablesDuDepot();
    expect(tables.length).toBeGreaterThan(60);
    expect(tablesNonClassees(tables)).toEqual([]);
  });
  it("aucune table à la fois sauvegardée et exclue, aucun doublon", () => {
    const noms = TABLES_SAUVEES.map(nomTable);
    expect(new Set(noms).size).toBe(noms.length);
    expect(noms.filter((n) => n in TABLES_EXCLUES)).toEqual([]);
    for (const r of Object.values(TABLES_EXCLUES)) expect(RAISONS_EXCLUSION[r]).toBeTruthy();
  });
  it("les 10 tables oubliées jusqu'au 27/11 sont dans l'archive", () => {
    const noms = TABLES_SAUVEES.map(nomTable);
    for (const t of ["ne_plus_contacter", "notes", "email_activity", "ig_threads", "creator_mail_threads", "mail_reply_drafts", "envoi_file", "agent.memoire_createurs", "agent.lecons", "agent.actions"]) {
      expect(noms).toContain(t);
    }
  });
  it("jamais de jeton, de clé ni le coffre des mots de passe", () => {
    const noms = TABLES_SAUVEES.map(nomTable);
    for (const t of ["google_tokens", "ig_accounts", "tt_accounts", "yt_accounts", "creator_mail_boxes", "mcp_tokens", "mcp_codes", "mcp_clients", "push_subscriptions", "app_state_backups", "module_rows"]) {
      expect(noms).not.toContain(t);
      expect(TABLES_EXCLUES[t]).toBeTruthy();
    }
  });
});

describe("contrôle du jour (tables réellement en base)", () => {
  it("signale une table nouvelle, pas les tables classées ni les vues", () => {
    expect(tablesNonClassees(["contacts", "agent.lecons", "public_roster", "google_tokens", "nouvelle_table", "agent.nouvelle", "nouvelle_table"])).toEqual(["agent.nouvelle", "nouvelle_table"]);
  });
  it("lit les noms dans la description OpenAPI de PostgREST", () => {
    expect(tablesDeLApi({ swagger: "2.0", definitions: { contacts: {}, public_roster: {} }, paths: {} })).toEqual(["contacts", "public_roster"]);
    expect(tablesDeLApi({ message: "No API key found in request" })).toBeNull();
    expect(tablesDeLApi(null)).toBeNull();
  });
});

describe("fichiers et LISEZMOI", () => {
  it("un CSV par table, ceux d'Alfred dans donnees/agent/", () => {
    expect(fichierCsv({ schema: "public", table: "contacts" })).toBe("donnees/contacts.csv");
    expect(fichierCsv({ schema: "agent", table: "lecons" })).toBe("donnees/agent/lecons.csv");
    expect(nomTable({ schema: "agent", table: "lecons" })).toBe("agent.lecons");
  });
  it("le LISEZMOI nomme chaque table exclue, avec sa raison, et le radar sans ses posts", () => {
    const txt = texteExclusions();
    for (const t of Object.keys(TABLES_EXCLUES)) expect(txt).toContain(t);
    expect(txt).toContain(RAISONS_EXCLUSION.jetons);
    expect(txt).toContain("donnees/ig_radar.csv : le tri seulement");
    expect(txt).not.toMatch(/[—–]/);
  });
});
