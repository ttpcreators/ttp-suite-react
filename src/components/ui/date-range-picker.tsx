import { useEffect, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { isoDay, parseDay, rangeDays, rangeLabel, sameRange, type DateRange, type RangePreset } from "@/lib/dateRange";

/**
 * Sélecteur de PÉRIODE réutilisable : une pastille (icône calendrier + dates)
 * qui ouvre des raccourcis (7 / 30 jours, ce mois-ci, mois précis…) et un
 * calendrier pour choisir librement du … au … (premier clic = début, second
 * = fin, puis « Appliquer »). Langage Aperçu, clair et sombre.
 *
 * @example
 * const [range, setRange] = useState<DateRange | null>(presetRange("30j"));
 * <DateRangePicker value={range} onChange={setRange} presets={standardPresets(["7j", "30j", "mois"])} />
 */

const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];

function monthTitle(y: number, m: number): string {
  const s = new Date(y, m, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Cases d'un mois (lundi en premier), null = case vide avant le 1er. */
function monthCells(y: number, m: number): (string | null)[] {
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  return [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => isoDay(new Date(y, m, i + 1)))];
}

function Month({
  y,
  m,
  from,
  to,
  hover,
  today,
  onPick,
  onHover,
}: {
  y: number;
  m: number;
  from: string | null;
  to: string | null;
  hover: string | null;
  today: string;
  onPick: (d: string) => void;
  onHover: (d: string | null) => void;
}) {
  // Aperçu de la plage pendant qu'on choisit la fin (survol).
  const end = to ?? (from && hover ? hover : null);
  const lo = from && end ? (from < end ? from : end) : from;
  const hi = from && end ? (from < end ? end : from) : from;
  return (
    <div className="w-[224px]">
      <div className="mb-2 text-center text-[13px] font-semibold text-foreground">{monthTitle(y, m)}</div>
      <div className="grid grid-cols-7 text-center text-[11px] text-muted-foreground">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="py-1">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7" onMouseLeave={() => onHover(null)}>
        {monthCells(y, m).map((d, i) => {
          if (!d) return <div key={`e${i}`} />;
          const isEdge = d === lo || d === hi;
          const inside = lo && hi && d > lo && d < hi;
          const banded = inside || (hi !== lo && !!lo && !!hi && isEdge);
          // Bande arrondie au début/fin de plage, et au bord de chaque ligne ou du mois.
          const col = i % 7;
          const roundL = d === lo || col === 0 || d.endsWith("-01");
          const roundR = d === hi || col === 6 || Number(d.slice(8)) === new Date(y, m + 1, 0).getDate();
          return (
            <div key={d} className={cn("py-0.5", banded && "bg-foreground/[0.07]", banded && roundL && "rounded-l-full", banded && roundR && "rounded-r-full")}>
              <button
                type="button"
                onClick={() => onPick(d)}
                onMouseEnter={() => onHover(d)}
                className={cn(
                  "relative mx-auto grid h-8 w-8 place-items-center rounded-full text-[12px] tabular-nums transition-colors",
                  isEdge ? "bg-foreground font-semibold text-background" : "text-foreground hover:bg-rowhover",
                )}
                aria-label={parseDay(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                aria-pressed={isEdge}
              >
                {Number(d.slice(8))}
                {d === today && !isEdge && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-foreground/50" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DateRangePicker({
  value,
  onChange,
  presets = [],
  placeholder = "Toutes les dates",
  align = "end",
  className,
}: {
  value: DateRange | null;
  onChange: (r: DateRange | null) => void;
  presets?: RangePreset[];
  /** Libellé quand aucune plage n'est choisie (value = null). */
  placeholder?: string;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const today = isoDay(new Date());
  // Brouillon : début + fin (null tant que la fin n'est pas choisie).
  const [from, setFrom] = useState<string | null>(value?.from ?? null);
  const [to, setTo] = useState<string | null>(value?.to ?? null);
  const [hover, setHover] = useState<string | null>(null);
  // Mois affiché à GAUCHE (le second = le mois suivant).
  const [view, setView] = useState(() => {
    const base = parseDay(value?.to ?? today);
    return new Date(base.getFullYear(), base.getMonth() - 1, 1);
  });

  // À l'ouverture : repart de la valeur courante.
  useEffect(() => {
    if (!open) return;
    setFrom(value?.from ?? null);
    setTo(value?.to ?? null);
    setHover(null);
    const base = parseDay(value?.to ?? today);
    setView(new Date(base.getFullYear(), base.getMonth() - 1, 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (d: string) => {
    if (!from || to) {
      setFrom(d);
      setTo(null);
      return;
    }
    if (d < from) {
      setTo(from);
      setFrom(d);
    } else setTo(d);
  };

  const choose = (r: DateRange | null) => {
    onChange(r);
    setOpen(false);
  };

  const draft = from && to ? { from, to } : null;
  const second = new Date(view.getFullYear(), view.getMonth() + 1, 1);
  const shift = (n: number) => setView((v) => new Date(v.getFullYear(), v.getMonth() + n, 1));
  const groups = [...new Set(presets.map((p) => p.group ?? ""))];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] font-medium tabular-nums text-foreground transition-colors hover:bg-rowhover data-[state=open]:bg-rowhover",
            className,
          )}
        >
          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="truncate">{value ? rangeLabel(value) : placeholder}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} sideOffset={6} collisionPadding={16} className="w-auto max-w-[calc(100vw-32px)] p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="flex max-w-[250px] flex-col sm:max-w-none sm:flex-row">
          {/* Raccourcis */}
          {presets.length > 0 && (
            <div className="flex gap-1 overflow-x-auto border-b border-border p-2 sm:max-h-[360px] sm:w-44 sm:flex-col sm:overflow-y-auto sm:overflow-x-hidden sm:border-b-0 sm:border-r">
              {groups.map((g) => (
                <div key={g || "_"} className="flex gap-1 sm:flex-col">
                  {g && <div className="hidden px-2 pb-1 pt-2 text-[11px] text-muted-foreground sm:block">{g}</div>}
                  {presets
                    .filter((p) => (p.group ?? "") === g)
                    .map((p) => {
                      const on = sameRange(p.range, value);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => choose(p.range)}
                          aria-pressed={on}
                          className={cn(
                            "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors",
                            on ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-rowhover hover:text-foreground",
                          )}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                </div>
              ))}
            </div>
          )}

          {/* Calendrier : du … au … */}
          <div className="p-3">
            <div className="relative flex gap-5">
              <button type="button" onClick={() => shift(-1)} aria-label="Mois précédent" className="absolute left-0 top-0 grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => shift(1)} aria-label="Mois suivant" className="absolute right-0 top-0 grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
                <ChevronRight className="h-4 w-4" />
              </button>
              <div className="hidden sm:block">
                <Month y={view.getFullYear()} m={view.getMonth()} from={from} to={to} hover={hover} today={today} onPick={pick} onHover={setHover} />
              </div>
              <Month y={second.getFullYear()} m={second.getMonth()} from={from} to={to} hover={hover} today={today} onPick={pick} onHover={setHover} />
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <span className="text-[12px] text-muted-foreground">
                {draft ? (
                  <>
                    <span className="font-medium text-foreground">{rangeLabel(draft)}</span> · {rangeDays(draft)} jour{rangeDays(draft) > 1 ? "s" : ""}
                  </>
                ) : from ? (
                  "Choisis la date de fin"
                ) : (
                  "Choisis la date de début"
                )}
              </span>
              <div className="ml-auto flex gap-2">
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-border px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => draft && choose(draft)}
                  disabled={!draft}
                  className="rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  Appliquer
                </button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}


/**
 * Champ de DATE unique avec le même calendrier (remplace `<input type="date">`).
 * Valeur « aaaa-mm-jj » ou "" (vide). Un clic sur un jour valide et ferme.
 * `className` habille le déclencheur (bordure, padding…) comme un champ.
 */
export function DateInput({
  value,
  onChange,
  placeholder = "Choisir une date",
  clearable = true,
  className,
  ariaLabel,
  alignOffset = 0,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  clearable?: boolean;
  className?: string;
  ariaLabel?: string;
  /** Décalage du calendrier (ex. -13 quand le déclencheur est dans un champ à padding). */
  alignOffset?: number;
}) {
  const [open, setOpen] = useState(false);
  const today = isoDay(new Date());
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  const [view, setView] = useState(() => parseDay(valid ?? today));
  useEffect(() => {
    if (open) setView(parseDay(valid ?? today));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const shift = (n: number) => setView((v) => new Date(v.getFullYear(), v.getMonth() + n, 1));
  const pick = (d: string) => {
    onChange(d);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={ariaLabel} className={cn("flex items-center gap-2 text-left", className)}>
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className={cn("min-w-0 flex-1 truncate tabular-nums", !valid && "text-faint")}>
            {valid ? parseDay(valid).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" alignOffset={alignOffset} sideOffset={8} collisionPadding={16} className="w-auto p-3" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="relative">
          <button type="button" onClick={() => shift(-1)} aria-label="Mois précédent" className="absolute left-0 top-0 grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => shift(1)} aria-label="Mois suivant" className="absolute right-0 top-0 grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
            <ChevronRight className="h-4 w-4" />
          </button>
          <Month y={view.getFullYear()} m={view.getMonth()} from={valid} to={valid} hover={null} today={today} onPick={pick} onHover={() => {}} />
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
          <button type="button" onClick={() => pick(today)} className="rounded-lg border border-border px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover">
            Aujourd'hui
          </button>
          {clearable && valid && (
            <button type="button" onClick={() => pick("")} className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
              Effacer
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Sélecteur de mois ‹ Septembre 2026 › (jamais après `max`). Valeur « aaaa-mm ». */
export function MonthPicker({ value, onChange, max }: { value: string; onChange: (v: string) => void; max?: string }) {
  const [y, m] = value.split("-").map(Number);
  const shift = (n: number) => {
    const d = new Date(y, m - 1 + n, 1);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!max || next <= max) onChange(next);
  };
  const label = new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const btn = "grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <div className="flex items-center rounded-lg border border-border bg-surface p-0.5">
      <button type="button" onClick={() => shift(-1)} aria-label="Mois précédent" className={btn}>
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[112px] text-center text-[12px] font-medium tabular-nums text-foreground">{label.charAt(0).toUpperCase() + label.slice(1)}</span>
      <button type="button" onClick={() => shift(1)} disabled={!!max && value >= max} aria-label="Mois suivant" className={btn}>
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
