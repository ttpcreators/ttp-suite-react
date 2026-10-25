/*
 * Méthode TARIF de l'agence (logique PURE, testée par tarif.test.ts), partagée par la page
 * Tarifs de l'app (src/lib/pricingTTP.ts) et le connecteur Claude (outil `methode_tarif`).
 * Barème rangé dans le blob agence : `pricingRates.ttp` (valeurs modifiées seulement) et
 * `pricingRates.ttpFloors` (plancher par créateur, clé = id de la fiche). Les autres clés de
 * `pricingRates` (« instagram.reel » : ancien barème par abonnés) ne sont pas touchées.
 * Aucun import : ce fichier tourne sous Deno et dans l'app.
 */

/** Formats chiffrés, avec leur nom lisible. Clé = « plateforme.format » (comme pricing.ts). */
export const TARIF_FORMATS: { key: string; label: string }[] = [
  { key: "instagram.reel", label: "Reel Instagram" },
  { key: "instagram.carrousel", label: "Carrousel Instagram" },
  { key: "instagram.post", label: "Post Instagram" },
  { key: "instagram.story", label: "Story Instagram (séquence de 3)" },
  { key: "tiktok.video", label: "Vidéo TikTok" },
  { key: "tiktok.story", label: "Story TikTok" },
  { key: "youtube.integration", label: "Intégration YouTube" },
  { key: "youtube.dedicated", label: "Vidéo YouTube dédiée" },
  { key: "youtube.short", label: "Short YouTube" },
  { key: "snapchat.story", label: "Story Snapchat (séquence de 3)" },
  { key: "x.post", label: "Post X" },
];

export type ProdLevel = "simple" | "moyen" | "elabore";
export const PROD_LEVELS: { value: ProdLevel; label: string; help: string }[] = [
  { value: "simple", label: "Simple", help: "Chez soi, seule, sans matériel en plus" },
  { value: "moyen", label: "Moyen", help: "Lieu extérieur ou déplacement court, un peu de matériel" },
  { value: "elabore", label: "Élaboré", help: "Déplacement, matériel loué, autres personnes à filmer" },
];

export type TarifGrid = {
  /** € HT pour 1000 vues médianes, par format. */
  cpm: Record<string, number>;
  /** Forfait de production par contenu (€ HT). */
  production: Record<ProdLevel, number>;
  /** Plancher par contenu (€ HT) quand le créateur n'en a pas. */
  floor: number;
  /** Droits organiques : % par tranche de 3 mois. */
  rightsPct: number;
  /** Paid media, whitelisting, Spark Ads : % par mois. */
  paidPct: number;
  /** Exclusivité restreinte (concurrents directs) : % par mois. */
  exclRestrictedPct: number;
  /** Exclusivité large (toute la catégorie) : % par mois. */
  exclWidePct: number;
  /** Urgence : % si le délai brief → publication est sous `rushDays` jours. */
  rushPct: number;
  rushDays: number;
  /** Lien en bio ou code promo : %. */
  linkPct: number;
  /** Retouche au-delà de celles incluses : € HT l'unité. */
  extraRetouch: number;
  /** Package : remise % à partir de `packMin` contenus. */
  packPct: number;
  packMin: number;
  /** Partenariat : remise % à partir de `partnerMonths` mois, volume garanti par écrit. */
  partnerPct: number;
  partnerMonths: number;
  /** Ancrage = cible + ce %. */
  anchorPct: number;
  /** CPM effectif sous lequel le deal est trop bas (€ pour 1000 vues). */
  minCpm: number;
};

/** Valeurs de départ, à ajuster par l'agence (Barème de l'agence, page Tarifs). */
export const DEFAULT_TARIF_GRID: TarifGrid = {
  cpm: {
    "instagram.reel": 25,
    "instagram.carrousel": 20,
    "instagram.post": 20,
    "instagram.story": 12,
    "tiktok.video": 18,
    "tiktok.story": 12,
    "youtube.integration": 30,
    "youtube.dedicated": 45,
    "youtube.short": 15,
    "snapchat.story": 12,
    "x.post": 8,
  },
  production: { simple: 150, moyen: 400, elabore: 900 },
  floor: 200,
  rightsPct: 20,
  paidPct: 25,
  exclRestrictedPct: 10,
  exclWidePct: 20,
  rushPct: 20,
  rushDays: 7,
  linkPct: 10,
  extraRetouch: 80,
  packPct: 10,
  packMin: 3,
  partnerPct: 15,
  partnerMonths: 3,
  anchorPct: 20,
  minCpm: 10,
};

