/**
 * Helpers « argent » PURS (aucune dépendance : ni React, ni Supabase). Isolés
 * ici pour que les tests Vitest puissent les couvrir SANS charger le client
 * Supabase (qui, importé, initialise un client Realtime → plantait en CI sur
 * Node sans WebSocket natif). Réexportés par appState.ts pour compatibilité.
 */

/** Parse un montant texte ("3 000 €", "1 200,50 €", "1.234,50", "1234.5") en nombre.
 *  Gère le séparateur décimal FR (virgule) sans l'écraser — sinon "3 000,00 €"
 *  était lu 300000 (×100). Le point est lu comme séparateur de milliers quand
 *  il y a aussi une virgule ("1.234,50") ou qu'il est suivi de 3 chiffres
 *  ("5.000 €" → 5000) ; sinon comme décimale ("1234.5"). */
export function parseAmount(x: unknown): number {
  if (typeof x === "number") return Number.isFinite(x) ? x : 0;
  let s = String(x ?? "")
    .replace(/\s/g, "")
    .replace(/[^0-9.,-]/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Les deux : le dernier séparateur est la décimale, l'autre les milliers
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // Virgule seule : décimale si unique, sinon milliers ("1,234,567")
    s = (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot >= 0) {
    // Point seul : milliers si plusieurs points ou "x.000", sinon décimale
    const dots = (s.match(/\./g) || []).length;
    const intPart = s.slice(0, s.indexOf(".")).replace("-", "");
    if (dots > 1 || (/^\d+\.\d{3}$/.test(s.replace("-", "")) && intPart !== "0")) {
      s = s.replace(/\./g, "");
    }
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Formate un nombre en "3 000 €" (normalise l'espace insécable des milliers). */
export function formatEuro(n: number): string {
  return n.toLocaleString("fr-FR").replace(/ /g, " ") + " €";
}
