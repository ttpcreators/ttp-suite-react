import type { ReactNode } from "react";
import { motion } from "motion/react";
import { ArrowUpRight, ArrowDownRight, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChartDataPoint = { label: string; currentValue: number; previousValue: number };

/**
 * Carte statistique avec mini bar-chart de comparaison (barre courante + barre
 * de référence par période). Recréée en natif (motion/react + tokens DA) d'après
 * le composant fourni — hauteurs normalisées sur le max des données.
 */
export function ActivityStatsCard({
  title,
  icon,
  mainValue,
  changeValue,
  changeDescription,
  chartData,
  legend,
  onActionClick,
  primaryBarClassName,
  secondaryBarClassName,
  className,
}: {
  title: string;
  icon?: ReactNode;
  mainValue: string;
  changeValue: number;
  changeDescription: string;
  chartData: ChartDataPoint[];
  legend?: { primary: string; secondary: string };
  onActionClick?: () => void;
  primaryBarClassName?: string;
  secondaryBarClassName?: string;
  className?: string;
}) {
  const Change = changeValue >= 0 ? ArrowUpRight : ArrowDownRight;
  const changeColor = changeValue > 0 ? "text-emerald-600 dark:text-emerald-400" : changeValue < 0 ? "text-rose-500" : "text-muted-foreground";
  const max = Math.max(1, ...chartData.flatMap((p) => [p.currentValue, p.previousValue]));

  return (
    <div className={cn("flex flex-col rounded-2xl border border-border bg-surface p-5 shadow-sm", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {icon && <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">{icon}</span>}
          <div className="text-sm font-semibold text-foreground">{title}</div>
        </div>
        {onActionClick && (
          <button type="button" onClick={onActionClick} aria-label="Détails" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground">
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div className="text-3xl font-bold tracking-tight text-foreground">{mainValue}</div>
        <div className={cn("flex items-center gap-1 text-sm", changeColor)}>
          <Change className="h-4 w-4" />
          <span>
            {Math.abs(changeValue).toFixed(1).replace(".", ",")}% <span className="text-muted-foreground">{changeDescription}</span>
          </span>
        </div>
      </div>

      {legend && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className={cn("h-2 w-3 rounded-full bg-primary", primaryBarClassName)} /> {legend.primary}
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn("h-2 w-3 rounded-full bg-rowhover", secondaryBarClassName)} /> {legend.secondary}
          </span>
        </div>
      )}

      <div className="mt-4 h-28 w-full">
        <div className="flex h-full w-full items-end justify-between gap-2">
          {chartData.map((point, i) => (
            <div key={`${point.label}-${i}`} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
              <div className="relative flex h-full w-full items-end justify-center gap-1">
                <motion.div
                  className={cn("w-full rounded-[3px] bg-primary", primaryBarClassName)}
                  initial={{ height: 0 }}
                  animate={{ height: `${(point.currentValue / max) * 100}%` }}
                  transition={{ type: "spring", stiffness: 300, damping: 26, delay: 0.08 + i * 0.04 }}
                  title={`${point.label} · ${point.currentValue}`}
                />
                <motion.div
                  className={cn("w-full rounded-[3px] bg-rowhover", secondaryBarClassName)}
                  initial={{ height: 0 }}
                  animate={{ height: `${(point.previousValue / max) * 100}%` }}
                  transition={{ type: "spring", stiffness: 300, damping: 26, delay: 0.1 + i * 0.04 }}
                  title={`${point.label} · ${point.previousValue}`}
                />
              </div>
              <span className="text-[10px] text-faint">{point.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
