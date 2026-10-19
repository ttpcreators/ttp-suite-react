/**
 * Durée de contrat saisie en texte libre (« 12 mois », « 1 an », « 6 semaines »…)
 * → nombre de mois pour l'échéance de fin de contrat. Pur (aucune dépendance) : testé
 * par Vitest. Avant, seul le nombre était lu : « 1 an » devenait 1 mois.
 */

/** Unité → nombre de mois (semaine ≈ 1/4 de mois, jour ≈ 1/30). */
const UNITS: [RegExp, number][] = [
  [/^(ans?|ann[ée]es?|years?)$/, 12],
  [/^(mois|months?)$/, 1],
  [/^(semaines?|sem|weeks?)$/, 1 / 4],
  [/^(jours?|j|days?)$/, 1 / 30],
];

/** Texte → mois (arrondi, au moins 1), ou null si vide / non compris (« illimitée », « 3 h »…).
 *  Un nombre sans unité vaut des mois (comportement historique). Les morceaux s'additionnent :
 *  « 1 an et 6 mois » → 18. */
export function durationToMonths(text: unknown): number | null {
  const t = String(text ?? "").trim().toLowerCase();
  let total = 0;
  let found = false;
  for (const m of t.matchAll(/(\d+(?:[.,]\d+)?)\s*(\p{L}*)/gu)) {
    const n = parseFloat(m[1].replace(",", "."));
    const unit = m[2];
    const factor = unit ? UNITS.find(([re]) => re.test(unit))?.[1] : 1;
    if (factor === undefined) return null; // unité inconnue : on ne devine pas
    total += n * factor;
    found = true;
  }
  if (!found || !(total > 0)) return null;
  return Math.max(1, Math.round(total));
}
