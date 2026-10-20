/**
 * Catégories du Scouting : listes prêtes à cliquer, et niche DEVINÉE quand rien n'est
 * saisi, à partir de ce qu'Instagram donne (bio, nom, légendes des 12 derniers posts).
 * Mots-clés français et anglais, sans accents ; la catégorie qui en cite le plus gagne.
 * Rien de trouvé (ou égalité trop faible) : null, la fiche reste sans catégorie.
 */

type Niche = { label: string; words: string[] };

export const CREATOR_NICHES: Niche[] = [
  { label: "Mode", words: ["mode", "fashion", "outfit", "ootd", "look", "style", "styling", "dressing", "vintage", "streetwear", "zara", "shein"] },
  { label: "Beauté", words: ["beaute", "beauty", "makeup", "maquillage", "skincare", "soin", "soins", "cosmetique", "glow", "nails", "ongles", "cheveux", "hair", "parfum"] },
  { label: "Lifestyle", words: ["lifestyle", "daily", "vlog", "quotidien", "routine", "life", "vie", "dayinmylife"] },
  { label: "Fitness", words: ["fitness", "gym", "workout", "musculation", "training", "entrainement", "coach", "pilates", "yoga", "fit", "crossfit", "running", "run"] },
  { label: "Food", words: ["food", "recette", "recettes", "recipe", "cuisine", "cooking", "foodie", "patisserie", "restaurant", "healthy", "brunch", "chef"] },
  { label: "Voyage", words: ["voyage", "travel", "traveler", "voyager", "trip", "wanderlust", "explore", "roadtrip", "hotel", "destination"] },
  { label: "Famille", words: ["maman", "mum", "mom", "mama", "papa", "dad", "famille", "family", "bebe", "baby", "enfants", "kids", "grossesse", "pregnancy", "parent"] },
  { label: "Humour", words: ["humour", "humor", "comedy", "comedie", "sketch", "drole", "funny", "blague", "memes"] },
  { label: "Tech", words: ["tech", "technologie", "apple", "iphone", "gadget", "geek", "ia", "ai", "setup", "developpeur", "dev"] },
  { label: "Gaming", words: ["gaming", "gamer", "twitch", "streamer", "stream", "jeux", "jeu", "playstation", "xbox", "nintendo", "esport", "fortnite"] },
  { label: "Déco", words: ["deco", "decoration", "interieur", "interior", "home", "maison", "design", "diy", "renovation", "appartement"] },
  { label: "Musique", words: ["musique", "music", "chanteuse", "chanteur", "singer", "artiste", "rap", "dj", "producer", "album", "concert"] },
  { label: "Business", words: ["business", "entrepreneur", "entrepreneuse", "startup", "ceo", "founder", "fondatrice", "fondateur", "marketing", "finance", "argent", "money"] },
  { label: "Sport", words: ["sport", "athlete", "football", "foot", "basket", "tennis", "rugby", "boxe", "mma", "surf", "ski"] },
  { label: "Animaux", words: ["chien", "chat", "dog", "cat", "pet", "animaux", "chiot"] },
  { label: "Auto", words: ["auto", "voiture", "car", "cars", "moto", "supercar", "automobile"] },
];

export const SPORTS: Niche[] = [
  { label: "Football", words: ["football", "foot", "footballeur", "footballeuse", "soccer", "ligue1", "striker", "attaquant", "milieu", "defenseur", "gardien", "goalkeeper"] },
  { label: "Basket", words: ["basket", "basketball", "nba", "wnba", "lnb", "meneur", "hooper", "hoops"] },
  { label: "Tennis", words: ["tennis", "atp", "wta", "padel"] },
  { label: "Rugby", words: ["rugby", "top14", "xv", "pilier", "talonneur", "ailier"] },
  { label: "Boxe", words: ["boxe", "boxing", "boxer", "boxeur", "boxeuse"] },
  { label: "MMA", words: ["mma", "ufc", "pfl", "grappling", "jiujitsu", "jjb", "bjj", "combat", "fighter"] },
  { label: "Athlétisme", words: ["athletisme", "athletics", "sprint", "sprinter", "100m", "marathon", "trail", "running", "hurdles", "saut"] },
  { label: "Natation", words: ["natation", "swimming", "swimmer", "nageur", "nageuse", "piscine"] },
  { label: "Cyclisme", words: ["cyclisme", "cycling", "cyclist", "cycliste", "velo", "bike", "vtt", "triathlon", "triathlete"] },
  { label: "Handball", words: ["handball", "hand", "lidl starligue"] },
  { label: "Musculation", words: ["musculation", "bodybuilding", "bodybuilder", "powerlifting", "ifbb", "gym", "fitness", "crossfit"] },
  { label: "Glisse", words: ["surf", "surfer", "skate", "skateboard", "snowboard", "ski", "skier", "wakeboard", "kitesurf"] },
  { label: "Golf", words: ["golf", "golfer", "golfeur", "golfeuse", "pga"] },
  { label: "Danse", words: ["danse", "dance", "dancer", "danseur", "danseuse", "breakdance", "ballet"] },
];

/** Minuscules, sans accents, mots séparés (« Beauté & Soins » → « beaute soins »). */
const norm = (s: string) =>
  ` ${s.toLocaleLowerCase("fr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9#]+/g, " ").replace(/#/g, " ")} `;

/**
 * Catégorie la plus probable pour ce texte (bio + nom + légendes), ou null. Il faut au
 * moins 2 mentions, et nettement plus que la 2e catégorie, pour ne pas inventer.
 */
export function guessNiche(text: string, list: Niche[] = CREATOR_NICHES): string | null {
  const t = norm(text);
  if (t.trim().length < 3) return null;
  const scores = list
    .map((n) => ({ label: n.label, score: n.words.reduce((sum, w) => sum + (t.split(` ${w} `).length - 1), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const [best, second] = scores;
  if (!best || best.score < 2) return null;
  if (second && best.score - second.score < 1) return null;
  return best.label;
}

/** Mots qui désignent à eux seuls un sportif (métier, compétition, statut), sans accents. */
const ATHLETE_WORDS = [
  "athlete", "athletes", "sportif", "sportive", "sportifs", "joueur", "joueuse", "player",
  "footballeur", "footballeuse", "basketteur", "basketteuse", "rugbyman", "boxeur", "boxeuse", "nageur", "nageuse",
  "cycliste", "golfeur", "golfeuse", "danseur", "danseuse", "fighter", "olympian", "olympique", "olympiques", "jo",
  "champion", "championne", "international", "internationale", "pro", "professionnel", "professionnelle",
  "nba", "wnba", "atp", "wta", "ufc", "pfl", "top14", "ligue1", "ligue2", "premierleague", "liga", "seriea",
];

/**
 * Sportif ou non (Sourcing → Scouting) : un seul mot de métier ou de compétition suffit
 * (« Footballeur au PSG », « Joueuse WNBA »), contrairement à guessNiche qui en veut
 * deux. Renvoie le sport le plus probable, « Sport » si le sport précis est inconnu,
 * ou null si rien n'indique un sportif.
 */
export function guessSport(text: string): string | null {
  const t = norm(text);
  if (t.trim().length < 2) return null;
  const has = (w: string) => t.includes(` ${w} `);
  const strong = ATHLETE_WORDS.some(has) || /\bequipe de france\b|\bteam france\b/.test(t);
  const scores = SPORTS
    .map((n) => ({ label: n.label, score: n.words.reduce((sum, w) => sum + (t.split(` ${w} `).length - 1), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = scores[0];
  if (best && (strong || best.score >= 2)) return best.label;
  return strong ? "Sport" : null;
}
