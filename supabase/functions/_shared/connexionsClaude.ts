// ============================================================================
// _shared/connexionsClaude.ts : les connexions du connecteur Claude (mcp_grants), vues par
// les fondateurs, et l'origine des propositions d'agents (agent.actions).
// Règles PURES, testées par connexionsClaude.test.ts.
// ----------------------------------------------------------------------------
// Enquête du 27/11 : un fondateur ne voyait que ses propres connexions, et les propositions
// d'Alfred et des Claude des fondateurs étaient mélangées dans la page Agents.
// Depuis le SQL 2026-11-27-verrou-connexions :
//   • connexions_claude() (fondateurs) liste toutes les connexions de l'agence : lue par la page
//     Paramètres › Connexions Claude et par la page Agents (src/lib/connexionsClaudeDb.ts) ;
//   • chaque proposition garde son compte (cree_par) et sa connexion (grant_id) : posés par
//     proposer_action (ttp-mcp/tools.ts), affichés par origineProposition.
// ============================================================================

/** Une connexion du connecteur (une ligne de connexions_claude()). */
export type ConnexionClaude = {
  id: string;
  /** Nom que l'application s'est donné à l'inscription (« Claude », « ChatGPT »…). */
  nom: string;
  /** Compte TTP Suite qui a donné l'accord. */
  compte: string;
  compteNom: string | null;
  creeLe: string;
  dernierUsage: string | null;
  coupeeLe: string | null;
  /** Case « agent autonome » : envois et actions irréversibles validés dans la page Agents. */
  agent: boolean;
  /** Seul compte dont la validation compte pour cette connexion (null = tout fondateur). */
  valideur: string | null;
  appels7j: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const texte = (v: unknown) => (typeof v === "string" ? v : "");
const date = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null);

/** Une ligne renvoyée par la fonction SQL, lue sans faire confiance à sa forme (null si illisible). */
export function lireConnexion(r: unknown): ConnexionClaude | null {
  const o = r && typeof r === "object" && !Array.isArray(r) ? (r as Record<string, unknown>) : null;
  if (!o || !UUID.test(texte(o.id)) || !UUID.test(texte(o.compte))) return null;
  const creeLe = date(o.cree_le);
  if (!creeLe) return null;
  const n = Number(o.appels_7j);
  return {
    id: texte(o.id),
    nom: texte(o.nom).trim() || "Claude",
    compte: texte(o.compte),
    compteNom: texte(o.compte_nom).trim() || null,
    creeLe,
    dernierUsage: date(o.dernier_usage),
    coupeeLe: date(o.coupee_le),
    agent: o.agent === true,
    valideur: UUID.test(texte(o.valideur)) ? texte(o.valideur) : null,
    appels7j: Number.isFinite(n) && n > 0 ? Math.round(n) : 0,
  };
}

/** Les actives d'abord (la dernière utilisée en tête), puis les coupées (la dernière coupée en tête). */
export function trierConnexions(xs: readonly ConnexionClaude[]): ConnexionClaude[] {
  const t = (s: string | null) => (s ? Date.parse(s) : 0);
  return [...xs].sort((a, b) => {
    if (!!a.coupeeLe !== !!b.coupeeLe) return a.coupeeLe ? 1 : -1;
    if (a.coupeeLe && b.coupeeLe) return t(b.coupeeLe) - t(a.coupeeLe);
    return t(b.dernierUsage) - t(a.dernierUsage) || t(b.creeLe) - t(a.creeLe);
  });
}

/** Prénom affiché d'un compte : « Gianni.V » → « Gianni » (comme le journal des agents) ; vide → « compte sans nom ». */
export function prenom(nom: string | null | undefined): string {
  return String(nom ?? "").trim().replace(/\.\w*$/, "").trim() || "compte sans nom";
}

/** Titre d'une connexion : « Claude de Gianni ». */
export function titreConnexion(c: Pick<ConnexionClaude, "nom" | "compteNom">): string {
  return `${c.nom || "Claude"} de ${prenom(c.compteNom)}`;
}

export type Origine = {
  /** « l'agent autonome de Marc », « Claude de Gianni », « Gianni dans l'app » (se lit après « Proposé par »). */
  texte: string;
  /** Déposée par une connexion cochée « agent autonome ». */
  agent: boolean;
  /** Valideur imposé par cette connexion d'agent (null = tout fondateur). */
  valideur: string | null;
};

/**
 * Qui a déposé une proposition (agent.actions.cree_par et grant_id). null : proposition d'avant
 * le 27/11, on ne sait pas. `noms` : prénoms des comptes agence (user_id → nom affiché).
 */
export function origineProposition(
  p: { cree_par?: string | null; grant_id?: string | null },
  connexions: ReadonlyMap<string, ConnexionClaude>,
  noms: ReadonlyMap<string, string>,
): Origine | null {
  const g = p.grant_id ? connexions.get(p.grant_id) : undefined;
  if (g) {
    const qui = prenom(g.compteNom ?? noms.get(g.compte));
    return g.agent
      ? { texte: `l'agent autonome de ${qui}`, agent: true, valideur: g.valideur }
      : { texte: `${g.nom || "Claude"} de ${qui}`, agent: false, valideur: null };
  }
  if (p.grant_id) return { texte: p.cree_par ? `Claude de ${prenom(noms.get(p.cree_par))}` : "Claude", agent: false, valideur: null };
  if (p.cree_par) return { texte: `${prenom(noms.get(p.cree_par))} dans l'app`, agent: false, valideur: null };
  return null;
}
