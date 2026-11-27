import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type DemandePage,
  fichierCsv,
  type Ligne,
  lireTable,
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

describe("lecture dans l'ordre de la clé", () => {
  it("chaque table sauvegardée a sa clé, et les colonnes lues la comprennent", () => {
    for (const t of TABLES_SAUVEES) {
      expect(t.cle.length, nomTable(t)).toBeGreaterThan(0);
      if (t.colonnes) {
        const lues = t.colonnes.split(",").map((c) => c.trim());
        for (const c of t.cle) expect(lues, nomTable(t)).toContain(c);
      }
    }
    // Les tables de plusieurs pages (clés vérifiées en base le 27/11).
    const cle = (n: string) => TABLES_SAUVEES.find((t) => nomTable(t) === n)?.cle;
    expect(cle("ig_radar")).toEqual(["brand"]);
    expect(cle("ig_messages")).toEqual(["id"]);
    expect(cle("ig_threads")).toEqual(["id"]);
    expect(cle("email_activity")).toEqual(["id"]);
    expect(cle("ig_profile_history")).toEqual(["username", "d"]);
    expect(cle("creator_mail_threads")).toEqual(["creator", "thread_id"]);
    expect(cle("agent.skills_privees")).toEqual(["nom"]);
  });

  /** Fausse table triée par « id », lue comme le fait la fonction (après une clé, ou par rang). */
  const fausseTable = (lignes: Ligne[]) => {
    const demandes: DemandePage[] = [];
    const lire = async (d: DemandePage) => {
      demandes.push(d);
      const triees = [...lignes].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const suite = d.apres === undefined ? triees : triees.filter((l) => String(l.id) > String(d.apres));
      return { data: suite.slice(d.depuis, d.depuis + d.taille), error: null };
    };
    return { lire, demandes };
  };
  const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `id-${String(i).padStart(3, "0")}` }));

  it("clé d'une colonne : chaque page reprend après la dernière clé lue", async () => {
    const { lire, demandes } = fausseTable(ids(5));
    const r = await lireTable({ cle: ["id"] }, lire, { taille: 2 });
    expect(r.partial).toBe(false);
    expect(r.rows.map((l) => l.id)).toEqual(["id-000", "id-001", "id-002", "id-003", "id-004"]);
    expect(demandes).toEqual([
      { apres: undefined, depuis: 0, taille: 2 },
      { apres: "id-001", depuis: 0, taille: 2 },
      { apres: "id-003", depuis: 0, taille: 2 },
    ]);
  });

  it("une ligne ajoutée pendant la lecture ne fait ni doublon ni trou", async () => {
    const lignes = ids(4);
    const { lire } = fausseTable(lignes);
    let tour = 0;
    const r = await lireTable(
      { cle: ["id"] },
      async (d) => {
        // Après la première page, une nouvelle ligne arrive AVANT la position de lecture.
        if (tour++ === 1) lignes.push({ id: "id-000a" });
        return lire(d);
      },
      { taille: 2 },
    );
    const lus = r.rows.map((l) => l.id);
    expect(lus).toEqual(["id-000", "id-001", "id-002", "id-003"]);
    expect(new Set(lus).size).toBe(lus.length);
  });

  it("clé de plusieurs colonnes : par rang, dans le même ordre", async () => {
    const { lire, demandes } = fausseTable(ids(5));
    const r = await lireTable({ cle: ["id", "autre"] }, lire, { taille: 2 });
    expect(r).toMatchObject({ partial: false });
    expect(r.rows).toHaveLength(5);
    expect(demandes.map((d) => [d.apres, d.depuis])).toEqual([[undefined, 0], [undefined, 2], [undefined, 4]]);
  });

  it("incomplète si une page échoue, si une ligne n'a pas sa clé, ou au garde-fou", async () => {
    let n = 0;
    const panne = await lireTable({ cle: ["id"] }, async (d) => (n++ ? { data: null, error: { code: "57014" } } : fausseTable(ids(5)).lire(d)), { taille: 2 });
    expect(panne).toMatchObject({ partial: true });
    expect(panne.rows).toHaveLength(2);
    const sansCle = await lireTable({ cle: ["brand"] }, fausseTable(ids(5)).lire, { taille: 2 });
    expect(sansCle).toMatchObject({ partial: true });
    const plafond = await lireTable({ cle: ["id"] }, fausseTable(ids(10)).lire, { taille: 2, max: 4 });
    expect(plafond).toMatchObject({ partial: true });
    expect(plafond.rows).toHaveLength(4);
    expect(await lireTable({ cle: [] }, fausseTable(ids(3)).lire)).toEqual({ rows: [], partial: true });
  });

  it("une table vide, ou pile une page pleine puis rien", async () => {
    expect(await lireTable({ cle: ["id"] }, fausseTable([]).lire)).toEqual({ rows: [], partial: false });
    const r = await lireTable({ cle: ["id"] }, fausseTable(ids(4)).lire, { taille: 2 });
    expect(r).toMatchObject({ partial: false });
    expect(r.rows).toHaveLength(4);
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
  it("ig_profiles n'est pas présentée comme un simple cache : c'est la base de créateurs", () => {
    expect(TABLES_EXCLUES.ig_profiles).toBe("base");
    expect(texteExclusions()).toContain(`${RAISONS_EXCLUSION.base} : ig_profiles.`);
    expect(RAISONS_EXCLUSION.base).toContain("relire ces profils un par un chez Meta");
  });
});
