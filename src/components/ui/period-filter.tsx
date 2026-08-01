import { cn } from "@/lib/utils";

/**
 * Filtre de PÉRIODE réutilisable (mois / année) — même look partout.
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

/** Une date tombe-t-elle dans la période choisie ? ("" = toutes). */
export function inPeriod(date: string | null | undefined, period: string): boolean {
  return !period || toYearMonth(date) === period;
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
  periods: string[];
  allLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">Période</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-border bg-surface px-3 py-2 text-[12px] font-medium text-foreground outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/15"
      >
        <option value="">{allLabel}</option>
        {periods.map((p) => (
          <option key={p} value={p}>{periodLabel(p)}</option>
        ))}
      </select>
    </div>
  );
}
