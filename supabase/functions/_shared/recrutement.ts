// ============================================================================
// _shared/recrutement.ts : un compte de la Base créateurs est-il un bon créateur à recruter ?
// ----------------------------------------------------------------------------
// Audit du 24 novembre 2026 (point M14). Parmi les comptes à plus de 100 000 abonnés « sans
// agence », la Base mélange des marques mal classées (Vinted, Dyson Beauty, La Redoute), des
// médias, des lieux, des célébrités étrangères et des comptes gérés par un manager. Pour la
// prospection de créateurs, on ne garde que les comptes qui :
//   - parlent français (bio, drapeau, ville française, site ou adresse en .fr) ;
//   - ne ressemblent ni à une marque, ni à un média, ni à un lieu, ni à un artiste en tournée ;
//   - n'ont pas une adresse de contact d'agence ou de manager ;
//   - restent sous 2 millions d'abonnés (au-delà : célébrités, rarement accessibles).
// Un compte dont rien ne dit la langue (bio courte en anglais, sportif) n'est pas écarté :
// il est montré à part, « langue à vérifier » (fonction langueAVerifier).
// Rien n'est retiré de la Base : c'est un filtre de plus (option `pour_recruter` de l'outil
// base_createurs). Règles PURES, testées par recrutement.test.ts.
// ============================================================================

export type ProfilBase = { name?: string; bio?: string; website?: string; email?: string; followers?: number; agency?: string | null };

/** Abonnés au-delà desquels un compte est rarement recrutable (célébrités, médias). */
export const MAX_ABONNES_RECRUTEMENT = 2_000_000;

const plat = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Mots courants du français, absents (ou presque) de l'anglais et des autres langues voisines.
const MOTS_FR = new Set([
  "je", "tu", "mon", "ma", "mes", "ton", "ta", "tes", "nous", "vous", "les", "des", "du", "une", "et", "pour", "avec", "chez", "dans", "sur",
  "est", "suis", "c", "qui", "que", "pas", "plus", "tout", "toute", "tous", "mais", "aussi", "aux", "au", "cuisine", "recettes", "recette",
  "maman", "papa", "voyages", "deco", "bonne", "humeur", "ici", "vie", "partage", "conseils", "decouvrir", "livre", "livres", "autrice", "auteur",
]);
// Mots de l'anglais courant (pour reconnaître une bio clairement étrangère).
const MOTS_AUTRES = new Set([
  "the", "and", "your", "you", "my", "for", "with", "our", "we", "of", "to", "is", "in", "life", "mom", "wife", "based", "love", "daily",
  "open", "worldwide", "creating", "und", "die", "der", "mit", "ich", "el", "los", "las", "para", "con", "di", "della", "il", "per", "na", "w", "z",
]);
const VILLES_FR = /\b(paris|lyon|marseille|toulouse|nice|nantes|montpellier|strasbourg|bordeaux|lille|rennes|reims|toulon|grenoble|dijon|angers|nimes|annecy|biarritz|cannes|rouen|tours|metz|brest|caen|perpignan|ajaccio|clermont|saint[- ]etienne|albi|la rochelle|avignon|aix|bruxelles|geneve|lausanne|montreal|liege|namur)\b/;

