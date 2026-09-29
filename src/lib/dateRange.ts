/**
 * Plages de dates (sélecteur de période) : calculs purs, testés.
 * Une plage = deux jours ISO « aaaa-mm-jj », bornes INCLUSES (du 1er au 30 = 30 jours).
 * Tolère en entrée les dates ISO (« 2026-07-31… ») et françaises (« 31/07/2026 »).
 */

export type DateRange = { from: string; to: string };

export type RangePreset = { id: string; label: string; range: DateRange | null; group?: string };

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** Jour local → « aaaa-mm-jj ». */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** « aaaa-mm-jj » → Date locale à minuit. */
export function parseDay(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(s: string, n: number): string {
  const d = parseDay(s);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

/** Date quelconque (ISO, FR, timestamp) → « aaaa-mm-jj », ou "" si illisible. */
export function toDayKey(date: string | number | null | undefined): string {
  if (date == null || date === "") return "";
  if (typeof date === "number") return Number.isFinite(date) ? isoDay(new Date(date)) : "";
  const s = String(date).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return "";
}

/** Nombre de jours de la plage (bornes incluses). */
export function rangeDays(r: DateRange): number {
  return Math.round((parseDay(r.to).getTime() - parseDay(r.from).getTime()) / 86400000) + 1;
}

/** Bornes en millisecondes : [début du 1er jour, début du lendemain du dernier jour). */
export function rangeBounds(r: DateRange): [number, number] {
  return [parseDay(r.from).getTime(), parseDay(addDays(r.to, 1)).getTime()];
}

/** Plage de même durée, juste avant (pour les comparaisons « vs période préc. »). */
export function previousRange(r: DateRange): DateRange {
  const n = rangeDays(r);
  return { from: addDays(r.from, -n), to: addDays(r.from, -1) };
}

/** Une date tombe-t-elle dans la plage ? (null = toutes les dates) */
export function inRange(date: string | number | null | undefined, r: DateRange | null): boolean {
  if (!r) return true;
  const k = toDayKey(date);
  return !!k && k >= r.from && k <= r.to;
}

/** Plage d'un mois entier (« aaaa-mm »). */
export function monthRange(ym: string): DateRange {
  const [y, m] = ym.split("-").map(Number);
  return { from: isoDay(new Date(y, m - 1, 1)), to: isoDay(new Date(y, m, 0)) };
}

/** La plage couvre-t-elle exactement un mois civil ? → « aaaa-mm », sinon null. */
export function fullMonthOf(r: DateRange): string | null {
  const ym = r.from.slice(0, 7);
  const mr = monthRange(ym);
  return mr.from === r.from && mr.to === r.to ? ym : null;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function shortDay(s: string, withYear: boolean): string {
  return parseDay(s).toLocaleDateString("fr-FR", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
}

/** Libellé lisible : « Juillet 2026 », « Année 2026 », « 12 sept. 2026 » ou « 30 août – 29 sept. 2026 ». */
export function rangeLabel(r: DateRange): string {
  const ym = fullMonthOf(r);
  if (ym) {
    const [y, m] = ym.split("-").map(Number);
    return `${cap(MONTHS[m - 1])} ${y}`;
  }
  const y = r.from.slice(0, 4);
  if (r.from === `${y}-01-01` && r.to === `${y}-12-31`) return `Année ${y}`;
  if (r.from === r.to) return shortDay(r.from, true);
  const sameYear = r.from.slice(0, 4) === r.to.slice(0, 4);
  return `${shortDay(r.from, !sameYear)} – ${shortDay(r.to, true)}`;
}

/** Raccourcis standard (calculés à partir d'aujourd'hui). */
export function presetRange(id: string, today: Date = new Date()): DateRange | null {
  const t = isoDay(today);
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (id) {
    case "7j":
      return { from: addDays(t, -6), to: t };
    case "30j":
      return { from: addDays(t, -29), to: t };
    case "90j":
      return { from: addDays(t, -89), to: t };
    case "12m":
      return { from: addDays(t, -364), to: t };
    case "mois":
      return { from: isoDay(new Date(y, m, 1)), to: t };
    case "mois-1":
      return { from: isoDay(new Date(y, m - 1, 1)), to: isoDay(new Date(y, m, 0)) };
    case "annee":
      return { from: `${y}-01-01`, to: t };
    default:
      return null;
  }
}

const PRESET_LABELS: Record<string, string> = {
  "7j": "7 derniers jours",
  "30j": "30 derniers jours",
  "90j": "90 derniers jours",
  "12m": "12 derniers mois",
  mois: "Ce mois-ci",
  "mois-1": "Mois dernier",
  annee: "Cette année",
};

/** Liste de raccourcis prêts à passer au sélecteur. */
export function standardPresets(ids: string[], today: Date = new Date()): RangePreset[] {
  return ids.map((id) => ({ id, label: PRESET_LABELS[id] ?? id, range: presetRange(id, today) }));
}

export function sameRange(a: DateRange | null, b: DateRange | null): boolean {
  if (!a || !b) return a === b;
  return a.from === b.from && a.to === b.to;
}
