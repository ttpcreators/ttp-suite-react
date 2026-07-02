import { useEffect, useState } from "react";
import { Users, TrendingUp, TrendingDown, Receipt, Wallet, Clock, FileText, Contact as ContactIcon, Activity } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { parseAmount, formatEuro } from "@/lib/appState";
import { titleCase, cn } from "@/lib/utils";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { StatCard } from "@/components/ui/stat-card";
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
function fmtCompact(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(Math.round(n));
}
function parsePct(s: string | null): number {
  if (!s) return 0;
  return parseFloat(s.replace(",", ".").replace(/[^0-9.]/g, "")) || 0;
}

/** "dd/mm", "dd/mm/yyyy" ou "YYYY-MM-DD" → clé de mois "YYYY-MM" (ou null). */
function invMonthKey(s: string | null): string | null {
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-\d{2}/.exec(s.trim());
  if (iso) return `${iso[1]}-${iso[2]}`;
  const dm = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s.trim());
  if (dm) {
    const mm = dm[2].padStart(2, "0");
    let yy = dm[3] ?? String(new Date().getFullYear());
    if (yy.length === 2) yy = "20" + yy;
    return `${yy}-${mm}`;
  }
  return null;
}
/** Tous les mois entre deux clés "YYYY-MM" inclus. */
function monthsBetween(start: string, end: string): string[] {
  const [ys, ms] = start.split("-").map(Number);
  const [ye, me] = end.split("-").map(Number);
  const out: string[] = [];
  let y = ys;
  let m = ms;
  for (let guard = 0; guard < 120 && (y < ye || (y === ye && m <= me)); guard++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}
/** Variation % du dernier point vs l'avant-dernier (null si non calculable honnêtement). */
function momDelta(series: number[]): number | null {
  if (series.length < 2) return null;
  const prev = series[series.length - 2];
  const last = series[series.length - 1];
  if (prev <= 0) return null;
  return ((last - prev) / prev) * 100;
}
const MONTHS_FR = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];
function monthLabel(key: string): string {
  const [, m] = key.split("-").map(Number);
  return MONTHS_FR[m - 1] ?? key;
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

export function Stats() {
  const [data, setData] = useState<StatsData | null>(() => getCache<StatsData>("statsData"));
  const [error, setError] = useState(false);
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
              <ChartContainer config={{}} className="h-[240px]">
                <PieChart>
                  <Tooltip content={<ChartTooltip unit=" €" />} />
                  <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={90} paddingAngle={2} strokeWidth={0}>
                    {statusData.map((d) => (
                      <Cell key={d.name} fill={d.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
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
              <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.5} />
              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(148,163,184,0.12)" }} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {volumeData.map((d) => (
                  <Cell key={d.name} fill={d.color} />
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
              <BarChart data={topCreators} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke="var(--color-border)" strokeOpacity={0.5} />
                <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => fmtCompact(v)} />
                <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} width={70} />
                <Tooltip content={<ChartTooltip unit=" €" />} cursor={{ fill: "rgba(148,163,184,0.12)" }} />
                <Bar dataKey="ca" fill={COLORS.primary} radius={[0, 6, 6, 0]}>
                  <LabelList dataKey="ca" position="right" formatter={(v) => fmtCompact(Number(v))} style={{ fontSize: 10, fill: "#94a3b8" }} />
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
                <CartesianGrid vertical={false} stroke="var(--color-border)" strokeOpacity={0.5} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} interval={0} angle={-20} textAnchor="end" height={44} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => fmtCompact(v)} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(148,163,184,0.12)" }} />
                <Bar dataKey="followers" fill={COLORS.indigo} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
