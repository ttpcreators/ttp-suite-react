/**
 * Helpers de date partagés — les échéances (`due`) sont saisies via un
 * `<input type="date">` (calendrier natif) qui travaille en "YYYY-MM-DD",
 * mais d'anciennes données peuvent être en texte libre "jj/mm/aaaa".
 */

/** Texte libre ("03/07/2026", "2026-07-03", "—", "") → "YYYY-MM-DD" pour un `<input type="date">`, ou "" si vide/illisible. */
export function toISODate(s: unknown): string {
  const t = String(s ?? "").trim();
  if (!t || t === "—") return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(t);
  if (!fr) return "";
  const y = fr[3].length === 2 ? "20" + fr[3] : fr[3];
  return `${y}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}`;
}

/** Date LOCALE du jour en "YYYY-MM-DD" — pas d'UTC (évite le décalage de date en soirée). */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** N'importe quel format → "jj/mm/aaaa" pour l'affichage. "—" si vide ; renvoie tel quel si déjà libre. */
export function frDate(s: unknown): string {
  const t = String(s ?? "").trim();
  if (!t || t === "—") return "—";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return t;
}

/*
 * FORMATS D'AFFICHAGE : un seul format par type d'information, partout dans l'app
 * (règles de Marc, 2026-10-22). Ne pas en inventer d'autre dans une page.
 *   • une date   → « 21 oct. » (année ajoutée hors de l'année en cours : « 21 oct. 2025 ») ;
 *   • une durée  → « 23 j », « 4 mois », « 1 an » ;
 *   • l'heure n'est ajoutée (« 21 oct. à 18:44 ») que là où elle est l'information
 *     (rendez-vous, publication programmée, journal technique) ;
 *   • un état vide → un seul mot, « Aucun », ou un tiret « — ».
 * Restent à part : les documents (PDF, contrats : date longue), les mois (« octobre 2026 »)
 * et les calendriers.
 */

/** Tiret des valeurs vides (colonne, champ de fiche). */
export const EMPTY = "—";

/** Valeur de date (ISO, « AAAA-MM-JJ », horodatage, Date) → Date, ou null si illisible. */
function asDate(v: unknown): Date | null {
  if (v == null || v === "" || v === "—") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") return new Date(v);
  const s = String(v).trim();
  // « AAAA-MM-JJ » seul = jour local (pas minuit UTC, qui recule d'un jour à l'ouest).
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]), 12) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Une date : « 21 oct. », ou « 21 oct. 2025 » hors de l'année en cours. "" si illisible. */
export function fmtDay(v: unknown, locale = "fr-FR", now: Date = new Date()): string {
  const d = asDate(v);
  if (!d) return "";
  const year = d.getFullYear() !== now.getFullYear();
  return d.toLocaleDateString(locale, { day: "numeric", month: "short", ...(year ? { year: "numeric" as const } : {}) });
}

/** Une date et l'heure, seulement quand l'heure est l'information : « 21 oct. à 18:44 ». */
export function fmtDayTime(v: unknown, locale = "fr-FR", now: Date = new Date()): string {
  const d = asDate(v);
  if (!d) return "";
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return locale.startsWith("fr") ? `${fmtDay(d, locale, now)} à ${time}` : `${fmtDay(d, locale, now)}, ${time}`;
}

/** Une durée en jours pleins : « 0 j », « 23 j », « 4 mois », « 1 an », « 2 ans ». */
export function fmtAgoDays(days: number): string {
  const n = Math.max(0, Math.floor(days));
  if (n < 30) return `${n} j`;
  if (n < 365) return `${Math.max(1, Math.round(n / 30))} mois`;
  const y = Math.floor(n / 365);
  return `${y} an${y > 1 ? "s" : ""}`;
}

/** Durée écoulée depuis une date (même format que `fmtAgoDays`). "" si illisible. */
export function fmtAgoSince(v: unknown, now: number = Date.now()): string {
  const d = asDate(v);
  return d ? fmtAgoDays((now - d.getTime()) / 86400000) : "";
}
