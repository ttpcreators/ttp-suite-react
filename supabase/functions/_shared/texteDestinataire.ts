/**
 * Ce qui part chez un destinataire ne contient que le message (demande de Marc, 2026-11-13) :
 * pas de note pour Marc (« À VÉRIFIER », « Note pour Marc », « Voici le message : »), pas de
 * « [prénom] » à compléter. Sinon le destinataire comprendrait que le texte vient d'une IA.
 * Même règles que agents/alfred/texte.mjs (le test le vérifie). Logique pure, testée.
 */

const NOTE = /^\s*[(\[*_]*\s*(à vérifier|a verifier|à compléter|a completer|vigilance\s*:|(note|nb|n\.b\.|remarque|astuce)\s*(pour|à|a)\s+marc|pour marc\b|marc\s*:|stratégie\s*:|strategie\s*:|à adapter|a adapter|alfred\s*:)/i;
const INTRO = /^\s*(voici|ci-dessous|ci dessous|proposition|suggestion|brouillon|texte|message)\b[^\n]{0,60}:\s*$/i;
const TROU = /\[[^\]\n]{1,40}\]/g;

/** Pourquoi ce texte ne peut pas partir tel quel (null s'il est propre). */
export function problemeTexteDestinataire(corps: string): string | null {
  const lignes = String(corps ?? "").replace(/\r\n/g, "\n").split("\n");
  const notes = lignes.filter((l, i) => NOTE.test(l) || (i === 0 && INTRO.test(l))).map((l) => l.trim());
  const trous = [...new Set(lignes.join("\n").match(TROU) ?? [])];
  if (!notes.length && !trous.length) return null;
  const quoi = [
    notes.length ? `des notes pour Marc (« ${notes[0].slice(0, 60)} »)` : "",
    trous.length ? `des trous à compléter (${trous.slice(0, 3).join(", ")})` : "",
  ].filter(Boolean).join(" et ");
  return `Le texte contient ${quoi} : le destinataire verrait que c'est écrit par une IA. Mets seulement le message dans le corps, complète les trous (ou demande l'info à Marc), et garde tes remarques pour ton message à Marc.`;
}
