// ============================================================================
// _shared/disposDuMois.ts : les « dispos du mois » envoyées aux agences (logique PURE).
// ----------------------------------------------------------------------------
// Stratégie de Gianni (20/11/2026, « Les agences : notre premier canal ») : le 1er de chaque
// mois, on envoie aux agences les créateurs disponibles, leurs chiffres à jour, un prix
// agence indicatif et les catégories où ils sont pris en exclusivité.
// Partagé par l'app (bouton dans Base créateurs › Listes), le connecteur Claude (outil
// `dispos_du_mois`, pour Alfred) et la fonction du 1er du mois (`dispos-du-mois`). Le résultat
// est rangé dans une liste `creator_lists` (colonne `dispos`), lue par la page publique
// ttpcreators.pro/selection/. Testé par disposDuMois.test.ts. Aucun import de base.
//
// Règles (rien d'inventé) :
//  - créateurs du roster au statut actif ou live (pas « inactif » = sorti, pas « pause ») ;
//  - chiffres : ceux des relevés automatiques (ig-sync, tt-sync, yt-sync), sinon ceux du media
//    kit (déjà publics sur les media kits) ;
//  - vues d'un contenu : la MÉDIANE des derniers contenus quand le relevé donne les vues de
//    chaque contenu, sinon la moyenne mesurée par le relevé. Les vues saisies à la main dans
//    le media kit ne servent ni à l'affichage ni au prix (non vérifiées) ;
//  - prix agence indicatif = prix de base de la méthode TARIF (page Tarifs) : vues ÷ 1000 ×
//    CPM du format × 1 (coefficient neutre) + production simple, jamais sous le plancher du
//    créateur. Sans vues mesurées : pas de prix ;
//  - exclusivités : seulement la catégorie et les dates, JAMAIS la marque ni ses concurrents
//    (choix le plus prudent : une exclusivité n'est pas forcément publique). Une catégorie
//    vague (« même catégorie de produits ») devient « une catégorie de produits (nous
//    consulter) ». Une exclusivité « à confirmer » (lue toute seule dans un contrat reçu par
//    mail, souvent une erreur de lecture) n'est jamais publiée comme une exclusivité sûre : pas
//    affichée, elle devient une note « à vérifier » pour l'agence (avec ou sans créateur
//    reconnu), que la fonction du 1er du mois range aussi dans une tâche (`tacheDispos`).
// ============================================================================

import { creatorFloor, readTarifGrid, type TarifGrid } from "./tarif.ts";
import { foldName, memeCreateur, readExclusivites, type Exclusivite } from "./exclusivites.ts";

export type DisposFormat = "reel" | "story" | "tiktok" | "pack";
/** Formats clés des dispos, avec le format de la méthode TARIF qu'ils utilisent. */
export const DISPOS_FORMATS: { key: DisposFormat; label: string; tarif: string | null }[] = [
  { key: "reel", label: "Reel Instagram", tarif: "instagram.reel" },
  { key: "story", label: "Story Instagram (séquence de 3)", tarif: "instagram.story" },
  { key: "tiktok", label: "Vidéo TikTok", tarif: "tiktok.video" },
  { key: "pack", label: "Pack Reel + story + TikTok", tarif: null },
];

export type DisposReseau = {
  key: "instagram" | "tiktok" | "youtube";
  handle: string | null;
  url: string | null;
  followers: number | null;
  /** Vues d'un contenu : médiane des derniers contenus, ou moyenne mesurée par le relevé. */
  views: number | null;
  viewsKind: "mediane" | "moyenne" | null;
  /** Taux d'engagement en %, sur les abonnés ou sur les vues. */
  er: number | null;
  erBase: "abonnes" | "vues" | null;
  /** D'où viennent abonnés et engagement : relevé automatique ou media kit. */
  source: "releve" | "kit";
};
export type DisposIndispo = { label: string; from: string | null; until: string | null };
export type DisposCreateur = {
  name: string;
  photo: string | null;
  niche: string | null;
  reseaux: DisposReseau[];
  /** Prix agence indicatifs HT, seulement les formats chiffrés. */
  prix: Partial<Record<DisposFormat, number>>;
  indispos: DisposIndispo[];
};
/** Ce qui est rangé dans `creator_lists.dispos` et lu par la page publique. Rien d'interne. */
export type DisposSelection = {
  v: 1;
  mois: string;
  moisLabel: string;
  genereLe: string;
  formats: { key: DisposFormat; label: string }[];
  conditions: string;
  creators: DisposCreateur[];
};
export type DisposResultat = {
  selection: DisposSelection;
  /** Comptes Instagram (sans @) : la liste les garde, l'ancienne page les affiche encore. */
  usernames: string[];
  /** Pour l'agence seulement (app, Alfred) : à vérifier avant l'envoi. Jamais publié. */
  notes: string[];
};

