/**
 * Source UNIQUE du taux de commission agence : le champ `commission` de la fiche
 * créateur (roster). Facturation, Reversements et Aperçu lisent tous ce taux, si
 * bien qu'une modification sur la fiche se répercute partout.
 */
export const DEFAULT_COMMISSION = 20;

/** "25%", "25", "25,5 %" → 25 (nombre). null si vide/illisible. */
export function parseCommissionPct(s: string | null | undefined): number | null {
  if (s == null || s === "") return null;
  const m = /(\d+(?:[.,]\d+)?)/.exec(String(s));
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}

/** Construit une table nom_créateur → taux (%) depuis le roster. */
export function commissionMap(creators: { name: string; commission?: string | null }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of creators) {
    const v = parseCommissionPct(c.commission);
    if (v != null) out[c.name] = v;
  }
  return out;
}
