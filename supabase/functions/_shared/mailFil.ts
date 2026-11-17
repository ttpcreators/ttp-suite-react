// ============================================================================
// _shared/mailFil.ts : lire un long fil de mails sans perdre la fin.
// ----------------------------------------------------------------------------
// Cas Prison Island (17 novembre 2026) : un fil long, lu du plus ancien au plus récent
// avec un budget fixe, perdait ses DERNIERS messages (« bien reçu la facture »), et Alfred
// a préparé un doublon. Deux règles :
//   1. Les citations (« Le … a écrit : », « > … », « De : … Envoyé : ») sont retirées :
//      chaque message les répète, elles mangent le budget.
//   2. Le budget va d'abord aux messages les plus RÉCENTS ; les anciens sont raccourcis,
//      mais aucun n'est sauté (expéditeur et date toujours là).
// ============================================================================

const DEBUTS_CITATION = [
  /^\s*(le|on)\s.{3,200}\s(a écrit|wrote)\s*:\s*$/i,
  /^\s*-{2,}\s*(original message|message d'origine|forwarded message|message transféré)\s*-{2,}/i,
  /^\s*(de|from)\s*:\s.+$/i, // suivi de « Envoyé : » / « Sent: » juste après
  /^\s*_{10,}\s*$/,
];

/** Le texte du message sans la partie citée (les messages précédents recopiés). */
export function sansCitation(texte: string): string {
  const lignes = String(texte ?? "").split(/\r?\n/);
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i];
    if (i > 0 && DEBUTS_CITATION[0].test(l)) return garder(lignes, i);
    if (i > 0 && DEBUTS_CITATION[1].test(l)) return garder(lignes, i);
    if (i > 0 && DEBUTS_CITATION[2].test(l) && /^\s*(envoyé|sent|date)\s*:/i.test(lignes[i + 1] ?? "")) return garder(lignes, i);
    if (i > 0 && DEBUTS_CITATION[3].test(l) && /^\s*(de|from)\s*:/i.test(lignes[i + 1] ?? "")) return garder(lignes, i);
  }
  // Citations « > » : on enlève les lignes citées.
  return lignes.filter((l) => !/^\s*>/.test(l)).join("\n").trim();
}

function garder(lignes: string[], fin: number): string {
  const t = lignes.slice(0, fin).filter((l) => !/^\s*>/.test(l)).join("\n").trim();
  return t ? `${t}\n[citation des messages précédents retirée]` : lignes.join("\n").trim();
}

/**
 * Combien de caractères donner à chaque message (dans l'ordre du fil), du plus récent au plus
 * ancien : 8 000 au plus par message, 40 000 en tout, et au moins 400 pour chaque ancien message.
 */
export function partsDuBudget(longueurs: number[], total = 40_000, parMessage = 8_000, minimum = 400): number[] {
  const parts = longueurs.map(() => 0);
  let reste = total;
  for (let i = longueurs.length - 1; i >= 0; i--) {
    const anciensApres = i; // messages plus anciens encore à servir
    const reserve = anciensApres * minimum;
    const part = Math.min(longueurs[i], parMessage, Math.max(minimum, reste - reserve));
    parts[i] = Math.max(0, part);
    reste -= parts[i];
  }
  return parts;
}