type KitPlatform = { key?: unknown; followers?: unknown; er?: unknown; avgViews?: unknown };
type FeedPost = { at?: unknown; product?: unknown; type?: unknown; views?: unknown; plays?: unknown };
type TtVideo = { at?: unknown; views?: unknown };
/** Colonnes de `creators` lues (le media kit seulement pour ses plateformes : `kit`). */
export type DisposCreatorRow = {
  id?: string | null;
  name?: string | null;
  status?: string | null;
  niche?: string | null;
  photo_url?: string | null;
  instagram?: string | null;
  tiktok?: string | null;
  sort_order?: number | null;
  ig?: { username?: unknown; followers?: unknown; er?: unknown; link?: unknown; insights?: { reelViews?: unknown } | null; feed?: unknown } | null;
  tt?: { username?: unknown; followers?: unknown; er?: unknown; avgViews?: unknown; recent?: unknown } | null;
  yt?: { handle?: unknown; url?: unknown; subscribers?: unknown; er?: unknown; avgViews?: unknown } | null;
  kit?: unknown;
};

// ── Petits outils ────────────────────────────────────────────────────────────
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** « 2026-12 » valide. */
export const isMois = (m: unknown): m is string => typeof m === "string" && /^20\d\d-(0[1-9]|1[0-2])$/.test(m);
/** Mois en cours à Paris (« 2026-11 »). */
export function moisCourant(now: Date): string {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now).slice(0, 7);
}
/** Mois décalé (« 2026-12 », +1 → « 2027-01 »). */
export function moisDecale(mois: string, n: number): string {
  const [y, m] = mois.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
/** « décembre 2026 ». */
export const moisLabel = (mois: string) => `${MOIS[Number(mois.slice(5, 7)) - 1]} ${mois.slice(0, 4)}`;
/** Nom de la liste : « Dispos de décembre 2026 ». */
export const titreDispos = (mois: string) => `Dispos de ${moisLabel(mois)}`;
/** Adresse de la liste : le mois + 4 caractères au hasard (introuvable sans le lien). */
export const prefixeDispos = (mois: string) => `dispos-${mois}-`;
export const slugDispos = (mois: string, hasard: string) => `${prefixeDispos(mois)}${hasard.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6) || "ttp"}`;
export const introDispos = (mois: string) =>
  `Les créateurs TTP disponibles en ${moisLabel(mois)}, avec leurs chiffres à jour et un prix agence indicatif par format.`;
/** Premier et dernier jour du mois (« 2026-12-01 », « 2026-12-31 »). */
export function bornesMois(mois: string): { first: string; last: string } {
  const [y, m] = mois.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${mois}-01`, last: `${mois}-${String(last).padStart(2, "0")}` };
}

/** Nombre lu dans une valeur saisie (« 244 287 », « 5,84 % », « 12,5 K », 1.2e3) ; null sinon. */
export function nombre(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.replace(/[\s  ]/g, "").replace("%", "").replace(",", ".").toLowerCase();
  const m = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(t);
  if (!m) return null;
  const n = parseFloat(m[1]) * (m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1);
  return Number.isFinite(n) ? n : null;
}
const positif = (v: unknown): number | null => {
  const n = nombre(v);
  return n !== null && n > 0 ? n : null;
};

/** Médiane (arrondie) ; null sous `min` valeurs. */
export function mediane(values: readonly number[], min = 5): number | null {
  const xs = values.filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (xs.length < min || !xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return Math.round(xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2);
}

/** Vues des 10 contenus les plus récents (ceux qui en ont), du plus récent au plus ancien. */
function vuesRecentes<T extends { at?: unknown }>(items: unknown, views: (x: T) => unknown, keep: (x: T) => boolean = () => true): number[] {
  if (!Array.isArray(items)) return [];
  return (items as T[])
    .filter((x) => x && typeof x === "object" && keep(x) && nombre(views(x)) !== null)
    .sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")))
    .slice(0, 10)
    .map((x) => nombre(views(x)) as number);
}

const cleanHandle = (h: unknown): string | null => {
  const t = String(h ?? "").trim().replace(/^https?:\/\/(www\.)?(instagram|tiktok)\.com\/@?/i, "").replace(/[/?#].*$/, "").replace(/^@/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(t) ? t : null;
};
/** « LÉNA MOREL » → « Léna Morel ». */
export const nomPropre = (s: string | null | undefined) =>
  (s ?? "").trim().toLocaleLowerCase("fr-FR").replace(/(^|[^\p{L}])(\p{L})/gu, (_m, p: string, c: string) => p + c.toLocaleUpperCase("fr-FR"));
const arrondi = (n: number | null, d = 2) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);

/** Statuts du roster qui comptent dans les dispos : actif (ou vide) et live. */
export const statutDispo = (s: string | null | undefined) => {
  const v = (s ?? "").trim().toLowerCase();
  return v === "" || v === "actif" || v === "live";
};

// ── Réseaux ─────────────────────────────────────────────────────────────────
function kitDe(row: DisposCreatorRow, key: string): KitPlatform | null {
  if (!Array.isArray(row.kit)) return null;
  return (row.kit as KitPlatform[]).find((p) => p && String(p.key ?? "").toLowerCase().includes(key)) ?? null;
}

/** Réseaux d'un créateur (seulement ceux dont on connaît les abonnés) et vues saisies à la main ignorées. */
export function reseauxDe(row: DisposCreatorRow): DisposReseau[] {
  const out: DisposReseau[] = [];
  // Instagram : relevé du jour (abonnés, engagement sur les abonnés) ; vues des reels si le
  // relevé les donne (médiane des derniers reels) ou si le compte est connecté (moyenne).
  const ig = row.ig ?? null;
  const igHandle = cleanHandle(ig?.username) ?? cleanHandle(row.instagram);
  const igF = positif(ig?.followers);
  const igKit = kitDe(row, "instagram");
  if (igF !== null || positif(igKit?.followers) !== null) {
    const reels = vuesRecentes<FeedPost>(ig?.feed, (p) => p.views ?? p.plays, (p) => String(p.product ?? "").toUpperCase() === "REELS");
    const med = mediane(reels);
    const avg = ig?.link ? positif(ig?.insights?.reelViews) : null;
    out.push({
      key: "instagram", handle: igHandle, url: igHandle ? `https://www.instagram.com/${igHandle}/` : null,
      followers: igF ?? positif(igKit?.followers),
      views: med ?? avg, viewsKind: med !== null ? "mediane" : avg !== null ? "moyenne" : null,
      er: arrondi(igF !== null ? nombre(ig?.er) : nombre(igKit?.er)), erBase: igF !== null ? (nombre(ig?.er) !== null ? "abonnes" : null) : nombre(igKit?.er) !== null ? "vues" : null,
      source: igF !== null ? "releve" : "kit",
    });
  }
  // TikTok : relevé (abonnés, vues de chaque vidéo, engagement sur les vues), sinon media kit.
  const tt = row.tt ?? null;
  const ttHandle = cleanHandle(tt?.username) ?? cleanHandle(row.tiktok);
  const ttF = positif(tt?.followers);
  const ttKit = kitDe(row, "tiktok");
  if (ttF !== null || positif(ttKit?.followers) !== null) {
    const med = ttF !== null ? mediane(vuesRecentes<TtVideo>(tt?.recent, (v) => v.views)) : null;
    const avg = ttF !== null ? positif(tt?.avgViews) : null;
    out.push({
      key: "tiktok", handle: ttHandle, url: ttHandle ? `https://www.tiktok.com/@${ttHandle}` : null,
      followers: ttF ?? positif(ttKit?.followers),
      views: med ?? avg, viewsKind: med !== null ? "mediane" : avg !== null ? "moyenne" : null,
      er: arrondi(ttF !== null ? nombre(tt?.er) : nombre(ttKit?.er)), erBase: (ttF !== null ? nombre(tt?.er) : nombre(ttKit?.er)) !== null ? "vues" : null,
      source: ttF !== null ? "releve" : "kit",
    });
  }
  // YouTube : relevé (abonnés, vues moyennes des vidéos longues), sinon media kit.
  const yt = row.yt ?? null;
  const ytF = positif(yt?.subscribers);
  const ytKit = kitDe(row, "youtube");
  if (ytF !== null || positif(ytKit?.followers) !== null) {
    const url = typeof yt?.url === "string" && /^https:\/\/(www\.)?youtube\.com\//.test(yt.url) ? yt.url : null;
    const avg = ytF !== null ? positif(yt?.avgViews) : null;
    out.push({
      key: "youtube", handle: typeof yt?.handle === "string" ? yt.handle.replace(/^@/, "").slice(0, 40) || null : null, url,
      followers: ytF ?? positif(ytKit?.followers),
      views: avg, viewsKind: avg !== null ? "moyenne" : null,
      er: arrondi(ytF !== null ? nombre(yt?.er) : nombre(ytKit?.er)), erBase: (ytF !== null ? nombre(yt?.er) : nombre(ytKit?.er)) !== null ? "vues" : null,
      source: ytF !== null ? "releve" : "kit",
    });
  }
  return out;
}

