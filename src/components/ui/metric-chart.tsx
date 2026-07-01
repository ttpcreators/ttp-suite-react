import { useRef, useState, type MouseEvent } from "react";

export type SeriesPoint = { value: number; date: string };
export type MetricAccent = "emerald" | "rose" | "neutral" | "blue" | "amber" | "violet";
export type ChartView = "curve" | "bar";
export type MetricSeries = { name: string; data: SeriesPoint[]; accent?: MetricAccent };
export type ChartSeries = { name: string; data: SeriesPoint[]; color: string };

export const ACCENTS: Record<MetricAccent, { stroke: string; text: string }> = {
  emerald: { stroke: "#16a34a", text: "#15803d" },
  rose: { stroke: "#f43f5e", text: "#e11d48" },
  neutral: { stroke: "#71717a", text: "#52525b" },
  blue: { stroke: "#3b82f6", text: "#2563eb" },
  amber: { stroke: "#f59e0b", text: "#d97706" },
  violet: { stroke: "#8b5cf6", text: "#7c3aed" },
};

export const SERIES_COLORS = ["#16a34a", "#6366f1", "#f59e0b", "#f43f5e", "#06b6d4"];

export const formatCompact = (n: number) =>
  Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(n);

function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

export function MetricChart({
  series,
  view,
  defaultIndex,
  valueFormatter,
  dateFormatter,
}: {
  series: ChartSeries[];
  view: ChartView;
  defaultIndex: number;
  valueFormatter: (n: number) => string;
  dateFormatter: (d: string) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const primary = series[0];
  const n = primary?.data.length ?? 0;
  const [active, setActive] = useState<number>(Math.max(0, Math.min(defaultIndex, n - 1)));

  const allVals = series.flatMap((s) => s.data.map((d) => d.value));
  const min = allVals.length ? Math.min(...allVals) : 0;
  const max = allVals.length ? Math.max(...allVals) : 1;
  const range = max - min || 1;
  const H = 100;
  const W = 100;
  const padY = 14;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const y = (v: number) => H - padY - ((v - min) / range) * (H - padY * 2);

  const onMove = (e: MouseEvent) => {
    const el = ref.current;
    if (!el || n === 0) return;
    const rect = el.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    setActive(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
  };

  if (!primary || n < 2) return <div ref={ref} className="h-full w-full" />;

  const pts = primary.data.map((d, i) => ({ x: x(i), y: y(d.value) }));
  const linePath = smoothPath(pts);
  const areaPath = `${linePath} L ${W} ${H} L 0 ${H} Z`;
  const tipLeft = Math.min(86, Math.max(14, x(active)));

  return (
    <div ref={ref} className="relative h-full w-full" onMouseMove={onMove}>
      <svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="mc-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={primary.color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={primary.color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {view === "curve" ? (
          <>
            <path d={areaPath} fill="url(#mc-area)" />
            {series.map((s) => {
              const sp = s.data.map((d, i) => ({ x: x(i), y: y(d.value) }));
              return (
                <path
                  key={s.name}
                  d={smoothPath(sp)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </>
        ) : (
          primary.data.map((d, i) => {
            const bw = (W / n) * 0.5;
            return (
              <rect
                key={i}
                x={x(i) - bw / 2}
                y={y(d.value)}
                width={bw}
                height={H - y(d.value)}
                rx={0.8}
                fill={primary.color}
                opacity={i === active ? 1 : 0.45}
              />
            );
          })
        )}
        <line
          x1={x(active)}
          x2={x(active)}
          y1="0"
          y2="100"
          stroke={primary.color}
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
          opacity="0.4"
        />
      </svg>

      <div
        className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card"
        style={{ left: `${x(active)}%`, top: `${y(primary.data[active].value)}%`, background: primary.color }}
      />
      <div
        className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-lg"
        style={{ left: `${tipLeft}%`, top: `${Math.max(10, y(primary.data[active].value) - 4)}%` }}
      >
        <div className="whitespace-nowrap font-semibold text-foreground">
          {valueFormatter(primary.data[active].value)}
        </div>
        <div className="whitespace-nowrap text-[10px] text-muted-foreground">
          {dateFormatter(primary.data[active].date)}
        </div>
      </div>
    </div>
  );
}