/** Bornes du coefficient qualité, et ce qu'apporte chaque justification cochée. */
export const COEF_MIN = 0.8;
export const COEF_MAX = 1.5;
export const COEF_STEP = 0.15;

const pos = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * Barème en vigueur : valeurs enregistrées (`pricingRates.ttp`) par-dessus les valeurs de
 * départ. Une valeur illisible ou négative est ignorée (valeur de départ), jamais 0 par erreur.
 */
export function readTarifGrid(raw: unknown): TarifGrid {
  const r = obj(raw);
  const g: TarifGrid = { ...DEFAULT_TARIF_GRID, cpm: { ...DEFAULT_TARIF_GRID.cpm }, production: { ...DEFAULT_TARIF_GRID.production } };
  const cpm = obj(r.cpm);
  for (const k of Object.keys(g.cpm)) {
    const n = pos(cpm[k]);
    if (n !== null && n > 0) g.cpm[k] = n;
  }
  const prod = obj(r.production);
  for (const k of Object.keys(g.production) as ProdLevel[]) {
    const n = pos(prod[k]);
    if (n !== null) g.production[k] = n;
  }
  for (const k of Object.keys(g) as (keyof TarifGrid)[]) {
    if (k === "cpm" || k === "production") continue;
    const n = pos(r[k]);
    if (n !== null) Object.assign(g, { [k]: n });
  }
  return g;
}

/** Valeurs qui diffèrent des valeurs de départ (ce qu'on enregistre). */
export function gridDiff(g: TarifGrid): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const cpm: Record<string, number> = {};
  for (const [k, v] of Object.entries(g.cpm)) if (DEFAULT_TARIF_GRID.cpm[k] !== v) cpm[k] = v;
  if (Object.keys(cpm).length) out.cpm = cpm;
  const prod: Record<string, number> = {};
  for (const [k, v] of Object.entries(g.production)) if (DEFAULT_TARIF_GRID.production[k as ProdLevel] !== v) prod[k] = v;
  if (Object.keys(prod).length) out.production = prod;
  for (const k of Object.keys(g) as (keyof TarifGrid)[]) {
    if (k === "cpm" || k === "production") continue;
    if (g[k] !== DEFAULT_TARIF_GRID[k]) out[k] = g[k];
  }
  return out;
}

/** Plancher d'un créateur (`pricingRates.ttpFloors[id]`), sinon celui du barème. */
export function creatorFloor(floors: unknown, creatorId: string | null | undefined, g: TarifGrid): { value: number; own: boolean } {
  const n = creatorId ? pos(obj(floors)[creatorId]) : null;
  return n !== null && n > 0 ? { value: n, own: true } : { value: g.floor, own: false };
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Format d'une ligne de facture (« Instagram · Reel × 2 », « 1 reel Instagram », « Vidéo
 * TikTok ») et nombre de contenus qu'elle compte. null si le format n'est pas sûr (une
 * « story » sans plateforme, par exemple) : jamais deviné.
 */
export function formatOfLabel(label: string): { key: string; count: number } | null {
  const t = ` ${fold(label)} `;
  const plat =
    /\b(instagram|insta|ig)\b/.test(t) ? "instagram"
    : /\btik ?tok\b/.test(t) ? "tiktok"
    : /\b(youtube|yt)\b/.test(t) ? "youtube"
    : /\b(snapchat|snap)\b/.test(t) ? "snapchat"
    : /\b(twitter|post x)\b/.test(t) ? "x"
    : "";
  let fmt = "";
  if (/\breels?\b/.test(t)) fmt = "reel";
  else if (/\bcarr?ou?sels?\b/.test(t)) fmt = "carrousel";
  else if (/\bstor(y|ies)\b/.test(t)) fmt = "story";
  else if (/\bshorts?\b/.test(t)) fmt = "short";
  else if (/\bintegration\b/.test(t)) fmt = "integration";
  else if (/\bdediee?s?\b/.test(t)) fmt = "dedicated";
  else if (/\bvideos?\b/.test(t)) fmt = plat === "youtube" ? "dedicated" : "video";
  else if (/\bposts?\b/.test(t)) fmt = "post";
  // Un reel est toujours Instagram ; une vidéo sans plateforme n'est pas sûre.
  const p = plat || (fmt === "reel" || fmt === "carrousel" ? "instagram" : "");
  const key = `${p}.${fmt}`;
  if (!p || !fmt || DEFAULT_TARIF_GRID.cpm[key] === undefined) return null;
  // Nombre de contenus : « × 2 », « x2 » ou un nombre en tête (« 2 reels »).
  const times = /[×x]\s*(\d{1,2})\b/.exec(t);
  const lead = /^\s*(\d{1,2})\s+\D/.exec(t);
  const count = Math.max(1, parseInt(times?.[1] ?? lead?.[1] ?? "1", 10) || 1);
  return { key, count };
}

