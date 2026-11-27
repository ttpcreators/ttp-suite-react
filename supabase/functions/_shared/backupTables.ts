// ============================================================================
// _shared/backupTables.ts : ce que la sauvegarde mensuelle (monthly-backup) met dans
// l'archive, table par table. Logique pure, testée par backupTables.test.ts.
// ----------------------------------------------------------------------------
// Chaque table de la base est soit SAUVEGARDÉE (un CSV dans donnees/), soit EXCLUE
// exprès, avec sa raison, écrite dans le LISEZMOI de l'archive (elle ne passe pas pour
// complète). Deux contrôles :
//   • le test relit tous les « create table » de supabase/ : une table qui n'est dans
//     aucune des deux listes fait échouer le build ;
//   • à chaque passage, la fonction compare aux tables réellement en base (schémas
//     public et agent) et signale dans le mail celles qui ne sont pas classées.
// Chaque table sauvegardée donne sa clé primaire : la lecture suit son ordre (lireTable).
// Une nouvelle table : l'ajouter ici, dans TABLES_SAUVEES (avec sa clé si ce n'est pas
// « id ») ou dans TABLES_EXCLUES.
// ============================================================================

export type Schema = "public" | "agent";
export type TableSauvee = {
  schema: Schema;
  table: string;
  /** Clé primaire, une ou plusieurs colonnes (vérifiées en base le 27/11) : ordre de lecture. */
  cle: readonly string[];
  /** Colonnes lues, si pas toutes (« * » sinon). Elles comprennent toujours la clé. */
  colonnes?: string;
  /** Ce qui manque exprès dans ce CSV (écrit dans le LISEZMOI). */
  note?: string;
};

type Options = Partial<Pick<TableSauvee, "cle" | "colonnes" | "note">>;
const pub = (table: string, o: Options = {}): TableSauvee => ({ schema: "public", table, cle: ["id"], ...o });
const agent = (table: string, o: Options = {}): TableSauvee => ({ schema: "agent", table, cle: ["id"], ...o });

/** Tables sauvegardées, une par fichier CSV. Clé « id » sauf mention contraire. */
export const TABLES_SAUVEES: readonly TableSauvee[] = [
  // Le travail de l'agence
  pub("contacts"), pub("creators"), pub("collabs"), pub("collab_steps"), pub("collab_posts"), pub("briefs"),
  pub("invoices"), pub("todos"), pub("todo_routines"), pub("events"), pub("gifting"), pub("documents"),
  pub("ideas"), pub("prospects"), pub("creator_pool"), pub("athlete_pool"), pub("creator_roadmap", { cle: ["creator"] }),
  pub("creator_lists"), pub("creator_base_meta", { cle: ["username"] }), pub("agency_mediakit"), pub("messages"),
  pub("notes", { cle: ["path"] }), pub("profiles", { cle: ["user_id"] }),
  // Mails et envois
  pub("creator_mail_settings", { cle: ["creator"] }), pub("creator_mail_status_log"), pub("creator_mail_notes"),
  pub("creator_mail_threads", { cle: ["creator", "thread_id"] }),
  pub("email_sequences"), pub("sequence_enrollments"), pub("email_activity"), pub("mail_reply_drafts"),
  pub("envoi_file"), pub("ne_plus_contacter"),
  // Instagram, TikTok, YouTube : conversations, publications prévues, tris de l'agence
  pub("ig_threads"), pub("ig_messages"), pub("ig_planned"), pub("ig_profile_history", { cle: ["username", "d"] }),
  pub("ig_rivals", { cle: ["username"] }),
  pub("ig_radar", { cle: ["brand"], colonnes: "brand, status, first_seen, last_seen", note: "le tri seulement (marque, statut, dates), sans les posts, que le radar relit" }),
  pub("yt_radar", { cle: ["brand"] }), pub("tt_brand_status", { cle: ["brand"] }),
  // Alfred (schéma agent)
  agent("agents"), agent("memoire_createurs"), agent("lecons"), agent("actions"), agent("demandes"),
  agent("cercle"), agent("prospects"), agent("skills_privees", { cle: ["nom"] }),
];

/** Raisons d'exclusion, telles qu'écrites dans le LISEZMOI. */
export const RAISONS_EXCLUSION = {
  jetons: "jetons de connexion, clés et accès (à refaire après une restauration)",
  technique: "quotas et état technique (recalculés tout seuls)",
  journaux: "journaux (historique technique, pas du travail)",
  reglages: "réglages de l'agence : déjà dans reglages-agence.json, sans le coffre des mots de passe",
  copies: "copies de secours (app_state_backups contient le coffre des mots de passe)",
  base: "la base de créateurs (profils Instagram lus chez Meta, agence détectée dans la bio) : après une restauration, il faut relire ces profils un par un chez Meta, sur le quota ; d'ici là, les listes de créateurs partagées aux marques s'affichent vides",
  caches: "caches que les radars relisent chez Meta, TikTok ou YouTube",
  vues: "vues (elles lisent des tables déjà sauvegardées)",
} as const;
export type RaisonExclusion = keyof typeof RAISONS_EXCLUSION;

