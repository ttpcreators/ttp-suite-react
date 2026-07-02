import * as React from "react";
import { ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

export type ChartConfig = Record<string, { label?: string; color?: string }>;

/**
 * Conteneur de graphique : injecte les couleurs de `config` en variables CSS
 * (`--color-<clé>`) utilisables par les éléments Recharts, et gère le
 * dimensionnement responsive. Donne une hauteur via `className` (ex: h-[240px]).
 */
export function ChartContainer({
  config,
  className,
  children,
}: {
  config: ChartConfig;
  className?: string;
  children: React.ReactElement;
}) {
  const style = {} as React.CSSProperties & Record<string, string>;
  for (const [k, v] of Object.entries(config)) if (v.color) style[`--color-${k}`] = v.color;
  return (
    <div className={cn("w-full", className)} style={style}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

/** Tooltip stylé (DA) — à passer à `<Tooltip content={<ChartTooltip />} />`. */
export function ChartTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string; payload?: Record<string, unknown> }>;
  label?: string | number;
  unit?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-xl">
      {label != null && <div className="mb-1 font-semibold text-foreground">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          {p.color && <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />}
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto font-semibold text-foreground">
            {typeof p.value === "number" ? p.value.toLocaleString("fr-FR") : p.value}
            {unit ?? ""}
          </span>
        </div>
      ))}
    </div>
  );
}