/** Le compte parle-t-il français ? true, false, ou null (rien pour le dire). */
export function parleFrancais(p: ProfilBase): boolean | null {
  const bio = String(p.bio ?? "");
  const t = plat(`${p.name ?? ""} ${bio}`);
  if (/🇫🇷|🇧🇪|🇨🇭|🇨🇦|🇲🇨/.test(bio)) return true;
  if (/\.fr(\/|$|\b)/.test(plat(`${p.website ?? ""} ${p.email ?? ""}`))) return true;
  const mots = t.split(/[^a-z']+/).flatMap((m) => m.split("'")).filter(Boolean);
  const fr = new Set(mots.filter((m) => MOTS_FR.has(m))).size;
  const autres = new Set(mots.filter((m) => MOTS_AUTRES.has(m))).size;
  if (fr >= 2 && fr >= autres) return true;
  if (VILLES_FR.test(t) && autres < 3) return true;
  if (autres >= 2 || /[Ѐ-ӿ؀-ۿ֐-׿぀-ヿ一-鿿가-힯฀-๿]/.test(bio)) return false;
  return fr >= 1 ? true : null;
}

// Un compte de marque, de média, de lieu ou d'événement, pas une personne.
const MARQUE = new RegExp([
  "\\bofficiel\\b", "\\bofficial\\b", "\\boficial\\b", "\\bb ?corp\\b", "certified", "certifiee? b", "shipping", "livraison", "\\bshop(s|ping)?\\b", "\\bstore\\b", "boutique", "magasin",
  "to be featured", "taguez", "tag us", "tag @", "#1\\b", "\\bn°1\\b", "download", "telechargez", "\\bapp\\b", "l'appli", "\\bmagazine\\b", "\\bmedia\\b", "le media",
  "since 1[89]\\d\\d", "depuis 1[89]\\d\\d", "founded in", "family[- ]owned", "\\bour (new )?collection\\b", "nouvelle collection", "new collection", "fashion brand", "\\bbrand\\b",
  "concours", "electromenager", "\\bcinemas?\\b", "surgeles", "open daily", "ouvert (tous|7)", "reservations?", "\\bmenu\\b", "\\bcommunity\\b", "\\bcommunaute\\b", "\\bmarathon\\b", "\\bfestival\\b", "world series", "\\bgalerie\\b", "\\bgallery\\b",
].join("|"));
const MARQUE_NOM = /\b(officiel|official|france|italia|espana|global|magazine|shop|store|group|agency|agence|cinemas?)\b/;
// Artiste, acteur ou personnalité déjà gérés ailleurs (album, tournée, rôle).
const ARTISTE = /\b(nouvel album|new album|album|tournee|tour (20\d\d|dates)|on tour|actor|actress|acteur|actrice|\bdj\b|records|label|bookings?)\b/;
// Adresse de contact d'agence ou de manager.
const AGENCE_EMAIL = /(mgmt|management|managment|talents?|agency|agence|booking|prtnrs|partners|pr@|press@|presse@|representation)/;

/**
 * Raison d'écarter ce compte de la prospection de créateurs, ou null s'il est recrutable.
 * `username` sert aussi : « dysonbeauty », « decathlon_italia ».
 */
export function raisonPasRecrutable(username: string, p: ProfilBase): string | null {
  const nom = plat(`${p.name ?? ""} ${username.replace(/[._]/g, " ")}`);
  const bio = plat(String(p.bio ?? ""));
  const email = plat(String(p.email ?? ""));
  if ((p.followers ?? 0) > MAX_ABONNES_RECRUTEMENT) return "plus de 2 millions d'abonnés";
  if (MARQUE.test(bio) || MARQUE_NOM.test(nom)) return "ressemble à une marque, un média ou un lieu";
  // Un seul mot pour nom, le même que le @, repris dans la bio (« Tout commence au Printemps »).
  const motNom = plat(String(p.name ?? "")).replace(/[^a-z0-9]+/g, " ").trim();
  if (motNom.length >= 4 && !motNom.includes(" ") && motNom === plat(username).replace(/[^a-z0-9]+/g, "") && new RegExp(`\\b${motNom}\\b`).test(bio)) {
    return "ressemble à une marque, un média ou un lieu";
  }
  if (ARTISTE.test(bio)) return "artiste ou personnalité (album, tournée, rôle)";
  if (email && AGENCE_EMAIL.test(email)) return "adresse de contact d'une agence ou d'un manager";
  // Bio qui cite un agent, un manager ou une agence (25/11 : 2 créatrices sur 8 déjà en agence).
  if (/\b(management|mgmt|represented by|represente par|agence|agency|manager|managed by|gere(e)? par|agent|booking|bookings|talents?)\b/.test(bio)) return "déjà représenté (agence ou manager cité dans la bio)";
  if (/@[a-z0-9._]*(agency|agence|talent|mgmt|management|booking|prtnrs)[a-z0-9._]*/.test(bio)) return "déjà représenté (compte d'agence cité dans la bio)";
  const fr = parleFrancais(p);
  if (fr === false) return "ne publie pas en français";
  return null;
}

/** Rien ne dit la langue du compte : à regarder avant de lui écrire. */
export const langueAVerifier = (p: ProfilBase): boolean => parleFrancais(p) === null;