/** Tarif déjà facturé : au créateur pour un format (prix d'un contenu), ou à la marque (total). */
export type PastRate = { amount: number; date: string; ref: string; party: string; ht: boolean };
export type PastRates = { formats: Record<string, PastRate>; brand: PastRate | null };

/** Ce que la marque a payé de plus récent : le plus récent par date, puis par ordre reçu. */
export function latestPast(rows: readonly PastRate[]): PastRate | null {
  let best: PastRate | null = null;
  for (const r of rows) if (!best || (r.date || "") > (best.date || "")) best = r;
  return best;
}

export type InvoiceForPast = { id: string; ref: string | null; party: string | null; amount: string | null; date: string | null; creator: string | null };
export type InvoiceItemForPast = { label: string; qty: number; unit: number };

/** Échéance lisible (« AAAA-MM-JJ »), sinon "" (« — », texte libre). */
const isoOf = (d: string | null | undefined) => (/^\d{4}-\d{2}-\d{2}/.test(d ?? "") ? (d as string).slice(0, 10) : "");
const foldName = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Tarifs déjà facturés comparables, depuis les factures (hors brouillons et annulées) et
 * leurs lignes (`invoiceDetails`) : dernier prix d'un contenu par format pour ce créateur,
 * dernier total HT à cette marque (TTC de la liste si la facture n'a pas de lignes).
 * Factures attendues de la plus récente à la plus ancienne (sans date : l'ordre reçu).
 * Lignes au format incertain ignorées (formatOfLabel).
 */
export function pastRates(
  invoices: readonly (InvoiceForPast & { status?: string | null })[],
  items: Record<string, InvoiceItemForPast[] | undefined>,
  creator: string | null,
  brand: string,
  parseAmount: (s: unknown) => number,
): PastRates & { creatorInvoices: number } {
  const valid = invoices.filter((i) => i.status !== "brouillon" && i.status !== "annulee");
  const formats: Record<string, PastRate> = {};
  const mine = creator ? valid.filter((i) => foldName(i.creator) === foldName(creator)) : [];
  for (const inv of mine) {
    for (const it of items[inv.id] ?? []) {
      const f = formatOfLabel(it.label ?? "");
      if (!f || !(it.unit > 0)) continue;
      // Prix d'UN contenu : la ligne « Reel × 2 » vaut deux contenus.
      const amount = Math.round(it.unit / f.count);
      const row: PastRate = { amount, date: isoOf(inv.date), ref: inv.ref ?? "", party: inv.party ?? "", ht: true };
      const cur = formats[f.key];
      if (!cur || row.date > cur.date) formats[f.key] = row;
    }
  }
  const b = foldName(brand);
  const ofBrand = b
    ? valid
        .filter((i) => foldName(i.party) === b)
        .map((i): PastRate => {
          const its = items[i.id] ?? [];
          const ht = its.reduce((s, it) => s + (it.qty || 0) * (it.unit || 0), 0);
          return ht > 0
            ? { amount: Math.round(ht), date: isoOf(i.date), ref: i.ref ?? "", party: i.party ?? "", ht: true }
            : { amount: Math.round(parseAmount(i.amount)), date: isoOf(i.date), ref: i.ref ?? "", party: i.party ?? "", ht: false };
        })
        .filter((p) => p.amount > 0)
    : [];
  return { formats, brand: latestPast(ofBrand), creatorInvoices: mine.length };
}

const n0 = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 }).replace(/[\u202f\u00a0]/g, " ");
const eur = (n: number) => `${n0(n)} €`;

