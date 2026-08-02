import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { fmtCompact } from "@/lib/timeSeries";

/** Couleur + libellé par plateforme (courbes différenciées). */
const PLAT_META: Record<string, { label: string; color: string }> = {
  instagram: { label: "Instagram", color: "#E1306C" },
  tiktok: { label: "TikTok", color: "#0ea5e9" },
  youtube: { label: "YouTube", color: "#ef4444" },
  x: { label: "X", color: "#64748b" },
  snapchat: { label: "Snapchat", color: "#f59e0b" },
};
const metaOf = (p: string) => PLAT_META[p] ?? { label: p, color: "#2b7fff" };

/**
 * Évolution des abonnés (même DA que l'Aperçu agence). LAZY-chargé (recharts hors
 * du 1er écran créateur). Une SEULE plateforme → aire + dégradé ; PLUSIEURS → une
 * ligne par plateforme (couleurs + légende) pour ne pas confondre IG / TikTok / YT.
 */
export default function FollowerArea({
  points,
  platforms,
}: {
  points: Record<string, string | number>[];
  platforms: string[];
}) {
  const plats = platforms.length ? platforms : ["abonnes"];
  const single = plats.length === 1;
  const gid = (p: string) => `csFollowers-${p}`;

  return (
    <div>
      {/* Légende (seulement si plusieurs plateformes) */}
      {!single && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {plats.map((p) => (
            <span key={p} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ background: metaOf(p).color }} /> {metaOf(p).label}
            </span>
          ))}
        </div>
      )}
      <ChartContainer config={{}} className="mt-3 h-[170px]">
        <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            {plats.map((p) => (
              <linearGradient key={p} id={gid(p)} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={metaOf(p).color} stopOpacity={0.24} />
                <stop offset="100%" stopColor={metaOf(p).color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="4 10" stroke="var(--color-border)" strokeOpacity={0.6} vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} tickMargin={8} interval="preserveStartEnd" minTickGap={14} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v) => fmtCompact(Number(v))} width={40} />
          <Tooltip content={<ChartTooltip unit="" />} cursor={{ stroke: "#2b7fff", strokeWidth: 1, strokeOpacity: 0.4 }} />
          {plats.map((p) => (
            <Area
              key={p}
              type="monotone"
              dataKey={p}
              name={single && p === "abonnes" ? "Abonnés" : metaOf(p).label}
              stroke={metaOf(p).color}
              strokeWidth={2.5}
              fill={single ? `url(#${gid(p)})` : "none"}
              connectNulls
              dot={false}
              activeDot={{ r: 4, fill: metaOf(p).color, stroke: "var(--color-surface)", strokeWidth: 2 }}
            />
          ))}
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
