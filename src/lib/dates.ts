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
