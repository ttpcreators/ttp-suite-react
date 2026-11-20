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
//   - juste après un indice de crédit (« merci, x, wearing, 📸,
//     ambassador, photo by… »)                                     : poids 3
//   - juste après une simple préposition (« avec, with, by, par »)  : poids 1
//   - hashtag d'un post payé (#aloyoga)                            : poids 1 (2 avec _ ou chiffre)
//   - mot long (9 lettres et plus) qui n'est pas un mot courant    : poids 1
// Un nom n'est gardé que si son poids total (tous posts confondus) atteint 2.
// Un nom de compte Instagram est toujours en minuscules, sans accent ni apostrophe :
// ça élimine déjà la plupart des mots d'une phrase.
//
// Le piège (radar du 2026-11-20) : un mot ordinaire en minuscules (« every »,
// « attention », « signature », « her ») ressemble à un nom de compte, et il existe
// souvent un vrai compte Instagram à ce nom (« every » = un photographe). Trois
// défenses, en plus de la liste STOP :
//   1. les indices faibles (préposition, mot long, hashtag) ne suffisent plus seuls ;
//   2. proseWords : un mot que les légendes écrivent aussi avec une majuscule
//      (« Attention », « Every ») est un mot de la langue, pas un @ : il lui faut un
//      indice fort (@, compte connu, crédit) ;
//   3. brandAccountOk : un compte au nom d'un simple mot n'est une marque que si
//      son nom ou son site porte ce mot, avec au moins 1 000 abonnés ou un site à son nom.
// ============================================================================