/** Le barème en texte (outil Claude, doc) : une ligne par valeur. */
export function gridText(g: TarifGrid): string {
  return [
    "CPM (€ HT pour 1000 vues médianes) :",
    ...TARIF_FORMATS.map((f) => `- ${f.label} : ${n0(g.cpm[f.key])} €`),
    `Forfaits de production par contenu : simple ${eur(g.production.simple)}, moyen ${eur(g.production.moyen)}, élaboré ${eur(g.production.elabore)}`,
    `Plancher par contenu : ${eur(g.floor)} par défaut, réglable par créateur`,
    "Commission de l'agence : celle de la fiche du créateur (20 % par défaut), sur le HT, aucune sous 100 € HT",
    `Droits organiques : +${n0(g.rightsPct)} % par tranche de 3 mois`,
    `Paid media, whitelisting, Spark Ads : +${n0(g.paidPct)} % par mois, en ligne séparée`,
    `Exclusivité restreinte (concurrents directs) : +${n0(g.exclRestrictedPct)} % par mois ; large (toute la catégorie) : +${n0(g.exclWidePct)} % par mois`,
    `Urgence (moins de ${n0(g.rushDays)} jours entre le brief et la publication) : +${n0(g.rushPct)} %`,
    `Lien en bio ou code promo : +${n0(g.linkPct)} %`,
    `Retouche au-delà de celles incluses : ${eur(g.extraRetouch)} l'unité`,
    `Package de ${n0(g.packMin)} contenus ou plus : −${n0(g.packPct)} %`,
    `Partenariat de ${n0(g.partnerMonths)} mois ou plus : −${n0(g.partnerPct)} %, seulement si le volume est garanti par écrit`,
    `Ancrage = cible +${n0(g.anchorPct)} %`,
    `CPM effectif minimum : ${eur(g.minCpm)} pour 1000 vues (en dessous, deal trop bas)`,
    `Coefficient qualité : entre ${n0(COEF_MIN)} et ${n0(COEF_MAX)}, 1 = neutre, +${n0(COEF_STEP)} par justification`,
  ].join("\n");
}

