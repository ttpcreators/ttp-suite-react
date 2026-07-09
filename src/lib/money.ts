/**
 * Helpers « argent » PURS (aucune dépendance : ni React, ni Supabase). Isolés
 * ici pour que les tests Vitest puissent les couvrir SANS charger le client
 * Supabase (qui, importé, initialise un client Realtime → plantait en CI sur
 * Node sans WebSocket natif). Réexportés par appState.ts pour compatibilité.
 */

/** Parse un montant texte ("3 000 €", "1 200,50 €") en nombre.
 *  Gère le séparateur décimal FR (virgule) sans l'écraser — sinon "3 000,00 €"
 *  était lu 300000 (×100). Compatible avec les montants entiers ("2000 €" → 2000). */
export function parseAmount(x: unknown): number {
  const cleaned = String(x ?? "")
    .replace(/\s/g, "")
    .replace(",", ".")
    .replace(/[^0-9.\-]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Formate un nombre en "3 000 €" (normalise l'espace insécable des milliers). */
export function formatEuro(n: number): string {
  return n.toLocaleString("fr-FR").replace(/ /g, " ") + " €";
}
