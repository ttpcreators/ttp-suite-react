// ============================================================================
// _shared/quotaMeta.ts : qui passe en premier sur le quota Instagram (Meta).
// ----------------------------------------------------------------------------
// Audit du 24 novembre 2026 (point M3). Meta compte les demandes sur une heure glissante,
// pour toute l'app. Trois tâches se le partagent :
//   - la lecture des profils pour la prospection (lire_profils_instagram, Base créateurs) :
//     la plus utile, demandée par Gianni ou Claude → jusqu'à 85 % ;
//   - l'import de l'historique des DM (importer_historique_instagram, la nuit) → 75 % ;
//   - le radar des marques (ig-sourcing, toutes les 2 h) : tâche de fond → 60 % (cron).
// Chacune s'arrête à son plafond : ce qui reste sert aux tâches plus importantes. Et avant
// même de commencer, chacune relit le dernier relevé (table ig_quota) : si Meta a bloqué
// l'app, ou si le relevé d'il y a moins de 10 minutes dépasse déjà son plafond, elle ne
// lance aucune demande. Règles PURES, testées par quotaMeta.test.ts.
// ============================================================================

export type Tache = "profils" | "import" | "radar";

export const PLAFONDS: Record<Tache, number> = { profils: 85, import: 75, radar: 60 };

/** Relevé gardé dans ig_quota.data (écrit par saveUsage, _shared/instagram.ts). */
export type Releve = { appPct?: unknown; bucPct?: unknown; lastAt?: unknown; blockedUntil?: unknown };

/** Un relevé plus vieux ne dit plus rien de l'heure glissante en cours. */
export const RELEVE_FRAIS_MS = 10 * 60_000;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Part du quota du relevé (la plus haute des deux mesures), null si inconnue. */
export function partDuReleve(r: Releve | null | undefined): number | null {
  if (!r) return null;
  const a = num(r.appPct), b = num(r.bucPct);
  return a == null && b == null ? null : Math.max(a ?? 0, b ?? 0);
}

/**
 * Raison de ne pas commencer (« meta_limite » ou « quota_proche »), ou null. `plafond` = celui
 * de la tâche (ou celui donné à l'appel, par exemple 60 pour le cron du radar).
 */
export function raisonDAttendre(r: Releve | null | undefined, plafond: number, maintenant: number): "meta_limite" | "quota_proche" | null {
  if (!r) return null;
  const bloque = typeof r.blockedUntil === "string" ? Date.parse(r.blockedUntil) : NaN;
  if (Number.isFinite(bloque) && bloque > maintenant) return "meta_limite";
  const quand = typeof r.lastAt === "string" ? Date.parse(r.lastAt) : NaN;
  if (!Number.isFinite(quand) || maintenant - quand > RELEVE_FRAIS_MS) return null;
  const part = partDuReleve(r);
  return part != null && part >= plafond ? "quota_proche" : null;
}
