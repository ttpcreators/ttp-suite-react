import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { fmtCompact } from "@/lib/timeSeries";

/**
 * Graphique d'évolution des abonnés (même DA que l'Aperçu agence : aire + dégradé).
 * Isolé et LAZY-chargé par l'espace créateur : recharts (~101 Ko gzip) sort du premier
 * écran du créateur, qui se peint avant l'arrivée de la lib.
 */
export default function FollowerArea({ points }: { points: { label: string; abonnes: number }[] }) {
  return (
    <ChartContainer config={{}} className="mt-4 h-[170px]">
      <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="csFollowers" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2b7fff" stopOpacity={0.24} />
            <stop offset="100%" stopColor="#2b7fff" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="4 10" stroke="var(--color-border)" strokeOpacity={0.6} vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} tickMargin={8} interval="preserveStartEnd" minTickGap={14} />
        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v) => fmtCompact(Number(v))} width={40} />
        <Tooltip content={<ChartTooltip unit="" />} cursor={{ stroke: "#2b7fff", strokeWidth: 1, strokeOpacity: 0.4 }} />
        <Area type="monotone" dataKey="abonnes" name="Abonnés" stroke="#2b7fff" strokeWidth={2.5} fill="url(#csFollowers)" dot={false} activeDot={{ r: 4, fill: "#2b7fff", stroke: "var(--color-surface)", strokeWidth: 2 }} />
      </AreaChart>
    </ChartContainer>
  );
}