/** La méthode complète, valeurs du barème en vigueur comprises (outil Claude et docs/methode-tarif.md). */
export function methodText(g: TarifGrid): string {
  return `# Méthode TARIF de TTP Creators

Code d'entrée : TARIF. Quand l'utilisateur tape « TARIF », appliquer cette méthode pas à pas.
Aucun message à la marque n'est rédigé : on rend un calcul pour Marc.

## Principe : trois couches
1. Données du créateur : chiffres réels (fiche, media kit, factures), jamais de mémoire.
2. Données du deal : ce que la marque demande.
3. Grille de l'agence : le barème ci-dessous (valeurs de départ, à ajuster par l'agence).

## 1. Données du créateur
- Abonnés par plateforme.
- Vues médianes des 10 derniers Reels et TikTok, hors contenus viraux ou boostés. Une moyenne n'est pas une médiane : la signaler « à vérifier ».
- Vues story (une séquence).
- Engagement sur les vues.
- Audience : % France, % femmes, âge principal.
- Crédibilité : athlète, coach, en compétition ou lifestyle.
- Tarifs déjà facturés comparables : au créateur, et à cette marque.
Une donnée manquante est signalée en tête de la réponse. Elle n'est jamais estimée.

## 2. Données du deal
- Livrables (format et nombre).
- Production : simple, moyen ou élaboré (lieu extérieur, déplacement, matériel, personnes à filmer).
- Retouches incluses et retouches en plus.
- Délai entre le brief et la publication.
- Marque déjà cliente ? Dernier tarif facturé à cette marque.
- Droits organiques (tranches de 3 mois), paid media (mois), exclusivité restreinte ou large (mois).
- Lien en bio ou code promo.
- Partenariat de ${n0(g.partnerMonths)} mois ou plus, et volume garanti par écrit.

## 3. Grille de l'agence (HT)
${gridText(g)}

## 4. Calcul, contenu par contenu
1. Prix média = vues médianes ÷ 1000 × CPM du format.
2. Coefficient qualité entre ${n0(COEF_MIN)} et ${n0(COEF_MAX)} : 1 sans justification, +${n0(COEF_STEP)} par justification vérifiée (audience cœur de cible : France et femmes à 60 % ou plus ; expertise crédible : athlète, coach, en compétition ; engagement fort sur les vues). Toujours dire lesquelles.
3. Prix de base = prix média × coefficient + forfait de production. Jamais sous le plancher du créateur.
4. Majorations et remises : en % du prix de base, additionnées. Paid media sur une ligne séparée.
5. Cible = bases + majorations − remises + retouches en plus + paid media.
6. Ancrage = cible +${n0(g.anchorPct)} %. Plancher = bases − remises + retouches en plus (sans majorations ni paid media), jamais sous le plancher du créateur.

## 5. Majorations et remises
- Droits organiques : +${n0(g.rightsPct)} % par tranche de 3 mois.
- Exclusivité : restreinte +${n0(g.exclRestrictedPct)} % par mois, large +${n0(g.exclWidePct)} % par mois.
- Urgence (moins de ${n0(g.rushDays)} jours) : +${n0(g.rushPct)} %.
- Lien en bio ou code promo : +${n0(g.linkPct)} %.
- Paid media, whitelisting, Spark Ads : +${n0(g.paidPct)} % du prix de base par mois, ligne séparée.
- Package de ${n0(g.packMin)} contenus ou plus : −${n0(g.packPct)} %.
- Partenariat de ${n0(g.partnerMonths)} mois ou plus : −${n0(g.partnerPct)} %, seulement avec le volume garanti par écrit.

## 6. Sortie
1. Données manquantes, en tête.
2. Tableau par livrable : vues, CPM, coefficient, base, majorations, total HT.
3. Ancrage, Cible, Plancher.
4. CPM effectif (cible hors paid media et retouches ÷ vues attendues × 1000), avec un argument neutre : aucun chiffre de marché inventé.
5. Une contrepartie pour chaque palier de baisse : ancrage → cible contre le brief accepté tel quel et un paiement à 30 jours ; sous la cible, retirer une majoration (la marque renonce au droit correspondant), jamais baisser sans contrepartie.
6. Répartition créateur / agence (commission de la fiche, sur le HT).
7. Chaque montant porte la mention « À VÉRIFIER ».

## 7. Garde-fous
- Précédent tarifaire cassé : alerte si le prix est sous le dernier tarif facturé à cette marque, ou pour ce format.
- Deal trop bas : alerte si le CPM effectif est sous ${eur(g.minCpm)}.
- Aucun prix transmis à une marque sans validation de Marc.
- Aucun chiffre de mémoire.
`;
}

type KitPlatform = { key?: string; followers?: unknown; er?: unknown; avgViews?: unknown; avgStoryViews?: unknown };
type KitRow = { label?: string; name?: string; pct?: unknown };
/** Colonnes de `creators` lues par l'outil Claude (select « * »). */
export type CreatorForTarif = {
  id?: string;
  name?: string | null;
  niche?: string | null;
  platform?: string | null;
  followers?: string | null;
  er?: string | null;
  commission?: string | null;
  mediakit?: { platforms?: KitPlatform[]; audience?: { age?: KitRow[]; gender?: { femmes?: unknown; hommes?: unknown }; pays?: KitRow[] } } | null;
  ig?: { followers?: unknown; er?: unknown; link?: unknown; insights?: { reelViews?: unknown } | null } | null;
  tt?: { followers?: unknown; avgViews?: unknown; er?: unknown; link?: unknown } | null;
  yt?: { subscribers?: unknown; avgViews?: unknown; avgShortViews?: unknown; er?: unknown; link?: unknown } | null;
};

const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "" && String(v).trim() !== "0";
const val = (v: unknown, suffix = "") => (has(v) ? `${String(v).trim()}${suffix}` : "MANQUANT");
const rowsText = (rows: KitRow[] | undefined) =>
  (rows ?? []).filter((r) => (r.label || r.name) && has(r.pct)).map((r) => `${r.label ?? r.name} ${String(r.pct).replace(/\s*%$/, "")} %`).join(", ");

/**
 * Chiffres connus d'un créateur pour la méthode (outil Claude) : ce qui manque est écrit
 * « MANQUANT », une moyenne est marquée « moyenne, pas médiane : à vérifier ». Rien d'estimé.
 */
