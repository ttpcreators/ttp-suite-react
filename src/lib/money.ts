/**
 * Helpers « argent » PURS (aucune dépendance : ni React, ni Supabase). Isolés
 * ici pour que les tests Vitest puissent les couvrir SANS charger le client
 * Supabase (qui, importé, initialise un client Realtime → plantait en CI sur
 * Node sans WebSocket natif). Réexportés par appState.ts pour compatibilité.
 */

/** Lit UN nombre déjà isolé (sans signe ni suffixe) : "3000", "1200,50", "1.234,50", "1234.5".
 *  Gère le séparateur décimal FR (virgule) sans l'écraser — sinon "3 000,00 €"
 *  était lu 300000 (×100). Le point est lu comme séparateur de milliers quand
 *  il y a aussi une virgule ("1.234,50") ou qu'il est suivi de 3 chiffres
 *  ("5.000 €" → 5000) ; sinon comme décimale ("1234.5"). */
function readNumber(raw: string): number {
  let s = raw.replace(/[^0-9.,-]/g, "");
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

/** Les nombres d'une saisie, avec leur suffixe k/K (×1000) ou M (×1 000 000).
 *  Les espaces entre groupes de 3 chiffres sont des séparateurs de milliers
 *  ("3 000 €" = UN nombre) ; tout le reste sépare deux nombres ("2 x 500 €"). */
function amountTokens(s: string): number[] {
  const joined = s.replace(/(\d)\s+(?=\d{3}(?!\d))/g, "$1");
  const out: number[] = [];
  // Suffixe accepté seulement s'il n'est pas le début d'un mot (« 3 mois » ≠ 3 millions).
  for (const m of joined.matchAll(/(-?)(\d[\d.,]*)(?:\s*([kKmM])(?![a-zA-ZÀ-ÿ]))?/g)) {
    const mult = m[3] === "k" || m[3] === "K" ? 1e3 : m[3] === "m" || m[3] === "M" ? 1e6 : 1;
    const n = readNumber(m[2]) * mult;
    out.push(m[1] ? -n : n);
  }
  return out;
}

/**
 * Montant texte → nombre, ou null si la saisie est vide, illisible ou AMBIGUË.
 * Ambiguë = plusieurs nombres (« 800 € x 2 », « 2 x 500 € », « 1 000 + 500 »,
 * « 800 / 1 000 », « 500 et 300 ») : on ne devine pas le calcul, on ne calcule rien.
 * À utiliser partout où un montant faux partirait chez une marque ou un créateur
 * (budget du bilan, cachets du rapport mensuel). « 3k » → 3000, « 1,5k€ » → 1500.
 */
export function parseAmountStrict(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  const tokens = amountTokens(String(x ?? ""));
  if (tokens.length !== 1) return null;
  const n = Math.round(tokens[0] * 100) / 100;
  return Number.isFinite(n) ? n : null;
}

/** Parse un montant texte ("3 000 €", "1 200,50 €", "1.234,50", "1234.5", "3k", "1,5 M€")
 *  en nombre ; 0 si vide ou illisible. Saisie à plusieurs nombres : ancien comportement
 *  conservé pour les écrans existants (chiffres collés) ; pour un calcul qui part chez
 *  une marque, utiliser parseAmountStrict. */
export function parseAmount(x: unknown): number {
  if (typeof x === "number") return Number.isFinite(x) ? x : 0;
  const strict = parseAmountStrict(x);
  if (strict !== null) return strict;
  return readNumber(String(x ?? "").replace(/\s/g, ""));
}

/** Formate un nombre en "3 000 €" (normalise l'espace insécable des milliers). */
export function formatEuro(n: number): string {
  return n.toLocaleString("fr-FR").replace(/ /g, " ") + " €";
}
