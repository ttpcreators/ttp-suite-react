// ============================================================================
// _shared/contactTags.ts : la liste FERMÉE des catégories d'un contact (colonne
// contacts.tag). Règles PURES, testées par contactTags.test.ts ; lues par la page
// Contacts (formulaire, import CSV) et par l'outil Claude ajouter_contact.
//
// Une valeur inconnue est rapprochée d'une catégorie (« presse » → Média, « RP » →
// Agence RP), sinon elle devient « Autre ». Les anciens tags libres déjà en base ne sont
// pas réécrits : ils restent affichés tels quels.
// ============================================================================

/** Catégories proposées dans le formulaire de l'agence (ordre d'affichage). */
export const CONTACT_TAGS = ["Marque", "Agence", "Agence RP", "Média", "PME", "Freelance", "Autre"] as const;
export type ContactTag = (typeof CONTACT_TAGS)[number];

/** Contact ajouté par un créateur depuis son espace. */
export const TAG_PERSO = "Perso";
/** Demande reçue par le site (fonctions site-lead et rdv, qui comptent ces contacts). */
export const TAG_LEAD_SITE = "Lead site";
/** Catégories posées par l'app elle-même : acceptées, jamais proposées au choix. */
export const SYSTEM_TAGS = [TAG_PERSO, TAG_LEAD_SITE] as const;

const fold = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Rapprochements, dans l'ordre (« agence de relations presse » est une Agence RP, pas un Média).
const SYNONYMES: [string, RegExp][] = [
  ["Agence RP", /\b(rp|pr|relations? (presse|publiques?)|attachee?s? de presse|bureau de presse)\b/],
  ["Agence", /\b(agences?|agency|agencies|talent|influence|regie|management|manager)\b/],
  ["Média", /\b(medias?|presse|press|journal|journaliste|magazine|mag|redaction|podcast|tv|radio|blog|newsletter)\b/],
  ["Marque", /\b(marques?|brand|brands|annonceur|e ?shop|ecommerce|e commerce|enseigne)\b/],
  ["PME", /\b(pme|tpe|startup|start up|entreprise|societe|commerce|boutique|restaurant|salle|club)\b/],
  ["Freelance", /\b(freelances?|freelancer|independante?s?|auto entrepreneur|consultante?s?)\b/],
  ["Perso", /\b(perso|personnel|personnelle|amie?s?|famille)\b/],
];

/** Valeur exacte de la liste (sans tenir compte des majuscules ni des accents), sinon null. */
export function tagConnu(raw: unknown): string | null {
  const f = fold(String(raw ?? ""));
  if (!f) return null;
  return [...CONTACT_TAGS, ...SYSTEM_TAGS].find((t) => fold(t) === f) ?? null;
}

/**
 * Catégorie saisie (formulaire, CSV, Claude) → une valeur de la liste fermée :
 * la valeur exacte, sinon un rapprochement, sinon « Autre ». Vide → `vide`.
 */
export function normaliserTag(raw: unknown, vide = "Autre"): string {
  const s = String(raw ?? "").trim();
  if (!s) return vide;
  const exact = tagConnu(s);
  if (exact) return exact;
  const f = fold(s);
  return SYNONYMES.find(([, re]) => re.test(f))?.[0] ?? "Autre";
}

/** Tag déjà en base hors de la liste (ancien texte libre) : affiché tel quel, signalé à l'édition. */
export function tagHorsListe(raw: unknown): boolean {
  const s = String(raw ?? "").trim();
  return !!s && !tagConnu(s);
}
