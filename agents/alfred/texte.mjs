// ============================================================================
// texte.mjs : ce qui part chez quelqu'un d'autre que Marc ne contient QUE le message.
// Demande de Marc (2026-11-13) : dans un texte à copier (WhatsApp, DM, mail), aucune note qui lui
// est destinée (« À VÉRIFIER », « Note pour Marc », « Voici le message : », un « [prénom] » à
// compléter) : le destinataire comprendrait que le texte vient d'une IA. Même règle côté
// connecteur pour les brouillons Gmail (supabase/functions/_shared/texteDestinataire.ts).
// ============================================================================

/** Une ligne qui s'adresse à Marc et non au destinataire. */
const NOTE = /^\s*[(\[*_]*\s*(à vérifier|a verifier|à compléter|a completer|vigilance\s*:|(note|nb|n\.b\.|remarque|astuce)\s*(pour|à|a)\s+marc|pour marc\b|marc\s*:|stratégie\s*:|strategie\s*:|à adapter|a adapter|alfred\s*:)/i;
/** Une introduction pour Marc en tête du texte (« Voici le message : », « Proposition : »). */
const INTRO = /^\s*(voici|ci-dessous|ci dessous|proposition|suggestion|brouillon|texte|message)\b[^\n]{0,60}:\s*$/i;
/** Un trou à compléter : « [prénom] », « [date] », « [MONTANT] ». */
const TROU = /\[[^\]\n]{1,40}\]/g;

/**
 * Sépare le texte à envoyer des notes pour Marc. Renvoie `texte` (seulement le message),
 * `notes` (les lignes pour Marc, à montrer à part) et `trous` (les « [ … ] » à compléter).
 */
export function separerNotes(brut) {
  const lignes = String(brut ?? "").replace(/\r\n/g, "\n").split("\n");
  const garde = [];
  const notes = [];
  lignes.forEach((l, i) => {
    if (NOTE.test(l) || (i === 0 && INTRO.test(l))) notes.push(l.trim());
    else garde.push(l);
  });
  const texte = garde.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { texte, notes: notes.filter(Boolean), trous: [...new Set(texte.match(TROU) ?? [])] };
}