/** Tables exclues exprès (« schéma.table » hors du schéma public). */
export const TABLES_EXCLUES: Readonly<Record<string, RaisonExclusion>> = {
  google_tokens: "jetons", ig_accounts: "jetons", tt_accounts: "jetons", yt_accounts: "jetons",
  creator_mail_boxes: "jetons", mcp_tokens: "jetons", mcp_codes: "jetons", mcp_clients: "jetons",
  mcp_grants: "jetons", push_subscriptions: "jetons", sync_state: "jetons",
  ig_quota: "technique", yt_quota: "technique", ig_sync_state: "technique", nav_seen: "technique",
  activity_events: "technique",
  error_log: "journaux", mcp_log: "journaux", agency_activity: "journaux", ig_connexions: "journaux",
  rdv_journal: "journaux", "agent.journal": "journaux", "agent.evenements": "journaux", "agent.cockpits": "journaux",
  module_rows: "reglages",
  app_state_backups: "copies", ig_radar_sauvegarde_20261125: "copies",
  // Choix soumis à Marc (27/11) : pas un simple cache, c'est aussi la base de créateurs.
  ig_profiles: "base",
  yt_channels: "caches", tt_commercial: "caches",
  public_mediakit: "vues", public_agency_mediakit: "vues", public_roster: "vues", public_creator_lists: "vues",
};

/** Nom affiché : « contacts », « agent.lecons ». */
export const nomTable = (t: { schema: Schema; table: string }): string => (t.schema === "public" ? t.table : `${t.schema}.${t.table}`);

/** Fichier dans l'archive : donnees/contacts.csv, donnees/agent/lecons.csv. */
export const fichierCsv = (t: { schema: Schema; table: string }): string =>
  t.schema === "public" ? `donnees/${t.table}.csv` : `donnees/${t.schema}/${t.table}.csv`;

// ── Lecture d'une table, page par page ─────────────────────────────────────
/** Lignes demandées par requête. */
export const TAILLE_PAGE = 1000;
/** Garde-fou : au-delà, la lecture s'arrête et la table est dite « incomplète ». */
export const LIGNES_MAX = 200_000;

export type Ligne = Record<string, unknown>;
/**
 * Une page, dans l'ordre de la clé. Clé d'une seule colonne : les `taille` lignes dont la
 * clé est plus grande que `apres` (au premier appel, depuis le début). Clé de plusieurs
 * colonnes : `taille` lignes à partir du rang `depuis`.
 */
export type DemandePage = { apres?: string | number; depuis: number; taille: number };
export type LirePage = (d: DemandePage) => Promise<{ data: readonly Ligne[] | null; error: unknown }>;

/**
 * Toutes les lignes d'une table, page par page, TOUJOURS dans l'ordre de sa clé. Sans
 * ordre, deux pages peuvent se chevaucher ou sauter des lignes sans aucune erreur, avec un
 * nombre de lignes plausible : écritures pendant la lecture (radar, mails, DM), ou
 * parcours partagé d'une grosse table par Postgres (ig_radar, bientôt).
 * Clé d'une seule colonne : chaque page reprend après la dernière clé lue, donc aucune
 * ligne sautée ni lue deux fois, même si la table change pendant la lecture. Clé de
 * plusieurs colonnes (deux petites tables) : par rang, dans le même ordre.
 * `partial` : lecture arrêtée par une erreur, une ligne sans sa clé ou le garde-fou ; la
 * sauvegarde le dit au lieu de passer pour complète.
 */
export async function lireTable(
  t: Pick<TableSauvee, "cle">,
  lirePage: LirePage,
  o: { taille?: number; max?: number } = {},
): Promise<{ rows: Ligne[]; partial: boolean }> {
  if (!t.cle.length) return { rows: [], partial: true }; // sans clé, pas d'ordre sûr : rien plutôt qu'une archive fausse
  const taille = o.taille ?? TAILLE_PAGE;
  const max = o.max ?? LIGNES_MAX;
  const parCle = t.cle.length === 1;
  const rows: Ligne[] = [];
  let apres: string | number | undefined;
  for (;;) {
    const { data, error } = await lirePage({ apres, depuis: parCle ? 0 : rows.length, taille });
    if (error) return { rows, partial: true };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < taille) return { rows, partial: false };
    if (rows.length >= max) return { rows, partial: true };
    if (parCle) {
      const k = page[page.length - 1][t.cle[0]];
      if (typeof k !== "string" && typeof k !== "number") return { rows, partial: true };
      apres = k;
    }
  }
}

/** Tables en base (noms comme nomTable) ni sauvegardées ni exclues exprès, triées. */
export function tablesNonClassees(enBase: readonly string[]): string[] {
  const sauvees = new Set(TABLES_SAUVEES.map(nomTable));
  return [...new Set(enBase)].filter((n) => n && !sauvees.has(n) && !(n in TABLES_EXCLUES)).sort();
}

/**
 * Tables et vues décrites par l'API de la base (réponse de GET /rest/v1/, format OpenAPI
 * de PostgREST, clé service). null si la réponse n'a pas la forme attendue.
 */
export function tablesDeLApi(spec: unknown): string[] | null {
  if (!spec || typeof spec !== "object") return null;
  const defs = (spec as { definitions?: unknown }).definitions;
  if (!defs || typeof defs !== "object" || Array.isArray(defs)) return null;
  return Object.keys(defs);
}

/** Le passage du LISEZMOI qui dit ce qui n'est PAS dans l'archive. */
export function texteExclusions(): string {
  const parRaison = new Map<RaisonExclusion, string[]>();
  for (const [t, r] of Object.entries(TABLES_EXCLUES)) parRaison.set(r, [...(parRaison.get(r) ?? []), t]);
  const lignes = ["Pas dans cette archive, exprès :"];
  for (const r of Object.keys(RAISONS_EXCLUSION) as RaisonExclusion[]) {
    const tables = parRaison.get(r);
    if (tables?.length) lignes.push(`- ${RAISONS_EXCLUSION[r]} : ${[...tables].sort().join(", ")}.`);
  }
  for (const t of TABLES_SAUVEES) if (t.note) lignes.push(`- ${fichierCsv(t)} : ${t.note}.`);
  lignes.push("- les fichiers déposés dans l'app (Storage : documents, captures, photos) et les comptes de connexion (profiles.csv dit seulement qui a quel rôle).");
  return lignes.join("\r\n");
}
