/**
 * Bios des media kits déjà traduites en anglais (2026-10-07), retrouvées par leur texte
 * français. Sert à pré-remplir le champ « Bio en anglais » de l'éditeur tant qu'il est vide
 * et que la bio française n'a pas changé. MÊME table que BIO_EN dans
 * websitettpcreators/mediakit/_assets/mk-i18n.js (le site s'en sert en repli).
 */
const BIO_EN: Record<string, string> = {
  "chloe est une creatrice fitness lifestyle basee a paris ambassadrice women s best et fashion nova avec une esthetique soignee et une communaute de 226k abonnes ": "Chloé is a Paris-based fitness & lifestyle creator, ambassador for Women's Best and Fashion Nova, with a polished aesthetic and a loyal community of 226K followers.\n\nHer content blends workouts, self-care, food and the Parisian art of living, for a young, aspirational female audience drawn to performance and everyday elegance.",
  "lena est une creatrice de contenu lifestyle beaute et sport qui produit des contenus 100 aesthetic penses pour convertir basee a aubagne elle a deja accompagne ": "Léna is a lifestyle, beauty and fitness creator producing 100% aesthetic content, designed to convert.\n\nBased in Aubagne, in the South of France, she has already worked with more than 50 brands through a native, high-quality UGC approach.",
  "lucie est une creatrice humour lifestyle basee a lyon avec une approche decalee et authentique qui transforme le quotidien en contenu addictif son contenu mele ": "Lucie is a Lyon-based humor & lifestyle creator whose offbeat, authentic approach turns everyday life into addictive content.\n\nHer content blends relatable everyday moments, unapologetic tongue-in-cheek humor and a polished lifestyle aesthetic, for a young female audience who sees herself in it as much as she laughs along.",
  "candice est une creatrice lifestyle blogging basee a paris etudiante a l escp entre voyages culture pop et contenus spontanes elle partage un univers jeune colo": "Candice is a Paris-based lifestyle & blogging creator and a student at ESCP Business School.\n\nBetween travel, pop culture and spontaneous content, she shares a young, colorful, unfiltered world.",
  "pierre est un triathlete amateur qui partage sa preparation ses courses et ses conseils matos avec une communaute d endurants engagee base sur un contenu sincer": "Pierre is an amateur triathlete who shares his training, races and gear advice with an engaged community of endurance athletes.\n\nWith sincere, sporty and polished content, he has been racing Ironman events for three years and reaches 6,176 followers with an authentic approach that makes people want to get moving.",
  "beverly est une creatrice digitale mode lifestyle basee entre la france et les etats unis avec une presence internationale forte miami new york ibiza dubai son ": "Beverly is a fashion & lifestyle digital creator based between France and the United States, with a strong international presence (Miami, New York, Ibiza, Dubai).\n\nHer content blends a polished editorial aesthetic with stories of life between two continents, for a young, aspirational audience.",
  "ana est une creatrice de contenu et entrepreneuse a l univers artistique et sensible qui place le pouvoir des emotions au cur de chacun de ses contenus suivie p": "Ana is a content creator and entrepreneur with an artistic, sensitive world, putting the power of emotion at the heart of everything she creates.\n\nFollowed by 238,000 people, founder of the brand @co.ames and co-founder of the non-profit @akpeleau, she brings together a community drawn to her eye, her refined aesthetic and her sincerity.",
  "justine est une creatrice sport lifestyle mariee a un ironman crossfiteuse et baby triathlete qui documente sa vie active avec une authenticite rare et communic": "Justine is a sport & lifestyle creator married to an Ironman, a CrossFitter and budding triathlete who documents her active life with rare, infectious authenticity.\n\nHer content blends training, adventure travel and life as a sporty couple, for an engaged audience that shares the same values of effort and pushing past their limits.",
  "lea est une creatrice lifestyle blogging basee dans le sud de la france entre voyages ensoleilles moments du quotidien et contenus spontanes elle partage un uni": "Léa is a lifestyle & blogging creator based in the South of France.\n\nBetween sun-soaked travels, everyday moments and spontaneous content, she shares a warm, authentic world."
};

/** Clé de recherche : sans accents, minuscules, ponctuation retirée, 160 caractères. */
export function bioKey(s: string | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 160);
}

/** Traduction anglaise connue de cette bio française, sinon "". */
export function knownBioEn(bioFr: string | undefined): string {
  return BIO_EN[bioKey(bioFr)] ?? "";
}
