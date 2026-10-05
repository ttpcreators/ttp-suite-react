/** Helpers de séries temporelles partagés (agrégation mensuelle du CA, variation, libellés). */

const MONTHS_FR = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];

/** "dd/mm", "dd/mm/yyyy" ou "YYYY-MM-DD" → clé de mois "YYYY-MM" (ou null). */
export function invMonthKey(s: string | null): string | null {
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-\d{2}/.exec(s.trim());
  if (iso) return `${iso[1]}-${iso[2]}`;
  const dm = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s.trim());
  if (dm) {
    const mm = dm[2].padStart(2, "0");
    let yy = dm[3] ?? String(new Date().getFullYear());
    if (yy.length === 2) yy = "20" + yy;
    return `${yy}-${mm}`;
  }
  return null;
}

/** Tous les mois entre deux clés "YYYY-MM" inclus. */
export function monthsBetween(start: string, end: string): string[] {
  const [ys, ms] = start.split("-").map(Number);
  const [ye, me] = end.split("-").map(Number);
  const out: string[] = [];
  let y = ys;
  let m = ms;
  for (let guard = 0; guard < 120 && (y < ye || (y === ye && m <= me)); guard++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Variation % du dernier point vs l'avant-dernier (null si non calculable honnêtement). */
export function momDelta(series: number[]): number | null {
  if (series.length < 2) return null;
  const prev = series[series.length - 2];
  const last = series[series.length - 1];
  if (prev <= 0) return null;
  return ((last - prev) / prev) * 100;
}

/** Clé "YYYY-MM" → libellé de mois FR abrégé. */
export function monthLabel(key: string): string {
  const [, m] = key.split("-").map(Number);
  return MONTHS_FR[m - 1] ?? key;
}

/**
 * Grands nombres, format voulu par Marc (2026-10-05) : 1 300 → « 1,3K », 45 800 → « 45,8K »,
 * 919 000 → « 919K », 1 000 000 → « 1M », 2 400 000 000 → « 2,4Md ». Une décimale sous 100,
 * nombre rond au-delà, unité collée. Sous 1 000 : le nombre tel quel.
 */
export function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  const units: [number, string][] = [[1e9, "Md"], [1e6, "M"], [1e3, "K"]];
  for (let i = 0; i < units.length; i++) {
    const [div, u] = units[i];
    if (a < div && Math.round(a) < div) continue;
    const x = a / div;
    const r = x >= 100 ? Math.round(x) : Math.round(x * 10) / 10;
    // 999 960 → « 1M » (et non « 1000K »).
    if (r >= 1000 && i > 0) return sign + fmtUnit(a / units[i - 1][0]) + units[i - 1][1];
    return sign + fmtUnit(x) + u;
  }
  return sign + String(Math.round(a));
}
function fmtUnit(x: number): string {
  const r = x >= 100 ? Math.round(x) : Math.round(x * 10) / 10;
  return String(r).replace(".", ",");
}
