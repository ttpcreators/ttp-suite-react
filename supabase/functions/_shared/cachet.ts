// ============================================================================
// _shared/cachet.ts : UNE façon d'écrire le cachet d'une collab (colonne texte
// collabs.cachet). Règles PURES, testées par cachet.test.ts ; lues par l'app (champ
// « Cachet » des collabs, src/components/cachet-field.tsx) et par le connecteur Claude
// (creer_element / modifier_element sur la table collabs).
//
// Forme écrite (relue sans ambiguïté par parseAmountStrict et cachetCurrency de l'app) :
//   « 550 € », « 1 500 $ », « 300 £ », « 800 CHF », « Affiliation seule »,
//   « 550 € + affiliation ».
// Un ancien texte libre illisible (« 300 € + produits offerts », « Gifting ») n'est
// jamais réécrit : il reste tel quel tant que personne ne saisit de montant.
// ============================================================================

export const CACHET_DEVISES = ["EUR", "USD", "GBP", "CHF"] as const;
export type CachetDevise = (typeof CACHET_DEVISES)[number];

/** Signe écrit après le montant. */
export const DEVISE_SIGNE: Record<CachetDevise, string> = { EUR: "€", USD: "$", GBP: "£", CHF: "CHF" };

export const AFFILIATION_SEULE = "Affiliation seule";

export type Cachet = { montant: number | null; devise: CachetDevise; affiliation: boolean };
/** Lecture d'un cachet : `lisible` = la saisie se réécrit sans rien perdre. */
export type LectureCachet = Cachet & { lisible: boolean };

/** « 1500 » → « 1 500 », « 1500.5 » → « 1 500,50 » (espace simple entre les milliers). */
function chiffres(n: number): string {
  const [ent, dec] = (Math.round(n * 100) / 100).toFixed(2).split(".");
  const groupes = ent.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return dec === "00" ? groupes : `${groupes},${dec}`;
}

/** Cachet → texte rangé dans la colonne ; null si rien n'est saisi. */
export function ecrireCachet(c: Cachet): string | null {
  const m = c.montant != null && Number.isFinite(c.montant) && c.montant >= 0 ? c.montant : null;
  if (m === null) return c.affiliation ? AFFILIATION_SEULE : null;
  const txt = `${chiffres(m)} ${DEVISE_SIGNE[c.devise] ?? "€"}`;
  return c.affiliation ? `${txt} + affiliation` : txt;
}

const DEVISES: [CachetDevise, RegExp][] = [
  ["EUR", /€|\beur\b|\beuros?\b/gi],
  ["USD", /\$|\busd\b|\bdollars?\b/gi],
  ["GBP", /£|\bgbp\b|\blivres?\b/gi],
  ["CHF", /\bchf\b|\bfrancs? suisses?\b/gi],
];

// Un seul montant propre : « 550 », « 1 500 », « 1.500 », « 1 500,50 », « 1500.5 », « 3k », « 1,5k ».
const NOMBRE = /^(\d{1,3}(?:[ \u00a0\u202f.]\d{3})+|\d+)(?:,(\d{1,2})|\.(\d{1,2}))?\s*([kK])?$/;

/**
 * Lit un cachet écrit (forme de l'app ou ancien texte libre). Montant et devise sont donnés
 * seulement si toute la saisie se relit (un montant, au plus une devise, « HT » toléré,
 * « affiliation » reconnue) ; sinon `lisible` est faux et le texte d'origine doit être gardé.
 */
export function lireCachet(texte: unknown): LectureCachet {
  const t = String(texte ?? "").trim();
  if (!t || /^[—–-]+$/.test(t)) return { montant: null, devise: "EUR", affiliation: false, lisible: true };
  let reste = t;
  let affiliation = false;
  const af = /\s*(?:\+|\bet\b|\bavec\b|,)?\s*\baffiliation\b(?:\s+seule(?:ment)?)?\s*/i;
  if (af.test(reste)) {
    affiliation = true;
    reste = reste.replace(af, " ").trim();
    // « Affiliation seule » écrit après un montant (« 500 € affiliation seule ») : ce n'est plus lisible.
    if (/\baffiliation\b/i.test(reste)) return { montant: null, devise: "EUR", affiliation, lisible: false };
  }
  const trouvees = DEVISES.filter(([, re]) => new RegExp(re.source, "i").test(reste)).map(([d]) => d);
  const devise: CachetDevise = trouvees[0] ?? "EUR";
  if (trouvees.length > 1) return { montant: null, devise, affiliation, lisible: false };
  for (const [, re] of DEVISES) reste = reste.replace(re, " ");
  reste = reste.replace(/\bht\b/gi, " ").replace(/\s+/g, " ").trim();
  if (!reste) return { montant: null, devise, affiliation, lisible: affiliation && !trouvees.length };
  const m = NOMBRE.exec(reste);
  if (!m) return { montant: null, devise, affiliation, lisible: false };
  const ent = m[1].replace(/[ \u00a0\u202f.]/g, "");
  const dec = m[2] ?? m[3] ?? "";
  const n = parseFloat(dec ? `${ent}.${dec}` : ent) * (m[4] ? 1000 : 1);
  if (!Number.isFinite(n)) return { montant: null, devise, affiliation, lisible: false };
  return { montant: Math.round(n * 100) / 100, devise, affiliation, lisible: true };
}

/**
 * Cachet reçu d'ailleurs (Claude, import) → forme de l'app si la saisie est lisible,
 * sinon le texte tel quel (jamais d'information perdue). Vide → null.
 */
export function normaliserCachet(texte: unknown): string | null {
  const t = String(texte ?? "").trim();
  if (!t) return null;
  const l = lireCachet(t);
  return l.lisible ? (ecrireCachet(l) ?? t) : t;
}
