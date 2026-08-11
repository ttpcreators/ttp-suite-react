import { useState } from "react";
import { Area, AreaChart, Line, LineChart, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

/**
 * Carte de stat « verre » réutilisable (agence + créateur). Inspirée d'un chart
 * crypto temps réel dont on garde le LOOK (glass + gros chiffre + delta ▲▼ +
 * bascule Ligne/Aire), branchée sur NOS données (aucune crypto, aucun WebSocket).
 * Theme-aware (couleurs via CSS vars / tokens). LAZY-chargeable (recharts).
 */

export type GlassPoint = { label: string; value: number };

const num = (v: number) => (Number.isFinite(v) ? v : 0);

export default function GlassStatChart({
  title,
  subtitle,
  points,
  format = (n) => n.toLocaleString("fr-FR"),
  color = "#2b7fff",
  defaultType = "area",
  height = 220,
  compareLabel = "vs préc.",
}: {
  title: string;
  subtitle?: string;
  points: GlassPoint[];
  format?: (n: number) => string;
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
  const delta = last - prev;
  const pct = prev ? (delta / Math.abs(prev)) * 100 : 0;
  const up = delta >= 0;
  const deltaColor = delta === 0 ? "text-muted-foreground" : up ? "text-emerald-500" : "text-rose-500";

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-surface to-panel/50 p-5 shadow-sm backdrop-blur-xl">
      {/* Halos décoratifs (glass) */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -right-10 -top-12 h-40 w-40 rounded-full blur-3xl" style={{ background: color, opacity: 0.12 }} />
        <div className="absolute -bottom-16 -left-10 h-44 w-44 rounded-full bg-primary/10 blur-3xl" />
      </div>

      {/* En-tête : titre + bascule Ligne/Aire */}
      <div className="relative z-10 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          {subtitle && <div className="mt-0.5 text-[11px] text-faint">{subtitle}</div>}
        </div>
        <div className="flex shrink-0 rounded-full bg-panel/70 p-0.5 backdrop-blur">
          {(["area", "line"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={cn(
                "rounded-full px-3 py-1 text-[11px] font-semibold transition-colors",
                type === t ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "area" ? "Aire" : "Ligne"}
            </button>
          ))}
        </div>
      </div>

      {/* Gros chiffre + delta */}
      <div className="relative z-10 mt-3 flex items-end gap-3">
        <div className="text-3xl font-bold tracking-tight text-foreground tabular-nums">{format(last)}</div>
        {clean.length >= 2 && (
          <div className={cn("mb-1 flex items-center gap-1 text-[13px] font-semibold tabular-nums", deltaColor)}>
            <span>{delta === 0 ? "→" : up ? "▲" : "▼"}</span>
            <span>{format(Math.abs(delta))}</span>
            <span className="opacity-80">({pct >= 0 ? "+" : "−"}{Math.abs(pct).toFixed(1).replace(".", ",")}%)</span>
            <span className="ml-1 text-[10px] font-medium text-faint">{compareLabel}</span>
          </div>
        )}
      </div>

      {/* Graphe */}
      <div className="relative z-10 mt-3">
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
                <CartesianGrid strokeDasharray="4 10" stroke="var(--color-border)" strokeOpacity={0.6} vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} tickMargin={8} interval="preserveStartEnd" minTickGap={14} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} width={44} tickFormatter={(v) => format(Number(v))} />
                <Tooltip content={<TooltipContent />} cursor={{ stroke: color, strokeWidth: 1, strokeOpacity: 0.4 }} />
                <Area type="monotone" dataKey="value" name={title} stroke={color} strokeWidth={2.5} fill={`url(#glass-${title.replace(/\W/g, "")})`} dot={false} activeDot={{ r: 4, fill: color, stroke: "var(--color-surface)", strokeWidth: 2 }} />
              </AreaChart>
            ) : (
              <LineChart data={clean} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="4 10" stroke="var(--color-border)" strokeOpacity={0.6} vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} tickMargin={8} interval="preserveStartEnd" minTickGap={14} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} width={44} tickFormatter={(v) => format(Number(v))} />
                <Tooltip content={<TooltipContent />} cursor={{ stroke: color, strokeWidth: 1, strokeOpacity: 0.4 }} />
                <Line type="monotone" dataKey="value" name={title} stroke={color} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: color, stroke: "var(--color-surface)", strokeWidth: 2 }} />
              </LineChart>
            )}
          </ChartContainer>
          </div>
        )}
      </div>
    </div>
  );
}
