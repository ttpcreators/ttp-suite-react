import { cn } from "@/lib/utils";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { fullMonthOf, inRange, monthRange, standardPresets, type DateRange, type RangePreset } from "@/lib/dateRange";

/**
 * Filtre de PÉRIODE réutilisable, même look partout : le sélecteur de dates
 * (raccourcis, mois présents dans les données, calendrier « du … au … »).
 * Valeur texte : "" (toutes) · "aaaa-mm" (un mois) · "aaaa-mm-jj_aaaa-mm-jj" (plage libre).
 * Tolère les dates ISO ("2026-07-31…") ET françaises ("31/07/2026", "31/07/26").
 *
 * @example
 * const [period, setPeriod] = useState("");
 * const periods = periodsFrom(rows.map((r) => r.date));
 * const shown = rows.filter((r) => inPeriod(r.date, period));
 * <PeriodFilter value={period} onChange={setPeriod} periods={periods} />
 */

/** Convertit une date (ISO ou FR) en clé "aaaa-mm", ou "" si illisible. */
export function toYearMonth(date: string | null | undefined): string {
  const s = String(date ?? "").trim();
  if (!s) return "";
  let m = /^(\d{4})-(\d{2})/.exec(s); // ISO : 2026-07-…
  if (m) return `${m[1]}-${m[2]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s); // FR : jj/mm/aaaa
  if (m) {
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${m[2].padStart(2, "0")}`;
  }
  return "";
}

/** Libellé lisible d'une clé "aaaa-mm" → "Juillet 2026". */
export function periodLabel(ym: string): string {
  const [y, mo] = ym.split("-").map(Number);
  if (!y || !mo) return ym;
  const s = new Date(y, mo - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Liste des mois présents dans un jeu de dates, récent d'abord. */
export function periodsFrom(dates: (string | null | undefined)[]): string[] {
  return [...new Set(dates.map(toYearMonth).filter(Boolean))].sort((a, b) => b.localeCompare(a));
}

/** Valeur texte du filtre → plage de dates (null = toutes les dates). */
export function periodToRange(period: string): DateRange | null {
  if (!period) return null;
  const m = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(period);
  if (m) return { from: m[1], to: m[2] };
  return /^\d{4}-\d{2}$/.test(period) ? monthRange(period) : null;
}

/** Plage → valeur texte (un mois entier reste « aaaa-mm »). */
function rangeToPeriod(r: DateRange | null): string {
  if (!r) return "";
  return fullMonthOf(r) ?? `${r.from}_${r.to}`;
}

/** Une date tombe-t-elle dans la période choisie ? ("" = toutes). */
export function inPeriod(date: string | null | undefined, period: string): boolean {
  if (!period) return true;
  if (/^\d{4}-\d{2}$/.test(period)) return toYearMonth(date) === period;
  return inRange(date, periodToRange(period));
}

export function PeriodFilter({
  value,
  onChange,
  periods,
  allLabel = "Toutes périodes",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Mois présents dans les données (« aaaa-mm », récent d'abord) : proposés en raccourcis. */
  periods: string[];
  allLabel?: string;
  className?: string;
}) {
  const presets: RangePreset[] = [
    { id: "all", label: allLabel, range: null },
    ...standardPresets(["30j", "mois", "mois-1", "annee"]).map((p) => ({ ...p, group: "Raccourcis" })),
    ...periods.slice(0, 12).map((ym) => ({ id: ym, label: periodLabel(ym), range: monthRange(ym), group: "Mois" })),
  ];
  return (
    <DateRangePicker
      value={periodToRange(value)}
      onChange={(r) => onChange(rangeToPeriod(r))}
      presets={presets}
      placeholder={allLabel}
      align="start"
      className={cn(className)}
    />
  );
}
