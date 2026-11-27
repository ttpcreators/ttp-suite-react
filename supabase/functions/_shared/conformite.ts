// ============================================================================
// _shared/conformite.ts : conformité automatique des posts Instagram des créateurs.
// ----------------------------------------------------------------------------
// Remplace la « vigie de 6 h » faite à la main par Alfred. Deux incidents :
//
//   1. MENTION MANQUANTE. Loi n° 2023-451 du 9 juin 2023 (art. 5) : un contenu qui promeut
//      une marque contre une contrepartie porte « Publicité » ou « Collaboration
//      commerciale », de façon claire, lisible et identifiable. ARPP (recommandation
//      « Communication publicitaire digitale ») : l'identification est immédiate, dès le
//      début, avant le « … plus » d'Instagram. Règle retenue : la mention doit tenir dans
//      les premiers caractères de la légende (DEBUT_REEL pour un Reel, qui montre une seule
//      ligne, DEBUT_POST sinon). Mentions acceptées : « collaboration commerciale »,
//      « partenariat rémunéré », « publicité », « produit offert », #ad, #pub, #sponsorisé,
//      #partenariat.
//      Un post est un partenariat quand :
//        - il cite la marque d'une collab de ce créateur (depuis 3 jours avant la collab) ;
//        - OU il montre un signal fort : code promo (« code CHLOEDR10 », « -10% LENAPSL10 »),
//          « en collaboration avec », « en partenariat avec », « offert par », ou une
//          mention mal placée (la mention elle-même prouve le partenariat) ;
//        - OU il montre un signal faible (« lien en bio », « unboxing », « concours ») ET
//          cite une marque reconnue (carnet de contacts) ou un compte (« holosport.official »).
//      Un post sans aucune marque ni signal n'est jamais un incident.
//
//   2. CONFLIT D'EXCLUSIVITÉ. Un post publié pendant une exclusivité en cours (confirmée)
//      qui cite une marque concurrente : liste des concurrents du contrat (même règle que
//      `verifier_exclusivite`, `hitsBrand`), ou une marque du carnet dont le secteur
//      (étiquette de la fiche) est un MOT ENTIER du secteur interdit. Plus strict que
//      `hitsBrand` pour les secteurs : « sport » ne tombe pas sous « nutrition sportive ».
//      Les marques des collabs du créateur ne comptent jamais : l'agence les a signées.
//
// Reconnaissance des marques : brandMatcher (collabPosts.ts), comme les posts des collabs.
// Règle PURE (ni Supabase ni Deno), testée par conformite.test.ts. Appelée par ig-sync.
// ============================================================================

import { brandMatcher } from "./collabPosts.ts";
import { excluState, foldName, hitsBrand, type Exclusivite } from "./exclusivites.ts";

export type ConformitePost = { id: string; url: string; at: string; caption: string; product?: string };
/** Collab du créateur : marque et date de création (ISO). */
export type ConformiteCollab = { brand: string; since?: string | null };
/** Marque du carnet de contacts : nom, comptes Instagram connus, secteurs (étiquette). */
export type MarqueConnue = { brand: string; handles?: readonly string[]; tags?: readonly string[] };

export type IncidentType = "mention" | "exclusivite";
export type Incident = {
  /** `<id du post>:<type>` : une fois par post et par type. */
  id: string;
  type: IncidentType;
  creator: string;
  brand: string;
  postId: string;
  url: string;
  /** Date du post (ISO). */
  at: string;
  /** Ce qui ne va pas, en une phrase. */
  detail: string;
  /** La correction à demander. */
  correction: string;
};

export type ConformiteIn = {
  creator: string;
  posts: readonly ConformitePost[];
  collabs: readonly ConformiteCollab[];
  exclusivites: readonly Exclusivite[];
  marques?: readonly MarqueConnue[];
  /** Maintenant (les posts plus vieux que MAX_AGE_DAYS sont ignorés). */
  now: Date;
};

/** Caractères visibles avant « … plus » : une ligne sur un Reel, deux à trois sur un post. */
export const DEBUT_REEL = 60;
export const DEBUT_POST = 125;
/** Posts regardés : les 14 derniers jours (la vigie ne remonte pas tout l'historique). */
export const MAX_AGE_DAYS = 14;
const DAY = 86400000;