// ── Prix ────────────────────────────────────────────────────────────────────
/** Prix de base d'un contenu (méthode TARIF, coefficient 1, production simple, plancher). */
export function prixContenu(views: number, cpm: number, g: TarifGrid, plancher: number): number {
  return Math.round(Math.max(plancher, (views / 1000) * cpm + g.production.simple));
}

/**
 * Prix agence indicatifs : Reel (vues des reels), story (aucun relevé ne mesure les vues des
 * stories pour l'instant : pas de prix), TikTok (vues des vidéos), pack = un de chaque, avec la
 * remise package de la grille, seulement quand les trois sont chiffrés.
 */
export function prixDe(reseaux: readonly DisposReseau[], g: TarifGrid, plancher: number): Partial<Record<DisposFormat, number>> {
  const prix: Partial<Record<DisposFormat, number>> = {};
  const ig = reseaux.find((r) => r.key === "instagram");
  const tt = reseaux.find((r) => r.key === "tiktok");
  if (ig?.views) prix.reel = prixContenu(ig.views, g.cpm["instagram.reel"], g, plancher);
  if (tt?.views) prix.tiktok = prixContenu(tt.views, g.cpm["tiktok.video"], g, plancher);
  if (prix.reel && prix.story && prix.tiktok) {
    const sum = prix.reel + prix.story + prix.tiktok;
    const remise = 3 >= g.packMin ? g.packPct : 0;
    prix.pack = Math.max(plancher * 3, Math.round(sum * (1 - remise / 100)));
  }
  return prix;
}

