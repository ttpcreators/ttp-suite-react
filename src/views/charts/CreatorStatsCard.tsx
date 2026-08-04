import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { cn } from "@/lib/utils";
import { fmtCompact } from "@/lib/timeSeries";

/**
 * Carte de stats INTERACTIVE (inspirée du bar-chart shadcn) : on bascule entre
 * Abonnés / Engagement / Interactions via des onglets qui affichent le dernier
 * total, et le graphe (barres) montre la métrique choisie dans le temps.
 * LAZY-chargé (recharts hors du 1er écran créateur). Piloté par les mesures agence.
 */

type Entry = { date: string; platform?: string; followers?: string; er?: string; vals?: Record<string, string> };
type MetricKey = "vues" | "abonnes" | "engagement" | "interactions";

const METRICS: { key: MetricKey; label: string; color: string; pct?: boolean }[] = [
  { key: "vues", label: "Vues (30 j)", color: "#8b5cf6" },
  { key: "abonnes", label: "Abonnés", color: "#2b7fff" },
  { key: "engagement", label: "Engagement", color: "#16a34a", pct: true },
  { key: "interactions", label: "Interactions", color: "#f59e0b" },
];

const num = (v?: string) => {
  const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const parseEr = (s?: string) => {
  const n = parseFloat(String(s ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const frTime = (s: string) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec((s ?? "").trim());
  if (!m) return 0;
  const y = m[3].length === 2 ? "20" + m[3] : m[3];
  return new Date(Number(y), Number(m[2]) - 1, Number(m[1])).getTime();
};
const interactionsOf = (e: Entry) =>
  Object.entries(e.vals ?? {})
    .filter(([k]) => !["views", "reach", "posts"].includes(k))
    .reduce((a, [, v]) => a + num(v), 0);

const fmtVal = (v: number, pct?: boolean) => (pct ? `${v.toFixed(1).replace(".", ",")} %` : fmtCompact(v));

export default function CreatorStatsCard({ entries }: { entries: Entry[] }) {
  const [active, setActive] = useState<MetricKey>("vues");

  // Agrégation par date, tous réseaux confondus. Vues (30 j) = base du calculateur
  // d'engagement : `vals.views` (repli `reach`). Abonnés = somme, engagement =
  // moyenne, interactions = somme.
  const points = useMemo(() => {
    const byDate = new Map<number, { label: string; vue: number; foll: number; erSum: number; erN: number; inter: number }>();
    for (const e of entries) {
      const t = frTime(e.date);
      if (!t) continue;
      const rec = byDate.get(t) ?? { label: (e.date || "").slice(0, 5), vue: 0, foll: 0, erSum: 0, erN: 0, inter: 0 };
      rec.vue += num(e.vals?.views) || num(e.vals?.reach);
      rec.foll += num(e.followers);
      const er = parseEr(e.er);
      if (er > 0) { rec.erSum += er; rec.erN += 1; }
      rec.inter += interactionsOf(e);
      byDate.set(t, rec);
    }
    return [...byDate.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, r]) => ({ label: r.label, vues: r.vue, abonnes: r.foll, engagement: r.erN ? Math.round((r.erSum / r.erN) * 100) / 100 : 0, interactions: r.inter }));
  }, [entries]);

  const last = points[points.length - 1];
  const totals: Record<MetricKey, number> = {
    vues: last?.vues ?? 0,
    abonnes: last?.abonnes ?? 0,
    engagement: last?.engagement ?? 0,
    interactions: last?.interactions ?? 0,
  };
  const meta = METRICS.find((m) => m.key === active) ?? METRICS[0];

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      {/* En-tête : titre + onglets de métriques (dernier total) */}
      <div className="flex flex-col items-stretch border-b border-border sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-0.5 px-5 py-4">
          <div className="text-sm font-semibold text-foreground">Mes statistiques</div>
          <div className="text-[11px] text-faint">D'après les mesures de ton agence</div>
        </div>
        <div className="flex overflow-x-auto border-t border-border sm:border-t-0 sm:border-l">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setActive(m.key)}
              className={cn(
                "flex min-w-[6.5rem] flex-1 flex-col justify-center gap-0.5 border-l border-border px-4 py-3 text-left transition-colors first:border-l-0",
                active === m.key ? "bg-panel/60" : "hover:bg-rowhover",
              )}
            >
              <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: m.color }} /> {m.label}
              </span>
              <span className="text-lg font-bold tabular-nums tracking-tight text-foreground">{fmtVal(totals[m.key], m.pct)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Graphe de la métrique active */}
      <div className="px-2 py-4 sm:px-4">
        {points.length === 0 ? (
          <div className="grid h-[180px] place-items-center px-4 text-center text-xs text-muted-foreground">
            Pas encore de mesures. Elles apparaîtront ici dès que ton agence en enregistre.
          </div>
        ) : (
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={points} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="4 10" stroke="var(--color-border)" strokeOpacity={0.6} vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} tickMargin={8} interval="preserveStartEnd" minTickGap={16} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} width={40} tickFormatter={(v) => fmtVal(Number(v), meta.pct)} />
                <Tooltip
                  cursor={{ fill: "var(--color-border)", fillOpacity: 0.25 }}
                  contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)", fontSize: 12, boxShadow: "0 4px 16px rgba(0,0,0,.06)" }}
                  labelStyle={{ color: "var(--muted-foreground)", marginBottom: 2 }}
                  formatter={(value) => [fmtVal(Number(value), meta.pct), meta.label]}
                />
                <Bar dataKey={active} radius={[4, 4, 0, 0]} maxBarSize={44}>
                  {points.map((_, i) => (
                    <Cell key={i} fill={meta.color} fillOpacity={i === points.length - 1 ? 1 : 0.55} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
