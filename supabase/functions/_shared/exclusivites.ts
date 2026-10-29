// ============================================================================
// _shared/exclusivites.ts : suivi des exclusivités des créateurs (logique PURE).
// ----------------------------------------------------------------------------
// Partagé par l'app (page Exclusivités, choix d'un créateur en prospection, en
// collab, en réponse à une marque) et par le connecteur Claude (ttp-mcp), pour
// que personne ne propose un créateur engagé en exclusivité avec un concurrent.
// Données : blob agence, clé `exclusivites` (liste d'objets à id). Testé par
// exclusivites.test.ts. Lecture des contrats (PDF ou contrats faits dans l'app) :
// règles fixes, sans IA (même choix que les tâches tirées des mails).
// ============================================================================

export type Exclusivite = {
  id: string;
  /** Nom du créateur tel qu'au roster. */
  creator: string;
  /** Marque avec qui l'exclusivité est signée. */
  brand: string;
  /** Secteur ou catégorie interdite (« boissons énergisantes », « même catégorie de produits »). */
  scope: string;
  /** Marques concurrentes citées par le contrat (interdites pendant la période). */
  competitors: string[];
  /** AAAA-MM-JJ. */
  start: string;
  /** AAAA-MM-JJ, null = sans date de fin connue. */
  end: string | null;
  /** Points clés de la collab gardés en mémoire (droits, livrables, montant, délais…). */
  points: string[];
  collabId?: string | null;
  source: "manuel" | "contrat" | "pdf";
  /** Référence du contrat de l'app, ou nom du PDF lu. */
  contractRef?: string | null;
  /** Chemin du PDF dans le bucket documents. */
  docPath?: string | null;
  createdAt: number;
};

/** Minuscules, sans accents ni ponctuation, espaces resserrés. */
export const foldName = (s: string | null | undefined) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’‘]/g, "'").toLowerCase().replace(/[^a-z0-9']+/g, " ").trim();

const sameBrand = (a: string, b: string) => {
  const x = foldName(a).replace(/ /g, "");
  const y = foldName(b).replace(/ /g, "");
  return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x))));
};

/** Liste lue dans le blob (valeurs bizarres écartées). */
export function readExclusivites(raw: unknown): Exclusivite[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Exclusivite[])
    .filter((e) => e && typeof e === "object" && typeof e.id === "string" && typeof e.creator === "string" && typeof e.brand === "string")
    .map((e) => ({
      ...e,
      scope: typeof e.scope === "string" ? e.scope : "",
      competitors: Array.isArray(e.competitors) ? e.competitors.filter((c) => typeof c === "string" && c.trim()) : [],
      points: Array.isArray(e.points) ? e.points.filter((p) => typeof p === "string" && p.trim()) : [],
      start: typeof e.start === "string" ? e.start.slice(0, 10) : "",
      end: typeof e.end === "string" && e.end ? e.end.slice(0, 10) : null,
    }));
}

export type ExcluState = "a_venir" | "en_cours" | "terminee";

/** État à une date (AAAA-MM-JJ). */
export function excluState(e: Pick<Exclusivite, "start" | "end">, today: string): ExcluState {
  if (e.start && e.start > today) return "a_venir";
  if (e.end && e.end < today) return "terminee";
  return "en_cours";
}