// Indices forts : le mot d'après est presque toujours un compte (crédit, remerciement, collab).
const CUE = new Set([
  "merci", "thanks", "thank", "thx", "x", "×", "feat", "ft",
  "ambassador", "ambassadrice", "partner", "partenaire", "photographer", "photographe",
  "📸", "🎥", "📷", "wearing", "styled", "styling", "mua", "collab", "collaboration", "partenariat",
  "narrated", "explorer", "athlete", "athlète", "credit", "credits", "crédit",
]);
// Prépositions : souvent suivies d'un compte (« avec sezane »), mais bien plus souvent
// d'un mot (« with every », « with her », « avec non pas un »). Indice faible.
const PROSE_CUE = new Set(["avec", "with", "by", "par", "chez", "via", "w", "w/", "team", "code", "porte", "shot", "photo", "photos"]);
// « photo by », « makeup par »… : la préposition devient un crédit (indice fort).
const CREDIT_HEAD = new Set([
  "photo", "photos", "photography", "photographed", "shot", "shooting", "narrated", "styled", "styling", "made",
  "designed", "dress", "robe", "makeup", "maquillage", "hair", "coiffure", "look", "tenue", "outfit", "video", "vidéo",
  "film", "filmed", "edited", "edit", "réalisé", "realise", "presented", "powered", "sponsored", "hosted", "produced",
  "music", "musique", "jewelry", "bijoux", "nails", "glam", "mua",
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
  "notamment", "surtout", "vraiment", "egalement", "également", "toujours", "jamais", "ensuite", "enfin", "pourtant",
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
  // Mots des mentions légales de partenariat (« collaboration commerciale », « rémunérée »…).
  "commerciale", "commercial", "commerciales", "remuneree", "remunere", "sponsorisee", "offerte", "offertes",
  "partenaire", "partenaires", "collaborations", "ambassadeur", "affiliation", "affilie", "rendez", "vous",
  // Faux positifs relevés dans le radar le 2026-11-20 (mots courants qui sont aussi un compte
  // Instagram, souvent d'une personne : « every » = un photographe, « attention » = une agence).
  "every", "attention", "important", "adventure", "architecture", "signature", "highlights", "production",
  "landscapes", "statement", "composition", "programme", "challenges", "transformation", "transformed",
  "legendary", "direction", "authentique", "authentic", "memorable", "dimension", "portraits", "remarkable",
  "dedicated", "dedication", "appearance", "apparence", "passion", "mountains", "listening", "everywhere",
  "somewhere", "someone", "anyone", "intention", "environment", "solutions", "habitudes", "people", "animation",
  "spectacular", "nutrition", "progression", "nationale", "craftsmanship", "complement", "individual",
  "indulgent", "minimalist", "minimalism", "membership", "embroidery", "charcuterie", "restaurants", "fleuriste",
  "papeterie", "messagerie", "renouveler", "passer", "ravitaillement", "stimulate", "trouvaille", "compromis",
  "parfaites", "endurance", "resistance", "rotation", "renaissance", "management", "producer", "videography",
  "vibrant", "spiritual", "strangers", "undeniable", "insulation", "instructions", "electronics", "detailing",
  "entrepreneurs", "entourage", "arrangements", "compliments", "courtesy", "chopped", "heater", "helicopter",
  "finishers", "nationwide", "neighborhood", "parachute", "naturel", "croissant", "basketball", "volleyball",
  "dancers", "violinist", "collector", "wildflowers", "overdressed", "sharpness", "nutrients", "dessinateurs",
  "asymmetrical", "reflector", "goodness", "laughter", "wandering", "extreme", "premium", "precious", "history",
  "jardinage", "onctueuse", "croquante", "saupoudre", "assaisonner", "refaire", "bonheur",
  // Mots outils et mots très fréquents (anglais, français) : jamais un nom de compte.
  "her", "him", "his", "she", "they", "them", "we", "us", "me", "our", "its", "was", "were", "are", "been", "but",
  "not", "non", "oui", "yes", "after", "before", "again", "still", "only", "also", "even", "very", "much", "many",
  "some", "any", "each", "other", "another", "such", "same", "own", "back", "down", "out", "off", "up", "way",
  "make", "made", "take", "get", "got", "go", "going", "come", "see", "know", "think", "want", "need", "feel",
  "look", "looks", "loved", "follow", "world", "people", "design", "artist", "artists", "chef", "custom",
  "fresh", "color", "colour", "black", "white", "red", "blue", "green", "yellow", "pink", "gold", "silver",
  "side", "fall", "run", "runs", "race", "ride", "health", "protein", "success", "ultra", "zero", "water",
  "social", "visual", "science", "speed", "route", "hotel", "mini", "rare", "raw", "rich", "sharp", "smooth",
  "strong", "pride", "joy", "grace", "honey", "horse", "toast", "snack", "tips", "views", "human", "humans",
  "frame", "flash", "zoom", "storm", "golf", "gravel", "matcha", "merit", "melted", "precise", "poise", "lit",
  "ease", "humor", "humour", "brush", "plein", "pleins", "papier", "parfois", "dire", "couper", "drole",
  "cannelle", "champignons", "butternut", "aussi", "alors", "donc", "car", "ni", "sans", "sous", "entre",
  "vers", "contre", "chaque", "autre", "autres", "meme", "tres", "trop", "peu", "beaucoup", "rien", "personne",
  "monde", "vie", "temps", "annee", "fois", "merveilleux", "magnifique", "incroyable", "parfait", "parfaite",
  "experience", "aventure", "histoire", "passionne", "creation", "creations", "inspiration", "motivation",
  "community", "communaute", "moments", "memories", "souvenirs", "details", "quality", "qualite",
  "infiniment", "maman", "papa", "mille", "chacun", "chacune", "everybody", "anybody", "nobody",
]);
/** Mot courant (jamais pris pour un nom de compte). */
export const isCommonWord = (u: string) => STOP.has(u.toLowerCase());
// Hashtags qui ne désignent pas une marque.
const GENERIC_TAG = /^(ad|ads|pub|publicite|publicité|sponsor|sponsorise|sponsorisé|sponsored|partenariat|partenariatremunere|partenariatrémunéré|partnership|collab|collaboration|gifted|ambassador|ambassadrice|promo|code|giveaway|concours|reels?|fyp|explore|instagood|photooftheday|love|fitness|running|yoga|gym|sport|mode|fashion|beauty|skincare|makeup|food|travel|ootd|lifestyle|paris|lyon|france|summer|winter)$/i;
const TLD = /\.(com|fr|co|io|net|org|be|ch|uk|de|es|it|shop|store|app)$/;
// Mesures, heures, rangs (« 10km », « 09h30 », « 3rd », « 100g », « 70x100 ») : un chiffre
// leur donnait la forme d'un nom de compte (près de 1 000 lignes du radar le 2026-11-20).
const MEASURE = /^\d+(?:[.,]\d+)?(?:st|nd|rd|th|er|e|eme|h|hr|hrs|min|mins|s|sec|km|k|m|cm|mm|g|kg|mg|ml|cl|l|am|pm|x|j|an|ans|yo|y|d|w|kcal|cal)?\d*$|^\d+x\d+$/;

