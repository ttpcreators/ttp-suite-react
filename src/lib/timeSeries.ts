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

/** Nombre → format compact (1.2K, 3.4M). */
export function fmtCompact(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(Math.round(n));
}