// ── Exclusivités ────────────────────────────────────────────────────────────
/** Catégorie trop vague pour être utile sans la marque (« même catégorie de produits »). */
const SCOPE_VAGUE = /^$|^(la |toute la )?meme (categorie|secteur)|^toute la (categorie|secteur)/;

/** Catégories où le créateur est pris pendant le mois, sans jamais nommer la marque (ligne au prénom seul comprise). */
export function indisposDe(list: readonly Exclusivite[], creator: string, mois: string): DisposIndispo[] {
  const { first, last } = bornesMois(mois);
  const out: DisposIndispo[] = [];
  for (const e of list) {
    if (e.pending || !memeCreateur(e.creator, creator)) continue;
    if ((e.start && e.start > last) || (e.end && e.end < first)) continue;
    const scope = e.scope.trim().replace(/\s+/g, " ");
    const label = SCOPE_VAGUE.test(foldName(scope)) ? "une catégorie de produits (nous consulter)" : scope.slice(0, 80);
    const from = e.start && e.start > first ? e.start : null;
    const until = e.end || null;
    if (!out.some((x) => x.label === label && x.until === until && x.from === from)) out.push({ label, from, until });
  }
  return out;
}

/** Note d'une ligne « à confirmer » : « exclusivité « parfum » (Marque) lue toute seule… à vérifier… ». */
function noteAVerifier(e: Exclusivite): string {
  return `exclusivité « ${e.scope.trim() || "sans catégorie"} »${e.brand.trim() ? ` (${e.brand.trim()})` : ""} lue toute seule dans un contrat reçu par mail, jamais confirmée : à vérifier dans la page Exclusivités avant l'envoi (confirmer ou écarter), pas affichée sur la page.`;
}

const frDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** « nutrition sportive jusqu'au 31/12 » (année ajoutée si elle diffère du mois). */
export function indispoTexte(x: DisposIndispo, mois: string): string {
  const d = (iso: string) => (iso.slice(0, 4) === mois.slice(0, 4) ? frDate(iso) : `${frDate(iso)}/${iso.slice(0, 4)}`);
  return `${x.label}${x.from ? ` à partir du ${d(x.from)}` : ""}${x.until ? ` jusqu'au ${d(x.until)}` : ""}`;
}

// ── La sélection ────────────────────────────────────────────────────────────
export type DisposInput = {
  creators: readonly DisposCreatorRow[];
  /** `pricingRates` du blob agence (barème `ttp`, planchers `ttpFloors`). */
  pricingRates: unknown;
  /** `exclusivites` du blob agence. */
  exclusivites: unknown;
  mois: string;
  now: Date;
};

export function conditionsDispos(g: TarifGrid): string {
  return `Prix agence indicatifs HT par contenu, production simple, sans droits d'usage, exclusivité, urgence ni paid media (droits organiques +${g.rightsPct} % par tranche de 3 mois, paid media +${g.paidPct} % par mois). Prix sur demande quand les vues ne sont pas mesurées.`;
}

export function disposDuMois(input: DisposInput): DisposResultat {
  const rates = (input.pricingRates && typeof input.pricingRates === "object" ? input.pricingRates : {}) as Record<string, unknown>;
  const g = readTarifGrid(rates.ttp);
  const exclus = readExclusivites(input.exclusivites);
  const notes: string[] = [];
  const usernames: string[] = [];
  const creators: DisposCreateur[] = [];
  const rows = [...input.creators].filter((r) => (r.name ?? "").trim()).sort((a, b) => (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9));
  // Lignes « à confirmer » qui touchent le mois : une note chacune, jamais publiées.
  const { first, last } = bornesMois(input.mois);
  const aVerifier = exclus.filter((e) => e.pending && !(e.start && e.start > last) && !(e.end && e.end < first));
  const notees = new Set<string>();

  for (const row of rows) {
    const name = nomPropre(row.name);
    if (!statutDispo(row.status)) {
      if ((row.status ?? "").trim().toLowerCase() === "pause") notes.push(`${name} : en pause, pas dans les dispos.`);
      continue;
    }
    const reseaux = reseauxDe(row);
    const plancher = creatorFloor(rates.ttpFloors, row.id ?? null, g).value;
    const prix = prixDe(reseaux, g, plancher);
    const indispos = indisposDe(exclus, row.name ?? "", input.mois);
    const igHandle = reseaux.find((r) => r.key === "instagram")?.handle ?? cleanHandle(row.instagram);
    if (igHandle && !usernames.includes(igHandle)) usernames.push(igHandle);
    creators.push({
      name,
      photo: typeof row.photo_url === "string" && /^https:\/\//.test(row.photo_url) ? row.photo_url : null,
      niche: (row.niche ?? "").trim() || null,
      reseaux,
      prix,
      indispos,
    });

    // Pour l'agence : ce qui manque, et ce qui attend une confirmation.
    if (!reseaux.length) notes.push(`${name} : aucun chiffre (ni relevé ni media kit), affiché sans chiffres.`);
    if (!Object.keys(prix).length && reseaux.length) {
      const why = reseaux.some((r) => r.key === "instagram") && !reseaux.find((r) => r.key === "instagram")?.views
        ? "vues des reels non mesurées, Instagram non connecté"
        : "vues non mesurées";
      notes.push(`${name} : pas de prix (${why}), affiché « prix sur demande ».`);
    }
    const kitViews = Array.isArray(row.kit) ? (row.kit as KitPlatform[]).filter((p) => positif(p?.avgViews) !== null) : [];
    for (const p of kitViews) {
      notes.push(`${name} : vues ${String(p.key ?? "")} du media kit (${String(p.avgViews)}, saisies à la main) non utilisées pour le prix.`);
    }
    for (const e of aVerifier) {
      if (!memeCreateur(e.creator, row.name ?? "")) continue;
      notees.add(e.id);
      notes.push(`${name} : ${noteAVerifier(e)}`);
    }
  }
  // Lignes « à confirmer » sans créateur reconnu (ou d'un nom hors des dispos) : jamais passées sous silence.
  for (const e of aVerifier) {
    if (notees.has(e.id)) continue;
    notes.push(`${e.creator.trim() ? `${nomPropre(e.creator)} (hors des dispos)` : "Créateur non reconnu"} : ${noteAVerifier(e)}`);
  }
  if (!exclus.length) notes.push("Aucune exclusivité enregistrée : vérifier la page Exclusivités avant l'envoi.");

  return {
    selection: {
      v: 1,
      mois: input.mois,
      moisLabel: moisLabel(input.mois),
      genereLe: input.now.toISOString(),
      formats: DISPOS_FORMATS.map(({ key, label }) => ({ key, label })),
      conditions: conditionsDispos(g),
      creators,
    },
    usernames,
    notes,
  };
}

