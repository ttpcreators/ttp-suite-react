import { useEffect, useState } from "react";
import { Users, TrendingUp, TrendingDown, Receipt, Wallet, Clock, FileText, Contact as ContactIcon, Activity } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { parseAmount, formatEuro } from "@/lib/appState";
import { titleCase, cn } from "@/lib/utils";
import { invMonthKey, monthsBetween, momDelta, monthLabel, fmtCompact } from "@/lib/timeSeries";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { StatCard } from "@/components/ui/stat-card";
import { ActivityStatsCard } from "@/components/ui/activity-stats-card";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  LabelList,
} from "recharts";

type CreatorRow = { name: string; followers: string | null; er: string | null; reach: string | null; ca: string | null; status: string | null };
type InvRow = { amount: string; status: string; creator: string | null; date: string | null };
type CountRow = { id: string };

type StatsData = {
  creators: CreatorRow[];
  invoices: InvRow[];
  briefs: number;
  contacts: number;
  todos: number;
  ideas: number;
};

const COLORS = {
  primary: "#2b7fff",
  green: "#16a34a",
  amber: "#f59e0b",
  rose: "#f43f5e",
  indigo: "#6366f1",
  cyan: "#06b6d4",
  slate: "#94a3b8",
};

function parseCompact(s: string | null): number {
  if (!s) return 0;
  const t = s.trim().replace(/\s/g, "").replace(",", ".").toUpperCase();
  const m = /^([0-9.]+)([KM]?)/.exec(t);
  if (!m) return 0;
  let n = parseFloat(m[1]) || 0;
  if (m[2] === "K") n *= 1e3;
  else if (m[2] === "M") n *= 1e6;
  return n;
}
function parsePct(s: string | null): number {
  if (!s) return 0;
  return parseFloat(s.replace(",", ".").replace(/[^0-9.]/g, "")) || 0;
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-1 text-sm font-semibold text-foreground">{title}</div>
      {subtitle && <div className="mb-3 text-[11px] text-faint">{subtitle}</div>}
      {children}
    </div>
  );
}

type RevenuePoint = { label: string; ca: number; paid: number };

/** Graphique vedette du chiffre d'affaires : aire + dégradé, sélecteur de période,
 *  total sur la fenêtre choisie + badge de variation mensuelle. */