export const TYPE_LABEL: Record<IncidentType, string> = { mention: "mention manquante", exclusivite: "conflit d'exclusivité" };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Mentions qui disent clairement le partenariat (texte replié : minuscules, sans accents). */
const DISCLOSURE = /(collaboration commerciale|collab commerciale|partenariat remunere|paid partnership|publicite|produits? offerts?|#ad\b|#pub\b|#sponsorisee?s?\b|#sponsored\b|#partenariat\b|#collaborationcommerciale|#produitoffert|\bsponsorisee?s?\b)/;
/** Signaux forts de partenariat, sans marque nécessaire. */
const PARTNER_TEXT = /(en collaboration avec|en collab avec|en partenariat avec|partenariat avec|sponsorisee? par|offerte?s? par)/;
/** Signaux faibles : comptent seulement avec une marque reconnue ou un compte cité. */
const WEAK = /(lien (en|dans (ma |la |mon )?)bio|link in bio|lien en story|unboxing|concours|giveaway)/;
/** Mots courants portés par une fiche contact : jamais pris pour une marque. */
const STOP_BRANDS = new Set(["soon", "north", "holy", "aime", "uncle", "swap", "move", "black", "home", "love", "girl", "sport", "autre", "perso", "marque", "agence", "media", "presse", "on", "f"]);
/** Fiches du carnet qui ne sont pas des marques. */
const NOT_BRAND_TAG = /^(agence|agence rp|freelance|perso|presse|media)$/;

/** Code promo dans le texte d'origine (majuscules gardées). */
export function hasPromoCode(caption: string): boolean {
  const t = caption.normalize("NFC");
  // « code CHLOEDR10 », « code promo : LENA10 », « code chloe10 »
  const code = /\bcode\s*(?:promo\s*)?[:：]?\s*[«"'“]?\s*([A-Za-z0-9]{4,})/gi;
  for (const m of t.matchAll(code)) {
    const tok = m[1];
    if (/\d/.test(tok) || tok === tok.toUpperCase()) return true;
  }
  // « -10% avec LENAPSL10 », « -10% JUSTINELBCV10 », ou l'inverse.
  const pct = /-\s?\d{1,2}\s?%/;
  const tok = /\b[A-Z][A-Z0-9]{2,}\d{1,3}\b/g;
  for (const m of t.matchAll(tok)) {
    const around = t.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + m[0].length + 40);
    if (pct.test(around)) return true;
  }
  return false;
}

/** Comptes cités (Meta retire les @) : mots en minuscules avec un point ou un tiret bas. */
export function accountTokens(caption: string): string[] {
  const out: string[] = [];
  for (const m of caption.matchAll(/(?:^|[\s(,:;!?'"«“])([a-z0-9]+(?:[._][a-z0-9]+)+)_?(?=$|[\s),:;!?'"»”…]|\.(?:\s|$))/g)) {
    const tok = m[1];
    if (/^\d+([.,]\d+)*$/.test(tok)) continue; // 2.5
    if (/\.(com|fr|net|org|io|be|ch|eu|co)$/.test(tok) || /^www\./.test(tok)) continue; // site, pas un compte
    if (!/[a-z]{3}/.test(tok)) continue;
    out.push(tok);
  }
  return out;
}

/** Mention de partenariat dans la légende : position (caractère) ou -1. */
export function disclosureAt(caption: string): number {
  const m = DISCLOSURE.exec(norm(caption));
  return m ? m.index : -1;
}

type Matcher = { brand: string; tags: readonly string[]; test: (caption: string) => boolean };
const cache = new Map<string, (c: string) => boolean>();
function matcherOf(brand: string, handles: readonly string[] = []): (caption: string) => boolean {
  const k = `${brand}|${handles.join(",")}`;
  let fn = cache.get(k);
  if (!fn) {
    fn = brandMatcher(brand, handles);
    if (cache.size > 5000) cache.clear();
    cache.set(k, fn);
  }
  return fn;
}

/** Marques du carnet utilisables pour reconnaître une marque (pas les agences, pas les mots courants). */
function carnet(marques: readonly MarqueConnue[]): Matcher[] {
  const seen = new Set<string>();
  const out: Matcher[] = [];
  for (const m of marques) {
    const b = (m.brand ?? "").trim();
    const f = foldName(b).replace(/ /g, "");
    if (!f || seen.has(f) || STOP_BRANDS.has(f)) continue;
    const tags = (m.tags ?? []).filter((t) => typeof t === "string" && t.trim());
    if (tags.some((t) => NOT_BRAND_TAG.test(foldName(t)))) continue;
    if (f.length < 4 && !(m.handles ?? []).length) continue; // « BYD », « EDF » : trop ambigus sans compte
    seen.add(f);
    out.push({ brand: b, tags, test: matcherOf(b, m.handles ?? []) });
  }
  return out;
}

/** Même marque (même règle que exclusivites.ts : « Nutripure » = « Nutripure France »). */
function sameBrand(a: string, b: string): boolean {
  const x = foldName(a).replace(/ /g, "");
  const y = foldName(b).replace(/ /g, "");
  return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x))));
}

/** Le secteur d'une marque (étiquette) est-il un mot entier du secteur interdit ? */
function sectorHit(scope: string, tags: readonly string[]): boolean {
  const words = new Set(foldName(scope).split(" ").filter(Boolean));
  if (!words.size) return false;
  return tags.some((t) => {
    const w = foldName(t).split(" ").filter((x) => x.length >= 4);
    return w.length > 0 && w.every((x) => words.has(x));
  });
}

const titleCase = (s: string) =>
  s.trim().toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
const frDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("fr-FR", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }) : iso;
};

