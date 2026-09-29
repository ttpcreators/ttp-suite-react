import { useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import { fmtCompact } from "@/lib/timeSeries";

/**
 * Grand graphique du tableau de bord (style Efferd) : aire monochrome sur la
 * couleur d'accent, grille pointillée discrète, info-bulle sobre, et le libellé
 * du point survolé qui devient une PASTILLE pleine sous l'axe. Lazy-chargé
 * (recharts hors du premier écran). Couleurs 100 % tokens : clair et sombre.
 */

export type DashPoint = { label: string; full: string; value: number };

type TickProps = { x?: number | string; y?: number | string; index?: number; payload?: { value?: unknown; index?: number } };

export default function DashArea({
  points,
  name,
  format,
  height = 260,
}: {
  points: DashPoint[];
  name: string;
  format: (n: number) => string;
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const n = points.length;
  const step = n > 8 ? 2 : 1;

  const Tick = (props: TickProps) => {
    const x = Number(props.x ?? 0);
    const y = Number(props.y ?? 0);
    const i = props.index ?? props.payload?.index ?? 0;
    const text = String(props.payload?.value ?? "");
    if (active === i) {
      const w = Math.max(46, text.length * 7 + 22);
      return (
        <g transform={`translate(${x},${y})`}>
          <rect x={-w / 2} y={4} width={w} height={24} rx={12} fill="var(--foreground)" />
          <text x={0} y={20} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--background)">
            {text}
          </text>
        </g>
      );
    }
    // Espacement ancré sur le DERNIER point : le mois en cours est toujours
    // libellé et deux libellés ne se collent jamais en bout d'axe.
    const show = (n - 1 - i) % step === 0;
    const near = active != null && Math.abs(active - i) === 1;
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} y={20} textAnchor="middle" fontSize={11} fill="var(--faint)" opacity={!show ? 0 : near ? 0.3 : 1}>
          {text}
        </text>
      </g>
    );
  };

  const TooltipContent = ({ active: on, payload }: { active?: boolean; payload?: Array<{ payload?: DashPoint }> }) => {
    const pt = on ? payload?.[0]?.payload : undefined;
    if (!pt) return null;
    return (
      <div className="rounded-xl border border-border bg-popover px-3 py-2 shadow-xl">
        <div className="text-[11px] font-medium text-muted-foreground">{pt.full}</div>
        <div className="mt-1 flex items-center gap-2 text-[12px]">
          <span className="size-2 rounded-full bg-primary opacity-70" />
          <span className="text-muted-foreground">{name}</span>
          <span className="ml-4 font-semibold tabular-nums text-foreground">{format(pt.value)}</span>
        </div>
      </div>
    );
  };

  return (
    <div style={{ height }} className="w-full">
      <ChartContainer config={{}} className="h-full">
        <AreaChart
          data={points}
          margin={{ top: 12, right: 8, left: 0, bottom: 0 }}
          onMouseMove={(s: unknown) => {
            const raw = (s as { activeTooltipIndex?: unknown } | null)?.activeTooltipIndex;
            const idx = raw == null || raw === "" ? NaN : Number(raw);
            setActive(Number.isFinite(idx) ? idx : null);
          }}
          onMouseLeave={() => setActive(null)}
        >
          <defs>
            <linearGradient id="dashAreaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.16} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 6" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} height={34} tick={(p: TickProps) => <Tick {...p} />} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={42}
            tick={{ fontSize: 11, fill: "var(--faint)" }}
            tickFormatter={(v) => fmtCompact(Number(v))}
          />
          <Tooltip content={<TooltipContent />} cursor={{ stroke: "var(--foreground)", strokeOpacity: 0.25, strokeWidth: 1 }} />
          <Area
            type="monotone"
            dataKey="value"
            name={name}
            stroke="var(--primary)"
            strokeOpacity={0.6}
            strokeWidth={2}
            fill="url(#dashAreaFill)"
            dot={false}
            activeDot={{ r: 4, fill: "var(--foreground)", stroke: "var(--surface)", strokeWidth: 2 }}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
