// ============================================================================
// _shared/mentions.ts : retrouver les comptes cités dans le texte d'un post.
// ----------------------------------------------------------------------------
// Meta RETIRE les @ des textes renvoyés par l'outil officiel (vérifié le
// 2026-10-14 avec un compte administrateur : « Narrated by @auliicravalho »
// arrive « Narrated by auliicravalho »). On repère donc les noms de compte sans
// le @, avec des indices, puis la fonction vérifie chaque nom auprès de Meta :
//   - un vrai @ (si Meta le laisse un jour)                       : poids 10
//   - un compte déjà connu (contacts, radar, profils lus)          : poids 6
//   - un point, un tiret bas ou un chiffre dans le mot             : poids 3
//   - juste après « avec, by, x, merci, chez, photo, wearing… »    : poids 3
//   - hashtag d'un post payé (#aloyoga)                            : poids 2
//   - mot long (9 lettres et plus) qui n'est pas un mot courant    : poids 1
// Un nom n'est gardé que si son poids total (tous posts confondus) atteint 2.
// Un nom de compte Instagram est toujours en minuscules, sans accent ni apostrophe :
// ça élimine déjà la plupart des mots d'une phrase.
// ============================================================================

const CUE = new Set([
  "avec", "with", "by", "par", "chez", "merci", "thanks", "thank", "thx", "x", "×", "feat", "ft", "via",
  "ambassador", "ambassadrice", "partner", "partenaire", "team", "photo", "photos", "photographer", "photographe",
  "📸", "🎥", "📷", "wearing", "porte", "shot", "styled", "styling", "mua", "collab", "collaboration", "partenariat",
  "code", "narrated", "explorer", "athlete", "athlète", "w", "w/", "credit", "credits", "crédit",
]);
// Mots qui ne sont jamais un nom de compte (et ne comptent pas comme indice).
const WEAK_CUE = new Set(["for", "pour", "on", "sur", "from", "de", "du", "tenue", "outfit", "look", "dress", "robe", "makeup", "hair"]);
const STOP = new Set([
  "the", "and", "you", "your", "for", "with", "this", "that", "these", "those", "les", "des", "une", "mon", "ton", "son",
  "mes", "tes", "ses", "nos", "vos", "leur", "leurs", "avec", "pour", "dans", "sur", "par", "plus", "tout", "tous",
  "toute", "toutes", "bien", "mais", "comme", "nous", "vous", "elle", "elles", "ils", "sont", "est", "avoir", "faire",
  "fait", "cette", "ces", "qui", "que", "quoi", "quand", "aussi", "encore", "jour", "jours", "semaine", "mois", "today",
  "day", "days", "week", "year", "love", "new", "now", "all", "our", "their", "more", "most", "just", "from", "about",
  "into", "over", "here", "there", "what", "when", "where", "how", "why", "who", "one", "two", "three", "first", "last",
  "time", "moment", "photo", "photos", "video", "videos", "post", "story", "stories", "reel", "reels", "link", "bio",
  "lien", "code", "promo", "shop", "collab", "collection", "sport", "running", "fitness", "yoga", "gym", "workout",
  "training", "routine", "morning", "night", "weekend", "summer", "winter", "spring", "autumn", "paris", "lyon",
  "france", "beauty", "makeup", "skincare", "fashion", "style", "outfit", "look", "food", "travel", "life", "family",
  "friends", "home", "merci", "thanks", "thank", "amazing", "beautiful", "happy", "best", "good", "great", "nice",
  "cute", "little", "big", "small", "next", "partenariat", "sponsored", "sponsorise", "publicite", "offert", "gifted",
  "ambassador", "ambassadrice", "official", "officiel", "launch", "lancement", "nouveau", "nouvelle", "new", "edition",
  "series", "episode", "streaming", "premiering", "presented", "partnership", "initiative", "expedition", "planet",
  "everyone", "something", "nothing", "everything", "together", "tomorrow", "yesterday", "tonight", "always", "never",
  "really", "because", "pourquoi", "toujours", "jamais", "vraiment", "ensemble", "demain", "hier", "maintenant",
  "dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "sunday", "monday", "tuesday", "wednesday",
  "thursday", "friday", "saturday", "instagram", "tiktok", "youtube", "facebook", "website", "available", "disponible",
  "ad", "ads", "pub", "the", "a", "an", "of", "in", "to", "is", "it", "at", "be", "as", "or", "if", "so", "do", "my",
  // Mots courants qui sont AUSSI des comptes de marque (@notre…) : jamais pris pour un compte.
  "notre", "votre", "cette", "chose", "petit", "petite", "grand", "grande", "jolie", "belle", "super", "depuis",
  "pendant", "avant", "apres", "maison", "boutique", "atelier", "studio", "mariage", "wedding", "voyage", "recette",
  "conseil", "conseils", "astuce", "astuces", "cadeau", "cadeaux", "noel", "christmas", "rentree", "soldes", "sale",
  "basics", "basic", "classic", "essentials", "natural", "nature", "organic", "vintage", "local", "simple", "minimal",
]);
/** Mot courant (jamais pris pour un nom de compte). */
export const isCommonWord = (u: string) => STOP.has(u.toLowerCase());
// Hashtags qui ne désignent pas une marque.
const GENERIC_TAG = /^(ad|ads|pub|publicite|publicité|sponsor|sponsorise|sponsorisé|sponsored|partenariat|partenariatremunere|partenariatrémunéré|partnership|collab|collaboration|gifted|ambassador|ambassadrice|promo|code|giveaway|concours|reels?|fyp|explore|instagood|photooftheday|love|fitness|running|yoga|gym|sport|mode|fashion|beauty|skincare|makeup|food|travel|ootd|lifestyle|paris|lyon|france|summer|winter)$/i;
const TLD = /\.(com|fr|co|io|net|org|be|ch|uk|de|es|it|shop|store|app)$/;