/** Jours restants (null sans date de fin). */
export function daysLeft(e: Pick<Exclusivite, "end">, today: string): number | null {
  if (!e.end) return null;
  return Math.round((Date.parse(`${e.end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}

/**
 * Une marque `brand` tombe-t-elle sous cette exclusivité ? Oui si elle est citée parmi les
 * concurrents, ou si l'un de ses secteurs (`brandTags` : étiquette de la fiche contact,
 * niche…) correspond au secteur interdit. Jamais pour la marque de l'exclusivité elle-même.
 */
export function hitsBrand(e: Exclusivite, brand: string, brandTags: readonly string[] = []): boolean {
  if (!brand.trim() || sameBrand(e.brand, brand)) return false;
  if (e.competitors.some((c) => sameBrand(c, brand))) return true;
  const scope = foldName(e.scope);
  if (!scope) return false;
  return brandTags.some((t) => {
    const f = foldName(t);
    return f.length >= 4 && (scope.includes(f) || f.includes(scope));
  });
}

/** Exclusivités en cours ou à venir d'un créateur qui bloquent cette marque. */
export function conflictsFor(list: readonly Exclusivite[], creator: string, brand: string, today: string, brandTags: readonly string[] = []): Exclusivite[] {
  return list.filter((e) => foldName(e.creator) === foldName(creator) && excluState(e, today) !== "terminee" && hitsBrand(e, brand, brandTags));
}

/** Créateurs bloqués pour une marque : nom (minuscules) → raison courte (« Exclu Nike · 12 déc. »). */
export function blockedCreators(
  list: readonly Exclusivite[],
  brand: string,
  today: string,
  brandTags: readonly string[] = [],
  fmtDate: (iso: string) => string = (d) => d,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of list) {
    if (excluState(e, today) === "terminee" || !hitsBrand(e, brand, brandTags)) continue;
    const k = e.creator.trim().toLowerCase();
    if (!out.has(k)) out.set(k, `Exclu ${e.brand}${e.end ? ` · ${fmtDate(e.end)}` : ""}`);
  }
  return out;
}

/** Créateurs en exclusivité EN COURS (toutes marques) : pour prévenir dans les listes. */
export function activeByCreator(list: readonly Exclusivite[], today: string): Map<string, Exclusivite[]> {
  const out = new Map<string, Exclusivite[]>();
  for (const e of list) {
    if (excluState(e, today) !== "en_cours") continue;
    const k = e.creator.trim().toLowerCase();
    out.set(k, [...(out.get(k) ?? []), e]);
  }
  return out;
}

/** Phrase pour Claude / un mail : « Léna : exclu Nike jusqu'au 2026-12-12 (secteur sport, concurrents Adidas, Puma). » */
export function excluLine(e: Exclusivite): string {
  const bits = [e.scope && `secteur ${e.scope}`, e.competitors.length && `concurrents ${e.competitors.join(", ")}`].filter(Boolean);
  return `exclu ${e.brand}${e.end ? ` jusqu'au ${e.end}` : " (sans date de fin)"}${bits.length ? ` (${bits.join(", ")})` : ""}`;
}

// ── Dates ─────────────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");
export const isoOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export function addToIso(iso: string, n: number, unit: "jours" | "mois"): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (unit === "jours") d.setUTCDate(d.getUTCDate() + n);
  else {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return isoOf(d);
}

// ── Contrats faits dans l'app (Contrats → Marque × Créateur) ─────────────────
/** Réglage « Exclusivité » du contrat de l'app → brouillon de suivi (null si « Aucune »). */
export function fromAppContract(c: {
  id: string; ctName: string; brand: string; ref?: string; ts: number;
  form?: { exclScope?: string; excl?: boolean; duration?: string; deliverables?: string; value?: string; rights?: string; rightsDuration?: string };
}, months?: number | null): Omit<Exclusivite, "id" | "createdAt"> | null {
  const f = c.form ?? {};
  const scope = f.exclScope ?? (f.excl ? "cat30" : "non");
  if (!scope || scope === "non") return null;
  const start = isoOf(new Date(c.ts));
  const end = scope === "cat30" ? addToIso(start, 30, "jours") : scope === "cat90" ? addToIso(start, 90, "jours") : months ? addToIso(start, months, "mois") : null;
  const points = [
    f.deliverables && `Livrables : ${f.deliverables}`,
    f.value && `Montant : ${f.value}`,
    f.rightsDuration && f.rights && f.rights !== "aucun" ? `Droits d'usage : ${f.rights}, ${f.rightsDuration}` : "",
  ].filter((x): x is string => !!x);
  return {
    creator: c.ctName, brand: c.brand,
    scope: scope === "total" ? "même secteur d'activité" : "même catégorie de produits",
    competitors: [], start, end, points, source: "contrat", contractRef: c.ref ?? null, docPath: null, collabId: null,
  };
}

// ── Lecture d'un contrat PDF (texte extrait), sans IA ────────────────────────
export type ContractReading = {
  creator: string | null;
  brand: string | null;
  exclusivity: { quote: string; scope: string; competitors: string[]; start: string | null; end: string | null } | null;
  points: string[];
};

const MONTHS: Record<string, number> = {
  janvier: 1, january: 1, fevrier: 2, february: 2, mars: 3, march: 3, avril: 4, april: 4, mai: 5, may: 5, juin: 6, june: 6,
  juillet: 7, july: 7, aout: 8, august: 8, septembre: 9, september: 9, octobre: 10, october: 10, novembre: 11, november: 11,
  decembre: 12, december: 12,
};
/** Première date écrite (« 12 novembre 2026 », « 12/11/2026 », « 2026-11-12 ») → AAAA-MM-JJ. */
export function firstDate(text: string): string | null {
  const t = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const iso = /\b(20\d\d)-(\d{1,2})-(\d{1,2})\b/.exec(t);
  if (iso) return `${iso[1]}-${pad(+iso[2])}-${pad(+iso[3])}`;
  const fr = /\b(\d{1,2})(?:er)?\s+(janvier|january|fevrier|february|mars|march|avril|april|mai|may|juin|june|juillet|july|aout|august|septembre|september|octobre|october|novembre|november|decembre|december)\s+(20\d\d)\b/.exec(t);
  if (fr) return `${fr[3]}-${pad(MONTHS[fr[2]])}-${pad(+fr[1])}`;
  const num = /\b(\d{1,2})[/.](\d{1,2})[/.](20\d\d)\b/.exec(t);
  if (num && +num[2] <= 12) return `${num[3]}-${pad(+num[2])}-${pad(+num[1])}`;
  return null;
}

const NUMBERS: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, douze: 12, quinze: 15, trente: 30, soixante: 60, quatrevingt: 80, quatrevingtdix: 90, one: 1, two: 2, three: 3, four: 4, twelve: 12, thirty: 30, sixty: 60, ninety: 90 };

/** Durée écrite (« 3 mois », « trente (30) jours », « 6 months ») → { n, unit }. */
export function findDuration(text: string): { n: number; unit: "jours" | "mois" } | null {
  const t = foldName(text).replace(/quatre vingt dix/g, "quatrevingtdix").replace(/quatre vingt/g, "quatrevingt");
  const m = /\b(\d{1,3}|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|douze|quinze|trente|soixante|quatrevingt|quatrevingtdix|one|two|three|four|twelve|thirty|sixty|ninety)(?: \d{1,3})? (jours?|days?|mois|months?|semaines?|weeks?|ans?|annees?|years?)\b/.exec(t);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBERS[m[1]] ?? 0;
  if (!n) return null;
  const u = m[2];
  if (/^(semaine|week)/.test(u)) return { n: n * 7, unit: "jours" };
  if (/^(an|annee|year)/.test(u)) return { n: n * 12, unit: "mois" };
  return { n, unit: /^(mois|month)/.test(u) ? "mois" : "jours" };
}

const EXCLU_RE = /(exclusivit|exclusive|exclusivity|non[- ]?concurren|non[- ]?compet|s'interdit|s'engage a ne pas|shall not|must not|competing|concurrent)/;

/** Marques citées après « notamment », « tels que », « such as », « à savoir »… */
function listedBrands(sentence: string): string[] {
  const m = /(?:notamment|tels? que|telles? que|such as|including|a savoir|comme|par exemple|e\.g\.)\s*:?\s*([^.;]+)/i.exec(sentence.normalize("NFD").replace(/[̀-ͯ]/g, ""));
  if (!m) return [];
  return m[1]
    .split(/,|\bet\b|\band\b|\bou\b|\bor\b|\//i)
    .map((s) => s.replace(/[()«»"“”]/g, "").trim())
    .filter((s) => s.length >= 2 && s.length <= 30 && /^[A-Z0-9]/.test(s));
}

/** Secteur écrit après « secteur », « catégorie », « marques de/du »… */
function sectorOf(sentence: string): string {
  const f = foldName(sentence);
  const m = /\b(?:secteur|categorie|category|domaine|industry|sector|segment|univers)(?: d'activite)?(?: de| des| du| d'| of| :)?\s+(?:la |le |les |l')?([a-z0-9' ]{3,60}?)(?=\s+(?:pendant|pour|durant|a compter|des|jusqu|during|for|until|from|sur|,)|$)/.exec(f);
  if (m) return m[1].trim();
  const m2 = /\bmarques? (?:concurrentes? )?(?:de|du|des|d'|dans le|dans la|of)\s+(?:la |le |les |l')?([a-z0-9' ]{3,40}?)(?=\s+(?:pendant|pour|durant|a compter|des|jusqu|during|for|until|,)|$)/.exec(f);
  return m2 ? m2[1].trim() : "";
}

/**
 * Lit le texte d'un contrat : créateur et marque (cherchés parmi les noms connus), clause
 * d'exclusivité (secteur, concurrents, début, fin) et points clés (montant, livrables,
 * droits d'usage, délai de paiement, territoire, résiliation). `signed` = date du contrat
 * si connue (début par défaut).
 */
export function readContract(text: string, known: { creators: readonly string[]; brands: readonly string[] }, today: string): ContractReading {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = clean.split(/(?<=[.;!?])\s+(?=[A-ZÀ-ÖØ-Ý0-9«"(•\-–])|\s+(?=(?:Art(?:icle|\.)\s*\d+))/).map((s) => s.trim()).filter((s) => s.length > 8);
  const f = ` ${foldName(clean)} `;
  const findKnown = (names: readonly string[]) =>
    [...names].sort((a, b) => b.length - a.length).find((n) => {
      const k = foldName(n);
      if (k.length < 3) return false;
      return f.includes(` ${k} `) || f.includes(` ${k.split(" ")[0]} ${k.split(" ").slice(-1)[0]} `);
    }) ?? null;
  const creator = findKnown(known.creators);
  const brand = findKnown(known.brands);

  // Exclusivité : la première phrase qui en parle (la plus précise : avec une durée si possible).
  const excl = sentences.filter((s) => EXCLU_RE.test(foldName(s)));
  let exclusivity: ContractReading["exclusivity"] = null;
  if (excl.length) {
    const best = excl.find((s) => findDuration(s)) ?? excl[0];
    const around = excl.join(" ");
    const signedAt = firstDate(clean);
    const start = firstDate(best) ?? signedAt ?? today;
    const dur = findDuration(best) ?? findDuration(around);
    const endWritten = /jusqu'?(?:au|a)|until|ending/.test(foldName(best)) ? firstDate(best.split(/jusqu|until|ending/i).slice(1).join(" ")) : null;
    exclusivity = {
      quote: best.length > 400 ? `${best.slice(0, 399)}…` : best,
      scope: sectorOf(best) || sectorOf(around) || (/(meme categorie|same category)/.test(foldName(around)) ? "même catégorie de produits" : ""),
      competitors: [...new Set(excl.flatMap(listedBrands))].slice(0, 12),
      start,
      end: endWritten ?? (dur ? addToIso(start, dur.n, dur.unit) : null),
    };
  }

  // Points clés : une phrase courte par sujet.
  // Minuscules sans accents, symboles gardés (« € ») ; une vraie phrase plutôt qu'un titre d'article.
  const low = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’‘]/g, "'").toLowerCase();
  const pick = (re: RegExp, label: string) => {
    const hits = sentences.filter((x) => re.test(low(x)));
    const s = hits.find((x) => x.length >= 40) ?? hits[0];
    if (!s) return null;
    const short = s.length > 180 ? `${s.slice(0, 179)}…` : s;
    return `${label} : ${short}`;
  };
  const points = [
    pick(/(\d[\d  .,]*\s?(€|eur\b|euros\b)|(remuneration|montant|prix|fee|compensation)[^.]{0,60}\d)/, "Montant"),
    pick(/\b(\d+|un|une|deux|trois)\s+(reels?|stor(y|ies)|posts?|videos?|tiktoks?|publications?|contenus?|shorts?)\b/, "Livrables"),
    pick(/\b(droits? d'(usage|utilisation|exploitation)|cession|usage rights|paid (media|ads)|whitelisting|ads)\b/, "Droits d'usage"),
    pick(/\b(paiement|payment|payable|regle(ment)?|facture)[^.]{0,80}\b(\d+)\s*(jours|days)\b/, "Paiement"),
    pick(/\b(territoire|territory|monde entier|worldwide|union europeenne)\b/, "Territoire"),
    pick(/\b(resiliation|termination|resilier)\b/, "Résiliation"),
  ].filter((x): x is string => !!x);

  return { creator, brand, exclusivity, points };
}
