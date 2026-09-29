import { useState } from "react";
import { Area, AreaChart, Line, LineChart, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { Delta } from "@/components/ui/dash";

/**
 * Carte de courbe réutilisable (agence + créateur) : panneau façon Aperçu, gros
 * chiffre + évolution (vert/rouge) + bascule Aire/Ligne. Branchée sur nos
 * données. Theme-aware (tokens). LAZY-chargeable (recharts).
 */

export type GlassPoint = { label: string; value: number };

const num = (v: number) => (Number.isFinite(v) ? v : 0);

/** Libellé d'axe COURT (2,8k · 1,2M · 700) — sinon « 2 800 € » déborde et se coupe
 *  sur 2 lignes. Pas d'unité sur l'axe : le titre + le gros chiffre la portent. */
const compactAxis = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return String(+(n / 1_000_000).toFixed(1)).replace(".", ",") + "M";
  if (a >= 1_000) return String(+(n / 1_000).toFixed(1)).replace(".", ",") + "k";
  return String(Math.round(n));
};

export default function GlassStatChart({
  title,
  subtitle,
  points,
  format = (n) => n.toLocaleString("fr-FR"),
  yFormat = compactAxis,
  color = "var(--primary)",
  defaultType = "area",
  height = 220,
  compareLabel = "vs préc.",
}: {
  title: string;
  subtitle?: string;
  points: GlassPoint[];
  format?: (n: number) => string;
  /** Format COURT de l'axe Y (défaut : compact 2,8k). Le gros chiffre/tooltip gardent `format`. */
  yFormat?: (n: number) => string;
  color?: string;
  defaultType?: "line" | "area";
  height?: number;
  compareLabel?: string;
}) {
  const [type, setType] = useState<"line" | "area">(defaultType);

  // Tooltip formaté (euro / compact…) — le `content` custom de Recharts ignore `formatter`.
  const TooltipContent = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number | string }>; label?: string }) =>
    active && payload?.length ? (
      <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-xl">
        <div className="mb-0.5 font-medium text-muted-foreground">{label}</div>
        <div className="font-semibold text-foreground tabular-nums">{format(Number(payload[0]?.value ?? 0))}</div>
      </div>
    ) : null;

  const clean = points.filter((p) => p && Number.isFinite(p.value));
  const last = num(clean[clean.length - 1]?.value ?? 0);
  const prev = num(clean[clean.length - 2]?.value ?? last);
  const pct = prev ? ((last - prev) / Math.abs(prev)) * 100 : 0;

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      {/* En-tête : titre + bascule Aire/Ligne */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-foreground">{title}</div>
          {subtitle && <div className="mt-0.5 text-[12px] text-muted-foreground">{subtitle}</div>}
        </div>
        <div className="flex shrink-0 rounded-lg border border-border bg-surface p-0.5">
          {(["area", "line"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              aria-pressed={type === t}
              className={cn(
                "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
                type === t ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "area" ? "Aire" : "Ligne"}
            </button>
          ))}
        </div>
      </div>

      {/* Gros chiffre + évolution */}
      <div className="mt-4 flex flex-wrap items-end gap-x-3 gap-y-1">
        <div className="text-[28px] font-semibold leading-none tracking-tight tabular-nums text-foreground">{format(last)}</div>
        {clean.length >= 2 && <Delta value={pct} suffix={compareLabel} />}
      </div>

      {/* Graphe */}
      <div className="mt-4">
        {clean.length === 0 ? (
          <div className="grid place-items-center text-center text-xs text-muted-foreground" style={{ height }}>
            Pas encore de données — la courbe apparaîtra ici.
          </div>
        ) : (
          <div style={{ height }}>
          <ChartContainer config={{}} className="h-full">
            {type === "area" ? (
              <AreaChart data={clean} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
                <defs>
                  <linearGradient id={`glass-${title.replace(/\W/g, "")}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 6" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--faint)" }} tickMargin={8} interval="preserveStartEnd" minTickGap={14} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--faint)" }} width={38} tickFormatter={(v) => yFormat(Number(v))} />
                <Tooltip content={<TooltipContent />} cursor={{ stroke: color, strokeWidth: 1, strokeOpacity: 0.4 }} />
                <Area type="monotone" dataKey="value" name={title} stroke={color} strokeWidth={2} fill={`url(#glass-${title.replace(/\W/g, "")})`} dot={false} activeDot={{ r: 4, fill: color, stroke: "var(--color-surface)", strokeWidth: 2 }} />
              </AreaChart>
            ) : (
              <LineChart data={clean} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 6" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--faint)" }} tickMargin={8} interval="preserveStartEnd" minTickGap={14} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--faint)" }} width={38} tickFormatter={(v) => yFormat(Number(v))} />
                <Tooltip content={<TooltipContent />} cursor={{ stroke: color, strokeWidth: 1, strokeOpacity: 0.4 }} />
                <Line type="monotone" dataKey="value" name={title} stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: color, stroke: "var(--color-surface)", strokeWidth: 2 }} />
              </LineChart>
            )}
          </ChartContainer>
          </div>
        )}
      </div>
    </div>
  );
}