export type Candidate = { u: string; w: number };

/**
 * Comptes probablement cités dans un texte, avec un poids d'indice. `known` = @
 * déjà connus (marques des contacts, du radar…). `paid` = post payé (les hashtags
 * de marque y comptent).
 */
export function handleCandidates(caption: string, known: Set<string>, paid = false): Candidate[] {
  const out = new Map<string, number>();
  const add = (u: string, w: number) => out.set(u, Math.max(out.get(u) ?? 0, w));
  const tokens = [...caption.matchAll(/[@#]?[\p{L}\p{N}._'’×📸🎥📷/:]+/gu)].map((m) => m[0]);
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i];
    const prev = (tokens[i - 1] ?? "").toLowerCase().replace(/[:,.]+$/, "");
    if (raw.startsWith("@")) {
      const u = raw.slice(1).replace(/[.:]+$/, "").toLowerCase();
      if (/^[a-z0-9._]{2,30}$/.test(u)) add(u, 10);
      continue;
    }
    if (raw.startsWith("#")) {
      const tag = raw.slice(1).replace(/[.:]+$/, "").toLowerCase();
      if (!/^[a-z0-9_]{3,30}$/.test(tag) || GENERIC_TAG.test(tag) || STOP.has(tag)) continue;
      if (known.has(tag)) add(tag, 6);
      else if (paid) add(tag, 2);
      continue;
    }
    const u = raw.replace(/[.:/]+$/, "");
    // Minuscules ASCII seulement (un nom de compte n'a ni majuscule, ni accent, ni apostrophe).
    if (!/^[a-z0-9._]{3,30}$/.test(u) || !/[a-z]/.test(u) || STOP.has(u) || CUE.has(u) || WEAK_CUE.has(u) || TLD.test(u) || u.startsWith(".") || u.includes("..")) continue;
    let w = 0;
    if (known.has(u)) w = 6;
    if (/[._\d]/.test(u)) w = Math.max(w, 3);
    if (CUE.has(prev)) w = Math.max(w, 3);
    if (!w && u.length >= 9) w = 1;
    if (w) add(u, w);
  }
  return [...out.entries()].map(([u, w]) => ({ u, w }));
}

/** Le texte cite-t-il ce compte (avec ou sans @, comme mot entier) ? */
export function citesHandle(caption: string, handle: string): boolean {
  const text = caption.toLowerCase();
  const h = handle.toLowerCase();
  let i = text.indexOf(h);
  while (i !== -1) {
    const before = text[i - 1] ?? " ";
    const after = text[i + h.length] ?? " ";
    if (!/[a-z0-9._]/.test(before) && !/[a-z0-9_]/.test(after) && !(after === "." && /[a-z0-9]/.test(text[i + h.length + 1] ?? ""))) return true;
    i = text.indexOf(h, i + 1);
  }
  return false;
}