// ── Tâche de la fonction du 1er du mois ─────────────────────────────────────
/**
 * La tâche qui garde les points à vérifier de la liste faite par la fonction du 1er du mois
 * (sinon ils restent dans sa réponse, que personne ne lit). null sans point à vérifier.
 */
export function tacheDispos(r: DisposResultat, url: string): { titre: string; details: string } | null {
  if (!r.notes.length) return null;
  return {
    titre: `${titreDispos(r.selection.mois)} : à relire`,
    details: [`Lien de la liste : ${url}`, "", "À vérifier avant d'envoyer le lien aux agences (jamais dans un message) :", ...r.notes.map((n) => `- ${n}`)].join("\n"),
  };
}

// ── Texte pour Alfred et l'app ──────────────────────────────────────────────
export const compactFr = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M` : n >= 1e4 ? `${(n / 1e3).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} K` : Math.round(n).toLocaleString("fr-FR");
const eur = (n: number) => `${n.toLocaleString("fr-FR")} €`.replace(/[  ]/g, " ");
const RESEAU: Record<DisposReseau["key"], string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" };

/** Une ligne par créateur, puis les conditions et les points à vérifier. */
export function disposTexte(r: DisposResultat, url: string | null): string {
  const s = r.selection;
  const out = [`# ${titreDispos(s.mois)} · ${s.creators.length} créateur(s)`, url ? `Lien à envoyer aux agences : ${url}` : "Lien : pas encore créé."];
  for (const c of s.creators) {
    const bits: string[] = [];
    for (const n of c.reseaux) {
      const parts = [n.followers !== null ? `${compactFr(n.followers).replace(/[  ]/g, " ")} abonnés` : "", n.views !== null ? `${compactFr(n.views).replace(/[  ]/g, " ")} vues ${n.viewsKind === "mediane" ? "médianes" : "moyennes"}` : "", n.er !== null ? `engagement ${String(n.er).replace(".", ",")} %` : ""].filter(Boolean);
      bits.push(`${RESEAU[n.key]}${n.handle ? ` @${n.handle}` : ""} : ${parts.join(", ")}${n.source === "kit" ? " (media kit)" : ""}`);
    }
    const prix = DISPOS_FORMATS.filter((f) => c.prix[f.key]).map((f) => `${f.label} ${eur(c.prix[f.key] as number)} HT`);
    out.push(`- ${c.name}${c.niche ? ` (${c.niche})` : ""} · ${bits.join(" · ") || "aucun chiffre"} · ${prix.length ? prix.join(", ") : "prix sur demande"}${c.indispos.length ? ` · pas dispo pour : ${c.indispos.map((x) => indispoTexte(x, s.mois)).join(" ; ")}` : ""}`);
  }
  out.push("", s.conditions);
  if (r.notes.length) out.push("", "À vérifier avant l'envoi (jamais publié) :", ...r.notes.map((n) => `- ${n}`));
  return out.join("\n");
}
