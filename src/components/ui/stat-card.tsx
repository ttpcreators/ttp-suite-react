import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Sparkline (aire) en SVG inline — léger, sans dépendance. */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const w = 120;
  const h = 34;
  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const n = values.length;
  const pts = values.map((v, i) => {
    const x = pad + (i * (w - 2 * pad)) / (n - 1);
    const y = h - pad - ((v - min) / range) * (h - 2 * pad);
    return [x, y] as const;
  });
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${pts[n - 1][0].toFixed(1)} ${h} L${pts[0][0].toFixed(1)} ${h} Z`;
  const gid = `sg-${Math.round(pts[0][1] * 100)}-${n}-${Math.round(max)}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Carte statistique premium : libellé + grande valeur, variation % colorée
 * (optionnelle — uniquement quand une vraie évolution existe) et sparkline
 * (optionnelle). Style aligné sur la DA.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  delta,
  deltaLabel,
  spark,
  sparkColor = "#2b7fff",
  hint,
}: {
  icon?: LucideIcon;
  label: string;
  value: string;
  delta?: number | null;
  deltaLabel?: string;
  spark?: number[];
  sparkColor?: string;
  hint?: string;
}) {
  const hasDelta = delta != null && Number.isFinite(delta);
  const up = (delta ?? 0) >= 0;
  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-wider text-faint">
          {Icon && <Icon className="h-3.5 w-3.5" />} {label}
        </div>
        {hasDelta && (
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
              up ? "bg-signal/10 text-signaltext" : "bg-rose-500/10 text-rose-500",
            )}
          >
            {up ? "▲" : "▼"} {Math.abs(delta as number).toFixed(1).replace(".", ",")} %
          </span>
        )}
      </div>
      <div className="mt-2 whitespace-nowrap text-xl font-bold tracking-tight text-foreground sm:text-2xl">{value}</div>
      {spark && spark.length >= 2 ? (
        <div className="mt-3">
          <Sparkline values={spark} color={sparkColor} />
          {deltaLabel && <div className="mt-1 text-[10px] font-medium text-faint">{deltaLabel}</div>}
        </div>
      ) : (
        hint && <div className="mt-auto pt-3 text-[10px] font-semibold text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}
