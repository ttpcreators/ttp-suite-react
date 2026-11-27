// ============================================================================
// _shared/texteSur.ts : des textes que Postgres accepte toujours.
// ----------------------------------------------------------------------------
// Postgres refuse deux choses dans un texte ou un jsonb :
//   - le caractère nul (U+0000), fréquent dans les pages web, les PDF et certains mails ;
//   - une moitié d'emoji orpheline. Un emoji tient sur deux unités UTF-16 (une moitié
//     haute puis une moitié basse) : une coupe avec slice() peut tomber entre les deux, et
//     Postgres répond « Unicode low surrogate must follow a high surrogate ». Toute
//     l'écriture est alors refusée (radar des marques : paquets de 200 perdus, 27/11/2026).
// texteSur retire l'un et l'autre ; couper coupe sans jamais séparer un emoji, puis
// nettoie ; str lit un texte reçu par un outil du connecteur Claude.
// Sans dépendance : partagé par les fonctions et par l'app. Testé par texteSur.test.ts.
// ============================================================================

const estHaut = (c: number) => c >= 0xd800 && c <= 0xdbff; // première moitié d'un emoji
const estBas = (c: number) => c >= 0xdc00 && c <= 0xdfff; // seconde moitié

/** Le texte sans caractère nul ni moitié d'emoji orpheline. Rien d'autre ne change. */
export function texteSur(s: string): string {
  let out = "";
  let debut = 0; // début du morceau propre pas encore recopié dans out
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (estHaut(c) && estBas(s.charCodeAt(i + 1))) {
      i++; // emoji entier : gardé
      continue;
    }
    if (c === 0 || estHaut(c) || estBas(c)) {
      // caractère nul ou moitié orpheline : retiré
      out += s.slice(debut, i);
      debut = i + 1;
    }
  }
  return debut === 0 ? s : out + s.slice(debut);
}

/**
 * Coupe à `max` unités au plus (comme slice(0, max)) sans jamais séparer les deux moitiés
 * d'un emoji, puis nettoie (texteSur). Un texte déjà assez court ressort identique, au
 * caractère nul et aux moitiés orphelines près. `max` négatif : texte vide.
 */
export function couper(s: string, max: number): string {
  if (s.length <= max) return texteSur(s);
  let fin = Math.max(0, Math.floor(max));
  // La coupe tombe entre les deux moitiés d'un emoji : on la recule d'une unité.
  if (fin > 0 && estHaut(s.charCodeAt(fin - 1)) && estBas(s.charCodeAt(fin))) fin--;
  return texteSur(s.slice(0, fin));
}

/**
 * Texte reçu d'un outil du connecteur Claude (envoyé par Claude ou Alfred) : sans espaces
 * autour, coupé à `max` (couper), "" si ce n'est pas un texte. Seule définition, partagée par
 * ttp-mcp (tools, admin, envois, prospection, autonomie) et _shared/verrouAgent.ts : une
 * lecture différente d'un fichier à l'autre ouvrirait une porte au verrou des agents.
 */
export const str = (v: unknown, max = 500): string => (typeof v === "string" ? couper(v.trim(), max) : "");