export type Candidate = { u: string; w: number };

/** Nom fait d'un seul mot, en lettres seulement (« every », « louisvuitton ») : peut être un mot de la langue. */
export const isPlainWord = (u: string) => /^[a-z]+$/.test(u);

/**
 * Mots de la langue d'après les légendes elles-mêmes : un mot écrit au moins `min` fois
 * avec une majuscule (« Attention », « Every », « People ») est un mot ordinaire, pas un
 * nom de compte (un nom de compte est toujours en minuscules ; « Louisvuitton » ne
 * s'écrit jamais). Marche en français, en anglais, en italien… sans dictionnaire.
 */
export function proseWords(captions: Iterable<string>, min = 2): Set<string> {
  const n = new Map<string, number>();
  for (const cap of captions) {
    const seen = new Set<string>();
    for (const m of cap.matchAll(/(?<![\p{L}\p{N}@#._'’])([A-Z][a-z]{2,})(?![\p{L}\p{N}_'’])/gu)) seen.add(m[1].toLowerCase());
    for (const w of seen) n.set(w, (n.get(w) ?? 0) + 1);
  }
  return new Set([...n.entries()].filter(([, c]) => c >= min).map(([w]) => w));
}

/**
 * Comptes probablement cités dans un texte, avec un poids d'indice. `known` = @
 * déjà connus (marques des contacts, du radar…). `paid` = post payé (les hashtags
 * de marque y comptent). `prose` = mots de la langue (voir proseWords) : pour eux,
 * seuls un @, un compte connu ou un indice fort comptent.
 */
export function handleCandidates(caption: string, known: Set<string>, paid = false, prose?: Set<string>): Candidate[] {
  const out = new Map<string, number>();
  const add = (u: string, w: number) => out.set(u, Math.max(out.get(u) ?? 0, w));
  const tokens = [...caption.matchAll(/[@#]?[\p{L}\p{N}._'’×📸🎥📷/:]+/gu)].map((m) => m[0]);
  const low = (t: string | undefined) => (t ?? "").toLowerCase().replace(/[:,.]+$/, "");
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i];
    const prev = low(tokens[i - 1]);
    if (raw.startsWith("@")) {
      const u = raw.slice(1).replace(/[.:]+$/, "").toLowerCase();
      if (/^[a-z0-9._]{2,30}$/.test(u)) add(u, 10);
      continue;
    }
    if (raw.startsWith("#")) {
      const tag = raw.slice(1).replace(/[.:]+$/, "").toLowerCase();
      if (!/^[a-z0-9_]{3,30}$/.test(tag) || GENERIC_TAG.test(tag) || STOP.has(tag) || MEASURE.test(tag)) continue;
      if (known.has(tag)) add(tag, 6);
      else if (paid && !prose?.has(tag)) add(tag, /[_\d]/.test(tag) ? 2 : 1);
      continue;
    }
    const u = raw.replace(/[.:/]+$/, "");
    // Minuscules ASCII seulement (un nom de compte n'a ni majuscule, ni accent, ni apostrophe).
    if (!/^[a-z0-9._]{3,30}$/.test(u) || !/[a-z]/.test(u) || STOP.has(u) || CUE.has(u) || PROSE_CUE.has(u) || WEAK_CUE.has(u) || TLD.test(u) || MEASURE.test(u) || u.startsWith(".") || u.includes("..")) continue;
    const word = isPlainWord(u);
    const strongCue = CUE.has(prev) || (PROSE_CUE.has(prev) && CREDIT_HEAD.has(low(tokens[i - 2])));
    let w = 0;
    if (known.has(u)) w = 6;
    if (!word) w = Math.max(w, 3); // un point, un tiret bas ou un chiffre : forme d'un nom de compte
    if (strongCue) w = Math.max(w, 3);
    if (!w && !prose?.has(u)) {
      // Indices faibles : jamais assez seuls, et jamais pour un mot de la langue.
      if (PROSE_CUE.has(prev) || u.length >= 9) w = 1;
    }
    if (w) add(u, w);
  }
  return [...out.entries()].map(([u, w]) => ({ u, w }));
}

const fold = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
/** Morceaux du site : « https://www.cutis-paris.fr/x » → hôte ["cutisparis", "fr"], chemin ["x"]. */
function siteParts(website: string): { host: string[]; path: string[] } {
  const site = fold(website).replace(/^https?:\/\//, "").replace(/^www\./, "");
  const [host = "", rest = ""] = [site.split(/[/?#]/)[0], site.split(/[/?#]/).slice(1).join("/")];
  const clean = (p: string) => p.replace(/[^a-z0-9]/g, "");
  return { host: host.split(".").map(clean), path: rest.split(/[/?#&=]+/).map(clean).filter(Boolean) };
}

/**
 * Le compte porte-t-il ce nom ? Son nom affiché ou son site contient le @ (ou
 * l'inverse) : « louisvuitton » = « Louis Vuitton », « chanelofficial » = « CHANEL »,
 * « asicstrail » = likeshop.me/asicstrail, « acg » = « All Conditions Gear ».
 * « every » = « leif gann-matzen » (leifgannmatzen.com) : non.
 */
export function ownsName(handle: string, name: string, website = ""): boolean {
  const h = handle.toLowerCase();
  const words = fold(name).split(/[^a-z0-9]+/).filter(Boolean);
  const compact = words.join("");
  if (compact.length >= 3 && (compact.includes(h) || h.includes(compact))) return true;
  if (words.some((w) => w.length >= 4 && h.includes(w))) return true;
  if (words.length >= 3 && words.map((w) => w[0]).join("") === h) return true; // sigle
  const { host, path } = siteParts(website);
  return [...host, ...path].some((p) => p === h || (p.length >= 4 && (p.includes(h) || h.includes(p))));
}

/** Le site du compte est à son nom (cutisparis.fr pour @cutisparis). */
const ownDomain = (handle: string, website = "") => siteParts(website).host[0] === handle.toLowerCase();

/**
 * Un compte lu chez Meta peut-il être gardé comme marque ? Meta ne répond que pour
 * les comptes professionnels (business ou créateur) et ne donne ni le type ni la
 * catégorie : pour un @ fait d'un simple mot, on exige en plus que le compte porte
 * ce nom, et qu'il ait au moins 1 000 abonnés ou un site à son nom (un mot courant
 * est souvent le @ d'une personne ou d'une petite page).
 */
export function brandAccountOk(handle: string, p: { name: string; website?: string; followers: number }): boolean {
  const h = handle.toLowerCase();
  if (!isPlainWord(h)) return true;
  if (STOP.has(h)) return false;
  if (!ownsName(h, p.name, p.website ?? "")) return false;
  return p.followers >= 1000 || ownDomain(h, p.website ?? "");
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
