// ============================================================================
// _shared/acteurConnecteur.ts : dire à la base QUI écrit par le connecteur Claude (ttp-mcp).
// ----------------------------------------------------------------------------
// Le connecteur écrit avec la clé service_role : auth.uid() est vide, et la base ne sait
// pas que l'écriture vient d'Alfred ou du Claude d'un membre de l'équipe. Les déclencheurs
// des repères « nouveau » (todos_activity, ideas_activity, briefs_activity) s'arrêtent donc.
//
// Le connecteur envoie un en-tête HTTP à chaque requête faite pour un appel d'outil :
//   x-ttp-acteur: alfred:<id du compte>   connexion dont le LIBELLÉ dit « Alfred »
//   x-ttp-acteur: claude:<id du compte>   toute autre connexion
// Le nom vient d'un libellé explicite de la connexion, jamais de la case « agent autonome » :
// une connexion d'agent qui n'est pas Alfred (tâches planifiées d'un fondateur) serait sinon
// signée « Alfred » dans le journal d'activité. Pas encore branché dans ttp-mcp : le libellé
// de connexion (colonne à créer, réglée dans Paramètres › Connexions Claude) viendra avec.
// La base le lit dans activity_actor() et activity_actor_name() (SQL de la vague 1,
// 2026-11-27), SEULEMENT pour une requête service_role sans compte connecté : un compte
// connecté normalement ne peut pas s'en servir pour se faire passer pour l'agence.
// Sans en-tête (crons, autres fonctions, route /file-envoi) : rien ne change.
// Valeurs en ASCII seulement (un nom accentué ne passe pas dans un en-tête HTTP) : le
// prénom affiché (« Claude · Prénom ») est relu par la base dans profiles.
// ============================================================================

/** Nom de l'en-tête (PostgREST le range en minuscules dans request.headers). */
export const ENTETE_ACTEUR = "x-ttp-acteur";

/** Qui écrit : Alfred (connexion au libellé « Alfred ») ou le Claude d'un membre de l'équipe. */
export type ActeurConnecteur = "alfred" | "claude";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Le libellé dit Alfred : « Alfred », sans casse ni espaces autour (rien d'autre ne compte). */
export function libelleAlfred(libelle: string | null | undefined): boolean {
  return String(libelle ?? "").trim().toLowerCase() === "alfred";
}

/** Valeur de l'en-tête pour une connexion : « alfred:<id> » ou « claude:<id> » (sans l'id s'il est illisible). */
export function valeurActeur(c: { libelle?: string | null; userId: string }): string {
  const qui: ActeurConnecteur = libelleAlfred(c.libelle) ? "alfred" : "claude";
  const id = String(c.userId ?? "").trim().toLowerCase();
  return UUID.test(id) ? `${qui}:${id}` : qui;
}

/** En-têtes à donner au client Supabase du connecteur (createClient, option global.headers). */
export function entetesActeur(c: { libelle?: string | null; userId: string }): Record<string, string> {
  return { [ENTETE_ACTEUR]: valeurActeur(c) };
}
