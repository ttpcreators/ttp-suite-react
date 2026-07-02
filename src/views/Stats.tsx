import { useEffect, useState } from "react";
import { Users, TrendingUp, Receipt, Wallet, Clock, FileText, Contact as ContactIcon, Activity } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { parseAmount, formatEuro } from "@/lib/appState";
import { titleCase } from "@/lib/utils";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import {
  BarChart,
  Bar,
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
type InvRow = { amount: string; status: string; creator: string | null };
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

function Kpi({ icon: Icon, label, value, hint, hintClass }: { icon: typeof Users; label: string; value: string; hint?: string; hintClass?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-wider text-faint">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="mt-2 whitespace-nowrap text-xl font-bold tracking-tight text-foreground sm:text-2xl">{value}</div>
      {hint && <div className={"mt-1 text-[10px] font-semibold " + (hintClass ?? "text-muted-foreground")}>{hint}</div>}
    </div>
  );
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

export function Stats() {
  const [data, setData] = useState<StatsData | null>(() => getCache<StatsData>("statsData"));
  const [error, setError] = useState(false);
  const live = useLiveKey();

  useEffect(() => {
    let alive = true;
    (async () => {
      const [cr, inv, br, co, td, id] = await Promise.all([
        supabase.from("creators").select("name,followers,er,reach,ca,status"),
        supabase.from("invoices").select("amount,status,creator"),
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
        <Kpi icon={Receipt} label="CA facturé" value={formatEuro(totalCA)} hint={`${data.invoices.length} facture${data.invoices.length > 1 ? "s" : ""}`} />
        <Kpi icon={Wallet} label="Encaissé" value={formatEuro(byStatus.payee)} hint="payé" hintClass="text-signaltext" />
        <Kpi icon={Clock} label="En attente + retard" value={formatEuro(byStatus.attente + byStatus.retard)} hint="à suivre" hintClass="text-amber" />
        <Kpi icon={Users} label="Créateurs actifs" value={`${activeCreators}`} hint={`${data.creators.length} au total`} />
        <Kpi icon={TrendingUp} label="Followers cumulés" value={fmtCompact(totalFollowers)} hint="tous créateurs" />
        <Kpi icon={Activity} label="Engagement moyen" value={`${avgEr.toFixed(1).replace(".", ",")} %`} hint={`${erVals.length} mesuré${erVals.length > 1 ? "s" : ""}`} />
        <Kpi icon={FileText} label="Briefs" value={`${data.briefs}`} hint={`${data.ideas} idées · ${data.todos} à faire`} />
        <Kpi icon={ContactIcon} label="Contacts" value={`${data.contacts}`} hint="réseau agence" />
      </div>

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
