import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

export type MiniPoint = { label: string; value: number };

/**
 * Petit graphe en barres interactif (hover → valeur + tooltip). Thémé TTP :
 * barre survolée en burgundy (primary), compatible dark mode. Générique : on
 * lui passe les données réelles.
 */
export function MiniChart({
  title = "Activité",
  data,
  unit = "",
  valueFormatter,
  className,
}: {
  title?: string;
  data: MiniPoint[];
  unit?: string;
  valueFormatter?: (n: number) => string;
  className?: string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [displayValue, setDisplayValue] = useState<number | null>(null);
  const [isHovering, setIsHovering] = useState(false);

  const maxValue = Math.max(1, ...data.map((d) => d.value));
  const fmt = (n: number) => (valueFormatter ? valueFormatter(n) : `${n}${unit}`);

  useEffect(() => {
    if (hoveredIndex !== null && data[hoveredIndex]) setDisplayValue(data[hoveredIndex].value);
  }, [hoveredIndex, data]);

  return (
    <div
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => {
        setIsHovering(false);
        setHoveredIndex(null);
      }}
      className={cn(
        "group relative flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 shadow-sm transition-colors",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 animate-pulse rounded-full bg-signal" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
        </div>
        <div className="flex h-7 items-center">
          <span
            className={cn(
              "text-base font-semibold tabular-nums transition-all duration-300",
              isHovering && displayValue !== null ? "text-foreground opacity-100" : "text-muted-foreground opacity-50",
            )}
          >
            {displayValue !== null ? fmt(displayValue) : ""}
          </span>
        </div>
      </div>

      {/* Chart */}
      {data.length === 0 ? (
        <div className="flex h-24 items-center text-xs text-muted-foreground">Pas encore de données.</div>
      ) : (
        <div className="flex h-24 items-end gap-2">
          {data.map((item, index) => {
            const heightPx = Math.max(4, (item.value / maxValue) * 96);
            const isHovered = hoveredIndex === index;
            const isAnyHovered = hoveredIndex !== null;
            const isNeighbor = hoveredIndex !== null && (index === hoveredIndex - 1 || index === hoveredIndex + 1);
            return (
              <div
                key={index}
                className="relative flex h-full flex-1 flex-col items-center justify-end"
                onMouseEnter={() => setHoveredIndex(index)}
              >
                <div
                  className={cn(
                    "w-full origin-bottom cursor-pointer rounded-full transition-all duration-300 ease-out",
                    isHovered
                      ? "bg-primary"
                      : isNeighbor
                        ? "bg-primary/40"
                        : isAnyHovered
                          ? "bg-foreground/10"
                          : "bg-foreground/20 group-hover:bg-foreground/25",
                  )}
                  style={{ height: `${heightPx}px` }}
                />
                <span
                  className={cn(
                    "mt-2 max-w-full truncate text-[10px] font-medium transition-all duration-300",
                    isHovered ? "text-foreground" : "text-muted-foreground/60",
                  )}
                >
                  {item.label}
                </span>
                <div
                  className={cn(
                    "absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background transition-all duration-200",
                    isHovered ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-1 opacity-0",
                  )}
                >
                  {fmt(item.value)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