function RevenueChart({ points }: { points: RevenuePoint[] }) {
  const [period, setPeriod] = useState<number>(points.length > 12 ? 12 : 0); // 0 = tout
  const view = period === 0 ? points : points.slice(-period);
  const total = view.reduce((s, p) => s + p.ca, 0);
  const paidTotal = view.reduce((s, p) => s + p.paid, 0);
  const delta = momDelta(view.map((p) => p.ca));
  const periods: { k: number; label: string }[] = [
    { k: 6, label: "6 mois" },
    { k: 12, label: "12 mois" },
    { k: 0, label: "Tout" },
  ];
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">Chiffre d'affaires</div>
          <div className="mt-0.5 text-[11px] text-faint">Évolution mensuelle · facturé vs encaissé</div>
        </div>
        <div className="flex rounded-lg border border-border bg-card p-0.5">
          {periods.map((p) => (
            <button
              key={p.k}
              type="button"
              onClick={() => setPeriod(p.k)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                period === p.k ? "bg-primary text-primary-foreground" : "text-faint hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div className="text-3xl font-bold tracking-tight text-foreground">{formatEuro(total)}</div>
        {delta != null && (
          <span
            className={cn(
              "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
              delta >= 0 ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/12 text-rose-500",
            )}
          >
            {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {Math.abs(delta).toFixed(1).replace(".", ",")} %
          </span>
        )}
        <span className="text-[11px] text-faint">dont {formatEuro(paidTotal)} encaissé</span>
      </div>

      <ChartContainer config={{}} className="mt-4 h-[280px]">
        <AreaChart data={view} margin={{ top: 16, right: 12, left: -6, bottom: 0 }}>
          <defs>
            <linearGradient id="caGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.primary} stopOpacity={0.22} />
              <stop offset="100%" stopColor={COLORS.primary} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 10" stroke="var(--color-border)" strokeOpacity={0.7} vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} tickMargin={10} interval="preserveStartEnd" minTickGap={16} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => fmtCompact(Number(v))} width={44} />
          <Tooltip content={<ChartTooltip unit=" €" />} cursor={{ stroke: COLORS.primary, strokeWidth: 1, strokeOpacity: 0.4 }} />
          <Area
            type="monotone"
            dataKey="ca"
            name="Facturé"
            stroke={COLORS.primary}
            strokeWidth={2.5}
            fill="url(#caGradient)"
            dot={false}
            activeDot={{ r: 5, fill: COLORS.primary, stroke: "var(--color-surface)", strokeWidth: 2 }}
          />
          <Area
            type="monotone"
            dataKey="paid"
            name="Encaissé"
            stroke={COLORS.green}
            strokeWidth={2}
            strokeDasharray="5 4"
            fill="transparent"
            dot={false}
            activeDot={{ r: 4, fill: COLORS.green, stroke: "var(--color-surface)", strokeWidth: 2 }}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}

/** N clés de mois "YYYY-MM" se terminant à `endKey` inclus (plus ancien d'abord). */
function monthsEndingAt(endKey: string, n: number): string[] {
  const [y, m] = endKey.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** Carte de comparaison : valeur courante + variation vs période de référence. */
function CompareCard({ label, current, previous, delta, curLbl, prevLbl }: { label: string; current: string; previous: string; delta: number | null; curLbl: string; prevLbl: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">{label}</div>
        {delta != null && (
          <span
            className={
              "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold " +
              (delta >= 0 ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/12 text-rose-500")
            }
          >
            {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {delta >= 0 ? "+" : ""}
            {delta.toFixed(0)} %
          </span>
        )}
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">{current}</div>
      <div className="mt-1 text-[11px] text-faint">
        {curLbl} · {prevLbl} : <span className="font-medium text-muted-foreground">{previous}</span>
      </div>
    </div>
  );
}

export function Stats() {
  const [data, setData] = useState<StatsData | null>(() => getCache<StatsData>("statsData"));
  const [error, setError] = useState(false);
  const [cmpMonths, setCmpMonths] = useState<1 | 3 | 6 | 12>(3);
  const [cmpAgainst, setCmpAgainst] = useState<"prev" | "year">("prev");
  const live = useLiveKey();

  useEffect(() => {
    let alive = true;
    (async () => {
      const [cr, inv, br, co, td, id] = await Promise.all([
        supabase.from("creators").select("name,followers,er,reach,ca,status"),
        supabase.from("invoices").select("amount,status,creator,date"),
        supabase.from("briefs").select("id"),
        supabase.from("contacts").select("id"),
        supabase.from("todos").select("id"),
        supabase.from("ideas").select("id"),
      ]);
      if (!alive) return;
      if (cr.error || inv.error) {
        setError(true);
        return;
      }
      if (br.error || co.error || td.error || id.error)
        console.error("Stats — compteurs partiels:", { br: br.error, co: co.error, td: td.error, id: id.error });
      const next: StatsData = {
        creators: (cr.data as CreatorRow[]) ?? [],
        invoices: (inv.data as InvRow[]) ?? [],
        briefs: ((br.data as CountRow[]) ?? []).length,
        contacts: ((co.data as CountRow[]) ?? []).length,
        todos: ((td.data as CountRow[]) ?? []).length,
        ideas: ((id.data as CountRow[]) ?? []).length,
      };
      setCache("statsData", next);
      setData(next);
    })();
    return () => {
      alive = false;
    };
  }, [live]);

  if (error) {
    return <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">Impossible de charger les statistiques.</div>;
  }
  if (!data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <AnimatedBadge status="loading" size="sm">Agrégation des données…</AnimatedBadge>
      </div>
    );
  }

  // ── Agrégations ──
  const activeCreators = data.creators.filter((c) => (c.status ?? "actif").toLowerCase() !== "inactif").length;
  const totalFollowers = data.creators.reduce((s, c) => s + parseCompact(c.followers), 0);
  const erVals = data.creators.map((c) => parsePct(c.er)).filter((v) => v > 0);
  const avgEr = erVals.length ? erVals.reduce((s, v) => s + v, 0) / erVals.length : 0;

  const byStatus = { payee: 0, attente: 0, retard: 0, brouillon: 0 };
  for (const iv of data.invoices) {
    const a = parseAmount(iv.amount);
    if (iv.status in byStatus) byStatus[iv.status as keyof typeof byStatus] += a;
  }
  const totalCA = byStatus.payee + byStatus.attente + byStatus.retard + byStatus.brouillon;

  // Série mensuelle RÉELLE du CA (depuis les échéances de factures parseables) → sparkline + variation MoM.
  const monthAgg = new Map<string, { tot: number; paid: number }>();
  for (const iv of data.invoices) {
    const k = invMonthKey(iv.date);
    if (!k) continue;
    const a = parseAmount(iv.amount);
    const cur = monthAgg.get(k) ?? { tot: 0, paid: 0 };
    cur.tot += a;
    if (iv.status === "payee") cur.paid += a;
    monthAgg.set(k, cur);
  }
  const monthKeys = [...monthAgg.keys()].sort();
  const fullMonths = monthKeys.length >= 2 ? monthsBetween(monthKeys[0], monthKeys[monthKeys.length - 1]) : monthKeys;
  const months = fullMonths.slice(-8);
  const caSeries = months.map((m) => monthAgg.get(m)?.tot ?? 0);
  const paidSeries = months.map((m) => monthAgg.get(m)?.paid ?? 0);
  const hasCaSeries = caSeries.length >= 2 && caSeries.some((v) => v > 0);
  const caDelta = hasCaSeries ? momDelta(caSeries) : null;
  const paidDelta = hasCaSeries ? momDelta(paidSeries) : null;
  const lastMonthLbl = months.length ? monthLabel(months[months.length - 1]) : "";

  // Série complète (toutes les échéances) pour le graphique vedette avec sélecteur de période.
  const revenuePoints = fullMonths.map((m) => ({
    label: monthLabel(m),
    ca: monthAgg.get(m)?.tot ?? 0,
    paid: monthAgg.get(m)?.paid ?? 0,
  }));
  const hasRevenue = revenuePoints.length >= 2 && revenuePoints.some((p) => p.ca > 0);

  // ── Comparaison de période (fenêtre glissante vs période précédente ou N-1) ──
  const monthCount = new Map<string, number>();
  for (const iv of data.invoices) {
    const k = invMonthKey(iv.date);
    if (k) monthCount.set(k, (monthCount.get(k) ?? 0) + 1);
  }
  const now = new Date();
  const keyOf = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
  const curWindow = monthsEndingAt(keyOf(now), cmpMonths);
  const compEndDate =
    cmpAgainst === "prev"
      ? new Date(now.getFullYear(), now.getMonth() - cmpMonths, 1)
      : new Date(now.getFullYear() - 1, now.getMonth(), 1);
  const compWindow = monthsEndingAt(keyOf(compEndDate), cmpMonths);
  const sumWindow = (keys: string[]) =>
    keys.reduce(
      (acc, k) => ({
        tot: acc.tot + (monthAgg.get(k)?.tot ?? 0),
        paid: acc.paid + (monthAgg.get(k)?.paid ?? 0),
        count: acc.count + (monthCount.get(k) ?? 0),
      }),
      { tot: 0, paid: 0, count: 0 },
    );
  const cmpCur = sumWindow(curWindow);
  const cmpPrev = sumWindow(compWindow);
  const pctDelta = (a: number, b: number): number | null => (b > 0 ? ((a - b) / b) * 100 : null);
  const cmpChart = curWindow.map((k, i) => ({
    label: monthLabel(k),
    actuel: monthAgg.get(k)?.tot ?? 0,
    compare: monthAgg.get(compWindow[i])?.tot ?? 0,
  }));
  const myLabel = (k: string) => `${monthLabel(k)} ${k.slice(2, 4)}`;
  const rangeLabel = (w: string[]) => (w.length === 1 ? myLabel(w[0]) : w.length ? `${myLabel(w[0])} → ${myLabel(w[w.length - 1])}` : "");
  const curRange = rangeLabel(curWindow);
  const compRange = rangeLabel(compWindow);

  const statusData = [
    { name: "Payé", value: byStatus.payee, color: COLORS.green },
    { name: "En attente", value: byStatus.attente, color: COLORS.amber },
    { name: "En retard", value: byStatus.retard, color: COLORS.rose },
    { name: "Brouillon", value: byStatus.brouillon, color: COLORS.slate },
  ].filter((d) => d.value > 0);

  // CA par créateur
  const caByCreator = new Map<string, number>();
  for (const iv of data.invoices) {
    const key = iv.creator || "—";
    caByCreator.set(key, (caByCreator.get(key) ?? 0) + parseAmount(iv.amount));
  }
  const topCreators = [...caByCreator.entries()]
    .map(([name, ca]) => ({ name: titleCase(name).split(" ")[0] || name, ca }))
    .sort((a, b) => b.ca - a.ca)
    .slice(0, 8);

  // Followers par créateur
  const followersData = data.creators
    .map((c) => ({ name: titleCase(c.name).split(" ")[0], followers: parseCompact(c.followers) }))
    .filter((d) => d.followers > 0)
    .sort((a, b) => b.followers - a.followers)
    .slice(0, 8);

  // Volume par module
  const volumeData = [
    { name: "Factures", value: data.invoices.length, color: COLORS.primary },
    { name: "Briefs", value: data.briefs, color: COLORS.indigo },
    { name: "Idées", value: data.ideas, color: COLORS.cyan },
    { name: "À faire", value: data.todos, color: COLORS.amber },
    { name: "Contacts", value: data.contacts, color: COLORS.green },
  ];

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={Receipt}
          label="CA facturé"
          value={formatEuro(totalCA)}
          delta={caDelta}
          deltaLabel={hasCaSeries ? `évolution mensuelle · ${lastMonthLbl}` : undefined}
          spark={hasCaSeries ? caSeries : undefined}
          sparkColor="#2b7fff"
          hint={`${data.invoices.length} facture${data.invoices.length > 1 ? "s" : ""}`}
        />
        <StatCard
          icon={Wallet}
          label="Encaissé"
          value={formatEuro(byStatus.payee)}
          delta={paidDelta}
          deltaLabel={hasCaSeries ? "vs mois précédent" : undefined}
          spark={hasCaSeries ? paidSeries : undefined}
          sparkColor="#16a34a"
          hint="payé"
        />
        <StatCard icon={Clock} label="En attente + retard" value={formatEuro(byStatus.attente + byStatus.retard)} hint="à suivre" />
        <StatCard icon={Users} label="Créateurs actifs" value={`${activeCreators}`} hint={`${data.creators.length} au total`} />
        <StatCard icon={TrendingUp} label="Followers cumulés" value={fmtCompact(totalFollowers)} hint="tous créateurs" />
        <StatCard icon={Activity} label="Engagement moyen" value={`${avgEr.toFixed(1).replace(".", ",")} %`} hint={`${erVals.length} mesuré${erVals.length > 1 ? "s" : ""}`} />
        <StatCard icon={FileText} label="Briefs" value={`${data.briefs}`} hint={`${data.ideas} idées · ${data.todos} à faire`} />
        <StatCard icon={ContactIcon} label="Contacts" value={`${data.contacts}`} hint="réseau agence" />
      </div>

      {/* Carte activité : facturé vs encaissé par mois */}
      {hasRevenue && (
        <ActivityStatsCard
          title="Chiffre d'affaires"
          icon={<Receipt className="h-4 w-4" />}
          mainValue={formatEuro(totalCA)}
          changeValue={caDelta ?? 0}
          changeDescription="évolution mensuelle"
          chartData={revenuePoints.slice(-8).map((p) => ({ label: p.label, currentValue: p.ca, previousValue: p.paid }))}
          legend={{ primary: "Facturé", secondary: "Encaissé" }}
          secondaryBarClassName="bg-signal/40"
        />
      )}

      {/* Comparaison de période */}
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="text-sm font-semibold text-foreground">Comparaison</div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-0.5 rounded-lg border border-border bg-card p-0.5">
              {([1, 3, 6, 12] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCmpMonths(n)}
                  className={cn("rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors", cmpMonths === n ? "bg-primary text-primary-foreground" : "text-faint hover:text-foreground")}
                >
                  {n === 1 ? "1 mois" : `${n} mois`}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-0.5 rounded-lg border border-border bg-card p-0.5">
              {(
                [
                  ["prev", "Période préc."],
                  ["year", "Année N-1"],
                ] as const
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setCmpAgainst(k)}
                  className={cn("rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors", cmpAgainst === k ? "bg-primary text-primary-foreground" : "text-faint hover:text-foreground")}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-2 text-[11px] text-faint">
          <span className="font-medium text-muted-foreground">{curRange}</span> vs <span className="font-medium text-muted-foreground">{compRange}</span>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <CompareCard label="CA facturé" current={formatEuro(cmpCur.tot)} previous={formatEuro(cmpPrev.tot)} delta={pctDelta(cmpCur.tot, cmpPrev.tot)} curLbl={curRange} prevLbl={compRange} />
          <CompareCard label="Encaissé" current={formatEuro(cmpCur.paid)} previous={formatEuro(cmpPrev.paid)} delta={pctDelta(cmpCur.paid, cmpPrev.paid)} curLbl={curRange} prevLbl={compRange} />
          <CompareCard label="Factures" current={String(cmpCur.count)} previous={String(cmpPrev.count)} delta={pctDelta(cmpCur.count, cmpPrev.count)} curLbl={curRange} prevLbl={compRange} />
        </div>

        {cmpMonths > 1 && (
          <>
            <div className="mb-2 mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-4 rounded-full" style={{ background: COLORS.primary }} /> Période actuelle
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-4 rounded-full" style={{ background: COLORS.slate }} /> Comparaison
              </span>
              <span className="text-faint">· CA facturé</span>
            </div>
            <ChartContainer config={{}} className="h-[240px]">
              <AreaChart data={cmpChart} margin={{ top: 12, right: 12, left: -6, bottom: 0 }}>
                <defs>
                  <linearGradient id="cmpGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.primary} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={COLORS.primary} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 10" stroke="var(--color-border)" strokeOpacity={0.6} vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} tickMargin={10} interval="preserveStartEnd" minTickGap={16} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => fmtCompact(Number(v))} width={44} />
                <Tooltip content={<ChartTooltip unit=" €" />} cursor={{ stroke: COLORS.primary, strokeWidth: 1, strokeOpacity: 0.4 }} />
                <Area type="monotone" dataKey="compare" name="Comparaison" stroke={COLORS.slate} strokeWidth={2} strokeDasharray="5 4" fill="transparent" dot={false} />
                <Area type="monotone" dataKey="actuel" name="Période actuelle" stroke={COLORS.primary} strokeWidth={2.5} fill="url(#cmpGrad)" dot={false} activeDot={{ r: 4, fill: COLORS.primary, stroke: "var(--color-surface)", strokeWidth: 2 }} />
              </AreaChart>
            </ChartContainer>
          </>
        )}
      </div>

      {/* Graphique vedette : chiffre d'affaires */}
      {hasRevenue && <RevenueChart points={revenuePoints} />}

      {/* Graphiques */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* CA par statut */}
        <ChartCard title="Répartition du chiffre d'affaires" subtitle="Par statut de facture">
          {statusData.length === 0 ? (
            <div className="grid h-[240px] place-items-center text-sm text-faint">Aucune facture</div>
          ) : (
            <>
              <div className="relative">
                <ChartContainer config={{}} className="h-[240px]">
                  <PieChart>
                    <Tooltip content={<ChartTooltip unit=" €" />} />
                    <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={3} cornerRadius={6} strokeWidth={0}>
                      {statusData.map((d) => (
                        <Cell key={d.name} fill={d.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-faint">Total</div>
                  <div className="text-lg font-bold tracking-tight text-foreground">{formatEuro(totalCA)}</div>
                </div>
              </div>
              <div className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
                {statusData.map((d) => (
                  <span key={d.name} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} /> {d.name} · {formatEuro(d.value)}
                  </span>
                ))}
              </div>
            </>
          )}
        </ChartCard>

        {/* Volume par module */}
        <ChartCard title="Volume d'activité" subtitle="Éléments par module">
          <ChartContainer config={{}} className="h-[240px]">
            <BarChart data={volumeData} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
              <defs>
                {volumeData.map((d, i) => (
                  <linearGradient key={i} id={`vol-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={d.color} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={d.color} stopOpacity={0.5} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="4 8" strokeOpacity={0.6} />
              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} tickMargin={8} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} allowDecimals={false} width={28} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(148,163,184,0.1)" }} />
              <Bar dataKey="value" radius={[7, 7, 0, 0]} maxBarSize={46}>
                {volumeData.map((d, i) => (
                  <Cell key={d.name} fill={`url(#vol-${i})`} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </ChartCard>

        {/* Top créateurs par CA */}
        <ChartCard title="Top créateurs · CA facturé" subtitle="8 premiers par montant facturé">
          {topCreators.length === 0 ? (
            <div className="grid h-[260px] place-items-center text-sm text-faint">Aucune donnée</div>
          ) : (
            <ChartContainer config={{}} className="h-[260px]">
              <BarChart data={topCreators} layout="vertical" margin={{ top: 4, right: 22, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="topGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor={COLORS.primary} stopOpacity={0.55} />
                    <stop offset="100%" stopColor={COLORS.primary} stopOpacity={1} />
                  </linearGradient>
                </defs>
                <CartesianGrid horizontal={false} stroke="var(--color-border)" strokeDasharray="4 8" strokeOpacity={0.6} />
                <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => fmtCompact(v)} />
                <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} width={70} />
                <Tooltip content={<ChartTooltip unit=" €" />} cursor={{ fill: "rgba(148,163,184,0.1)" }} />
                <Bar dataKey="ca" fill="url(#topGrad)" radius={[0, 7, 7, 0]} maxBarSize={26}>
                  <LabelList dataKey="ca" position="right" formatter={(v) => fmtCompact(Number(v))} style={{ fontSize: 10, fontWeight: 600, fill: "#94a3b8" }} />
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </ChartCard>

        {/* Followers par créateur */}
        <ChartCard title="Followers par créateur" subtitle="8 plus grosses audiences">
          {followersData.length === 0 ? (
            <div className="grid h-[260px] place-items-center text-sm text-faint">Aucune donnée</div>
          ) : (
            <ChartContainer config={{}} className="h-[260px]">
              <BarChart data={followersData} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="folGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.indigo} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={COLORS.indigo} stopOpacity={0.45} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="4 8" strokeOpacity={0.6} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} interval={0} angle={-20} textAnchor="end" height={44} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => fmtCompact(v)} width={38} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(148,163,184,0.1)" }} />
                <Bar dataKey="followers" fill="url(#folGrad)" radius={[7, 7, 0, 0]} maxBarSize={56} />
              </BarChart>
            </ChartContainer>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