export function creatorTarifText(c: CreatorForTarif, floor: { value: number; own: boolean }): string {
  const out: string[] = [
    `Niche : ${val(c.niche)} · plateforme principale : ${val(c.platform)}`,
    `Fiche : ${val(c.followers)} abonnés · engagement ${val(c.er)}`,
    `Commission de l'agence : ${has(c.commission) ? String(c.commission).trim() : "20 % (défaut, pas sur la fiche)"}`,
    `Plancher par contenu : ${eur(floor.value)}${floor.own ? " (réglé pour ce créateur)" : " (défaut du barème)"}`,
    "Crédibilité (athlète, coach, en compétition, lifestyle) : pas dans la fiche, à demander.",
  ];
  const kit = c.mediakit?.platforms ?? [];
  if (kit.length) {
    out.push("Media kit, par plateforme :");
    for (const p of kit) {
      out.push(`- ${val(p.key)} : ${val(p.followers)} abonnés · engagement sur les vues ${val(p.er, " %")} · vues ${has(p.avgViews) ? `${p.avgViews} (moyenne, pas médiane : à vérifier)` : "MANQUANT"} · vues story ${val(p.avgStoryViews)}`);
    }
  } else out.push("Media kit : aucune plateforme renseignée.");
  if (c.ig && has(c.ig.followers)) out.push(`Instagram (relevé automatique) : ${c.ig.followers} abonnés${has(c.ig.er) ? ` · engagement ${c.ig.er} % sur les abonnés` : ""}${c.ig.link && has(c.ig.insights?.reelViews) ? ` · vues des derniers reels ${c.ig.insights?.reelViews} (moyenne, pas médiane : à vérifier)` : ""}`);
  if (c.tt?.link && has(c.tt.followers)) out.push(`TikTok connecté : ${c.tt.followers} abonnés${has(c.tt.avgViews) ? ` · vues ${c.tt.avgViews} (moyenne des dernières vidéos, pas médiane : à vérifier)` : ""}${has(c.tt.er) ? ` · engagement ${c.tt.er} % sur les vues` : ""}`);
  if (c.yt?.link && (has(c.yt.subscribers) || has(c.yt.avgViews))) out.push(`YouTube connecté : ${val(c.yt.subscribers)} abonnés${has(c.yt.avgViews) ? ` · vues ${c.yt.avgViews} (moyenne)` : ""}${has(c.yt.avgShortViews) ? ` · vues Shorts ${c.yt.avgShortViews} (moyenne)` : ""}`);
  const a = c.mediakit?.audience;
  const fr = (a?.pays ?? []).find((r) => /^(fr|france)\b/i.test(String(r.name ?? "").trim()));
  out.push(`Audience : France ${fr && has(fr.pct) ? `${String(fr.pct).replace(/\s*%$/, "")} %` : "MANQUANT"} · femmes ${has(a?.gender?.femmes) ? `${String(a?.gender?.femmes).replace(/\s*%$/, "")} %` : "MANQUANT"} · âges ${rowsText(a?.age) || "MANQUANT"}`);
  return out.join("\n");
}

/** Tarifs déjà facturés (outil Claude) : prix d'un contenu par format, dernier total à la marque. */
export function pastRatesText(p: PastRates, brand: string): string {
  const out: string[] = [];
  const keys = Object.keys(p.formats);
  if (keys.length) {
    out.push("Dernier prix facturé d'un contenu, par format (HT) :");
    for (const f of TARIF_FORMATS) {
      const r = p.formats[f.key];
      if (r) out.push(`- ${f.label} : ${eur(r.amount)} · ${r.party || "marque ?"} · facture ${r.ref || "?"}${r.date ? ` · échéance ${r.date}` : ""}`);
    }
  } else out.push("Aucun prix par format retrouvé dans les factures de ce créateur.");
  if (brand) {
    out.push(p.brand
      ? `Dernier total facturé à ${p.brand.party} : ${eur(p.brand.amount)} ${p.brand.ht ? "HT" : "TTC (facture sans lignes)"} · facture ${p.brand.ref || "?"}${p.brand.date ? ` · échéance ${p.brand.date}` : ""}`
      : `Aucune facture retrouvée pour la marque « ${brand} » : nouvelle cliente, ou nom écrit autrement.`);
  }
  return out.join("\n");
}
