// ============================================================================
// _shared/versement.ts : noter un versement fait à un créateur (outil noter_reversement).
// ----------------------------------------------------------------------------
// Demande de Marc (17 novembre 2026) : l'app se met à jour toute seule. Marc vire la part
// d'un créateur depuis sa banque et le dit à Alfred : le versement va dans la page
// Reversements (blob `creatorPayouts`, même format que l'app) sans que Marc le saisisse.
// Logique pure (testée par versement.test.ts) ; l'écriture est dans ttp-mcp/tools.ts.
// ============================================================================

export type Versement = { id: string; date: string; amount: number; note?: string };
type Carte = Record<string, unknown>;

const cle = (s: unknown) => String(s ?? "").trim().toLowerCase();

/**
 * La clé où ranger le versement, comme l'app (writeKey) : la graphie du nom qui a déjà des
 * versements, sinon le nom du roster. null : créateur inconnu (ni roster, ni versement).
 */
export function cleDuCreateur(nom: string, versements: Carte, roster: string[]): string | null {
  const k = cle(nom);
  if (!k) return null;
  const deja = Object.keys(versements).find((x) => cle(x) === k && Array.isArray(versements[x]) && (versements[x] as unknown[]).length > 0);
  if (deja) return deja;
  const duRoster = roster.find((r) => cle(r) === k);
  return duRoster ?? null;
}

/** Un versement du même montant à 5 jours près est déjà noté : c'est sans doute le même. */
export function versementEnDouble(liste: unknown, montant: number, date: string): Versement | null {
  if (!Array.isArray(liste)) return null;
  const t = Date.parse(date);
  for (const p of liste as Versement[]) {
    if (Math.abs(Number(p?.amount) - montant) > 0.5) continue;
    const d = Date.parse(String(p?.date ?? ""));
    if (!Number.isFinite(d) || !Number.isFinite(t) || Math.abs(d - t) <= 5 * 86_400_000) return p;
  }
  return null;
}

/** Date AAAA-MM-JJ valide et pas dans le futur, sinon null. */
export function dateVersement(v: unknown, aujourdhui: string): string | null {
  const s = String(v ?? "").trim() || aujourdhui;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s))) return null;
  return s > aujourdhui ? null : s;
}
