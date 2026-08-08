import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";

/**
 * Tendance des objectifs : progression moyenne (%) par mois. LAZY-chargé
 * (recharts hors du 1er écran). Aire dégradée bleu primary — lisible en clair
 * comme en sombre (couleurs via CSS vars pour la grille/surface). Y borné 0–100.
 */
const BLUE = "#2b7fff";

export default function ObjectivesTrend({
  points,
}: {
  points: { label: string; pct: number; month: string }[];
}) {
  return (
    <ChartContainer config={{}} className="mt-1 h-[200px]">
      <AreaChart data={points} margin={{ top: 8, right: 10, left: -6, bottom: 0 }}>
        <defs>
          <linearGradient id="objTrend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BLUE} stopOpacity={0.26} />
            <stop offset="100%" stopColor={BLUE} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="4 10" stroke="var(--color-border)" strokeOpacity={0.6} vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} tickMargin={8} interval="preserveStartEnd" minTickGap={14} />
        <YAxis
          domain={[0, 100]}
          ticks={[0, 25, 50, 75, 100]}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: "#94a3b8" }}
          tickFormatter={(v) => `${v}%`}
          width={38}
        />
        <ReferenceLine y={100} stroke="var(--color-signal)" strokeDasharray="3 6" strokeOpacity={0.5} />
        <Tooltip content={<ChartTooltip unit=" %" />} cursor={{ stroke: BLUE, strokeWidth: 1, strokeOpacity: 0.4 }} />
        <Area
          type="monotone"
          dataKey="pct"
          name="Progression moyenne"
          stroke={BLUE}
          strokeWidth={2.5}
          fill="url(#objTrend)"
          connectNulls
          dot={{ r: 3, fill: BLUE, stroke: "var(--color-surface)", strokeWidth: 2 }}
          activeDot={{ r: 5, fill: BLUE, stroke: "var(--color-surface)", strokeWidth: 2 }}
        />
      </AreaChart>
    </ChartContainer>
  );
}