/** Les incidents des posts récents d'un créateur (triés du plus ancien au plus récent). */
export function incidentsConformite(input: ConformiteIn): Incident[] {
  const creator = input.creator.trim();
  const who = titleCase(creator);
  const nowMs = input.now.getTime();
  const today = input.now.toISOString().slice(0, 10);
  const book = carnet(input.marques ?? []);
  const handlesOf = (brand: string) => (input.marques ?? []).filter((m) => foldName(m.brand) === foldName(brand)).flatMap((m) => m.handles ?? []);
  const collabs = input.collabs.filter((c) => c.brand?.trim());
  const ownBrands = new Set(collabs.map((c) => foldName(c.brand).replace(/ /g, "")));
  const exclus = input.exclusivites.filter((e) => !e.pending && foldName(e.creator) === foldName(creator) && e.brand.trim());
  const out: Incident[] = [];

  for (const p of input.posts) {
    const t = Date.parse(p.at);
    if (!p.id || !Number.isFinite(t) || nowMs - t > MAX_AGE_DAYS * DAY || t > nowMs + DAY) continue;
    const caption = (p.caption ?? "").trim();
    if (!caption) continue;
    const folded = norm(caption);
    const day = new Date(t).toISOString().slice(0, 10);

    // ── 1. Mention manquante ──
    const collabBrand = collabs.find((c) => t >= (Date.parse(c.since ?? "") || 0) - 3 * DAY && matcherOf(c.brand, handlesOf(c.brand))(caption))?.brand;
    const known = book.filter((m) => m.test(caption));
    const tokens = accountTokens(caption);
    const at = disclosureAt(caption);
    const strong = hasPromoCode(caption) || PARTNER_TEXT.test(folded) || at >= 0;
    const weak = WEAK.test(folded) && (known.length > 0 || tokens.length > 0);
    if (collabBrand || strong || weak) {
      const limit = /reel/i.test(p.product ?? "") ? DEBUT_REEL : DEBUT_POST;
      if (at < 0 || at > limit) {
        const brand = collabBrand ?? known[0]?.brand ?? (tokens[0] ? tokens[0].replace(/[._](official|officiel|offi|fr|france|paris|store|shop|app|eu|world|hq)$/, "") : "marque à identifier");
        const why = collabBrand ? `cite ${brand}, en collab avec l'agence` : hasPromoCode(caption) ? "code promo" : PARTNER_TEXT.test(folded) ? "partenariat cité dans le texte" : at >= 0 ? "mention présente" : "lien ou unboxing d'une marque";
        out.push({
          id: `${p.id}:mention`, type: "mention", creator, brand, postId: p.id, url: p.url, at: p.at,
          detail: at < 0
            ? `Post sponsorisé (${why}) sans « Collaboration commerciale » ni « Produit offert ».`
            : `Mention placée trop loin (caractère ${at + 1}) : invisible avant « … plus ».`,
          correction: `Demander à ${who} de mettre « Collaboration commerciale » (ou « Produit offert » si le produit a seulement été offert) au tout début de la légende, et la mention sur l'image ou la vidéo. Activer aussi le label « Partenariat rémunéré » d'Instagram.`,
        });
      }
    }

    // ── 2. Conflit d'exclusivité ──
    const hits = new Map<string, Exclusivite>();
    for (const e of exclus) {
      if (excluState(e, today) !== "en_cours" || (e.start && day < e.start) || (e.end && day > e.end)) continue;
      for (const c of e.competitors) {
        if (!hitsBrand(e, c) || ownBrands.has(foldName(c).replace(/ /g, ""))) continue;
        if (matcherOf(c, handlesOf(c))(caption)) hits.set(foldName(c), e);
      }
      for (const m of known) {
        const f = foldName(m.brand).replace(/ /g, "");
        if (ownBrands.has(f) || hits.has(foldName(m.brand)) || sameBrand(e.brand, m.brand) || !sectorHit(e.scope, m.tags)) continue;
        hits.set(foldName(m.brand), e);
      }
    }
    if (hits.size) {
      const names = [...hits.keys()].map((k) => {
        const e = hits.get(k) as Exclusivite;
        return e.competitors.find((c) => foldName(c) === k) ?? known.find((m) => foldName(m.brand) === k)?.brand ?? k;
      });
      const e = [...hits.values()][0];
      out.push({
        id: `${p.id}:exclusivite`, type: "exclusivite", creator, brand: names.join(", "), postId: p.id, url: p.url, at: p.at,
        detail: `Cite ${names.join(", ")} pendant l'exclusivité ${e.brand}${e.end ? ` (jusqu'au ${frDate(e.end)})` : ""}.`,
        correction: `Demander à ${who} de retirer ${names.join(", ")} de la légende et du visuel (ou d'archiver le post), puis vérifier le contrat ${e.brand} : prévenir la marque si le post a déjà été vu.`,
      });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

// ── Tâche de la to-do et journal ────────────────────────────────────────────

/** Titre de la tâche : « Conformité : Zoé Morel · Nova · mention manquante ». */
export function tacheTitre(i: Pick<Incident, "creator" | "brand" | "type">): string {
  return `Conformité : ${titleCase(i.creator)} · ${i.brand} · ${TYPE_LABEL[i.type]}`;
}

/** Bloc de description d'un incident (lien du post, problème, correction). */
export function tacheBloc(i: Incident): string {
  return `Post du ${frDate(i.at.slice(0, 10))} : ${i.url}\n${i.detail}\nÀ faire : ${i.correction}`;
}

/** Entrée du journal (blob agence, clé JOURNAL_KEY, objet id → entrée). */
export type JournalEntry = { type: IncidentType; creator: string; brand: string; url: string; at: string; seen: string };
export const JOURNAL_KEY = "conformiteIncidents";
/** Le journal garde 400 jours. */
export const JOURNAL_DAYS = 400;

export function journalEntry(i: Incident, seen: Date): JournalEntry {
  const t = Date.parse(i.at);
  return { type: i.type, creator: i.creator, brand: i.brand, url: i.url, at: Number.isFinite(t) ? new Date(t).toISOString() : i.at, seen: seen.toISOString() };
}

/** Journal lu dans le blob (valeurs bizarres écartées). */
export function readJournal(raw: unknown): Record<string, JournalEntry> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, JournalEntry> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const e = v as Partial<JournalEntry> | null;
    if (e && typeof e === "object" && (e.type === "mention" || e.type === "exclusivite") && typeof e.at === "string") out[k] = e as JournalEntry;
  }
  return out;
}

/** Ids du journal à oublier (plus vieux que JOURNAL_DAYS). */
export function journalStale(journal: Record<string, JournalEntry>, now: Date): string[] {
  const limit = now.getTime() - JOURNAL_DAYS * DAY;
  return Object.entries(journal).filter(([, e]) => !(Date.parse(e.seen || e.at) >= limit)).map(([k]) => k);
}
