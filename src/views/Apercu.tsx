import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { supabase } from "@/lib/supabase";
import { titleCase, initials } from "@/lib/utils";
import { frDate } from "@/lib/dates";
import { parseAmount, formatEuro, useAppState, type AppState } from "@/lib/appState";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { LocationTag } from "@/components/ui/location-tag";
import { MiniChart } from "@/components/ui/mini-chart";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { invMonthKey, monthsBetween, monthLabel, momDelta, fmtCompact } from "@/lib/timeSeries";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { TrendingUp, TrendingDown, Users, ListChecks, CalendarDays } from "lucide-react";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";
import { Globe, type GlobeMarker } from "@/components/ui/cobe-globe";

// Villes marquées sur le globe (Lyon = siège agence + quelques hubs).
const GLOBE_MARKERS: GlobeMarker[] = [
  { location: [45.76, 4.83], size: 0.08 }, // Lyon
  { location: [48.85, 2.35], size: 0.05 }, // Paris
  { location: [51.51, -0.13], size: 0.04 }, // Londres
  { location: [40.71, -74.0], size: 0.04 }, // New York
  { location: [25.2, 55.27], size: 0.04 }, // Dubaï
  { location: [35.68, 139.65], size: 0.04 }, // Tokyo
  { location: [-23.55, -46.63], size: 0.04 }, // São Paulo
];

type Invoice = { ref: string; party: string; amount: string; date: string; status: string; creator: string | null };
type Ev = { date: string | null; day: number | null; time: string | null; title: string; type: string; who: string | null };
type Prospect = { brand: string; contact: string | null; value: string | null; stage: string | null };
type Todo = { text: string; tag: string | null; creator: string | null; priority: string | null; done: boolean };
type Brief = { brand: string; creator: string; deliverables: string | null; due: string | null; status: string | null };
type Creator = { name: string; ca: string | null; commission: string | null; status: string | null };

type Data = {
  invoices: Invoice[];
  events: Ev[];
  prospects: Prospect[];
  todos: Todo[];
  briefs: Brief[];
  creators: Creator[];
};

const TODAY = new Date().toISOString().slice(0, 10);

function evDate(e: Ev): string {
  if (e.date) return e.date;
  if (e.day) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(e.day).padStart(2, "0")}`;
  }
  return "9999-12-31";
}

/** Graphique CA mensuel : aire + dégradé (même DA que la page Stats). */
function RevenueArea({ points }: { points: { label: string; ca: number }[] }) {
  return (
    <ChartContainer config={{}} className="mt-4 h-[160px]">
      <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="apercuCA" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2b7fff" stopOpacity={0.24} />
            <stop offset="100%" stopColor="#2b7fff" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="4 10" stroke="var(--color-border)" strokeOpacity={0.6} vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} tickMargin={8} interval="preserveStartEnd" minTickGap={14} />
        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v) => fmtCompact(Number(v))} width={46} />
        <Tooltip content={<ChartTooltip unit=" €" />} cursor={{ stroke: "#2b7fff", strokeWidth: 1, strokeOpacity: 0.4 }} />
        <Area type="monotone" dataKey="ca" name="Facturé" stroke="#2b7fff" strokeWidth={2.5} fill="url(#apercuCA)" dot={false} activeDot={{ r: 4, fill: "#2b7fff", stroke: "var(--color-surface)", strokeWidth: 2 }} />
      </AreaChart>
    </ChartContainer>
  );
}

function Card({
  children,
  className = "",
  index = 0,
}: {
  children: ReactNode;
  className?: string;
  index?: number;
}) {
  return (
    <motion.div
      initial={{ y: 14 }}
      animate={{ y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.4, ease: "easeOut" }}
      className={"rounded-2xl border border-border bg-surface p-5 shadow-sm " + className}
    >
      {children}
    </motion.div>
  );
}

const invBadge = (s: string) =>
  s === "payee" ? "success" : s === "attente" ? "warning" : s === "retard" ? "danger" : "neutral";
const invLabel = (s: string) =>
  s === "payee" ? "Payée" : s === "attente" ? "En attente" : s === "retard" ? "En retard" : "Brouillon";

export function Apercu() {
  const [d, setData] = useState<Data | null>(() => getCache<Data>("apercu"));
  const [err, setErr] = useState(false);
  const live = useLiveKey();
  const { data: obj } = useAppState<Record<string, unknown> | null>(
    (s: AppState) => (s["objByMonth"] as Record<string, unknown>) ?? null,
  );

  useEffect(() => {
    let alive = true;
    Promise.all([
      supabase.from("invoices").select("ref,party,amount,date,status,creator").order("sort_order"),
      supabase.from("events").select("day,date,time,title,type,who").or("deleted.is.null,deleted.eq.false").order("sort_order"),
      supabase.from("prospects").select("brand,contact,value,stage").order("sort_order"),
      supabase.from("todos").select("text,tag,creator,priority,done").order("sort_order"),
      supabase.from("briefs").select("brand,creator,deliverables,due,status").order("sort_order"),
      supabase.from("creators").select("name,ca,commission,status").order("sort_order"),
    ])
      .then(([inv, ev, pr, td, br, cr]) => {
        if (!alive) return;
        if (inv.error || ev.error || pr.error || td.error || br.error || cr.error) {
          setErr(true);
          return;
        }
        const next: Data = {
          invoices: (inv.data as Invoice[]) ?? [],
          events: (ev.data as Ev[]) ?? [],
          prospects: (pr.data as Prospect[]) ?? [],
          todos: (td.data as Todo[]) ?? [],
          briefs: (br.data as Brief[]) ?? [],
          creators: (cr.data as Creator[]) ?? [],
        };
        setCache("apercu", next);
        setData(next);
      })
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [live]);

  if (err)
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted-foreground">
        Impossible de charger le tableau de bord.
      </div>
    );
  if (!d)
    return (
      <AnimatedBadge status="loading" size="sm">
        Chargement du tableau de bord…
      </AnimatedBadge>
    );

  const paid = d.invoices.filter((i) => i.status === "payee");
  const encaisse = paid.reduce((a, i) => a + parseAmount(i.amount), 0);
  // « Facturé » = factures RÉELLEMENT émises → hors brouillons, exactement comme la
  // courbe mensuelle (caMonthAgg) et le KPI de Stats. Sinon le total et la courbe de
  // la MÊME carte suivent deux règles différentes.
  const facture = d.invoices
    .filter((i) => i.status !== "brouillon")
    .reduce((a, i) => a + parseAmount(i.amount), 0);

  // Factures à relancer (retard)
  const retardInvoices = d.invoices.filter((i) => i.status === "retard");
  const retardCount = retardInvoices.length;
  const retardSum = retardInvoices.reduce((a, i) => a + parseAmount(i.amount), 0);

  const dealHero = d.invoices.slice().sort((a, b) => parseAmount(b.amount) - parseAmount(a.amount))[0];

  const stages = ["Prospection", "Contact", "Négociation", "Signé"];
  const pipeline = stages
    .map((st) => {
      const rows = d.prospects.filter((p) => (p.stage ?? "Prospection") === st);
      return { label: st, count: rows.length, amount: rows.reduce((a, p) => a + parseAmount(p.value), 0) };
    })
    .filter((p) => p.count > 0)
    .slice(0, 4);

  const rdv = d.events
    .filter((e) => evDate(e) >= TODAY)
    .sort((a, b) => evDate(a).localeCompare(evDate(b)))
    .slice(0, 4);

  const todosOpen = d.todos.filter((t) => !t.done).slice(0, 4);
  const briefsToValidate = d.briefs.filter((b) => b.status === "valider" || b.status === "attente").slice(0, 3);
  const briefsShown = briefsToValidate.length ? briefsToValidate : d.briefs.slice(0, 3);

  // CA par créateur = somme de SES factures payées (auto, plus de saisie manuelle).
  const caByCreator = new Map<string, number>();
  for (const i of paid) {
    const c = (i.creator ?? "").trim();
    if (!c) continue;
    caByCreator.set(c, (caByCreator.get(c) ?? 0) + parseAmount(i.amount));
  }
  const topCreators = d.creators
    .map((c) => ({ name: c.name, caNum: caByCreator.get(c.name) ?? 0 }))
    .sort((a, b) => b.caNum - a.caNum)
    .slice(0, 7);

  const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  let objPct = "—";
  const cur = obj && (obj["0"] as { pct?: number }[] | undefined);
  if (Array.isArray(cur) && cur.length) {
    // Moyenne des pourcentages — cohérent avec la page Objectifs (pas de mélange € / nombre).
    objPct = Math.round(cur.reduce((a, o) => a + (Number(o.pct) || 0), 0) / cur.length) + "%";
  } else if (facture > 0) {
    objPct = Math.round((encaisse / facture) * 100) + "%";
  }

  const recent = d.invoices.slice(0, 5);

  // Série mensuelle du CA facturé (aire + dégradé). Repli sur le MiniChart si trop peu de données.
  const caMonthAgg = new Map<string, number>();
  for (const iv of d.invoices) {
    if (iv.status === "brouillon") continue; // « facturé » = factures émises, hors brouillons
    const k = invMonthKey(iv.date);
    if (!k) continue;
    caMonthAgg.set(k, (caMonthAgg.get(k) ?? 0) + parseAmount(iv.amount));
  }
  // Timeline CONTINUE : tous les mois du premier au dernier (0 si aucune facture) →
  // espacement correct et pas de mois « sauté » qui déforme la courbe et le %.
  const caKeys = [...caMonthAgg.keys()].sort();
  const monthlyCA = (caKeys.length ? monthsBetween(caKeys[0], caKeys[caKeys.length - 1]) : [])
    .slice(-12)
    .map((k) => ({ label: monthLabel(k), ca: caMonthAgg.get(k) ?? 0 }));
  const hasMonthlyCA = monthlyCA.length >= 2 && monthlyCA.some((p) => p.ca > 0);
  const caDelta = hasMonthlyCA ? momDelta(monthlyCA.map((p) => p.ca)) : null;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1.5 text-sm text-foreground">
            Hello Marc ✌️
          </div>
          <div className="text-[26px] font-semibold tracking-tight md:text-[30px]">
            Aperçu financier
          </div>
        </div>
        <LocationTag city="Lyon" country="France" timezone="CET" />
      </div>

      {/* Raccourcis rapides */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        {[
          { id: "roster", label: "Roster", Icon: Users },
          { id: "todo", label: "À faire", Icon: ListChecks },
          { id: "planning", label: "Planning", Icon: CalendarDays },
        ].map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("ttp-navigate", { detail: s.id }))}
            className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-surface px-3 py-3.5 text-xs font-semibold text-foreground shadow-sm transition-colors hover:bg-rowhover"
          >
            <s.Icon className="h-4 w-4 text-primary" /> <span>{s.label}</span>
          </button>
        ))}
      </div>

      {hasMonthlyCA ? (
        <div className="mb-4 rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground">Chiffre d'affaires facturé</div>
              <div className="mt-0.5 text-[11px] text-faint">Évolution mensuelle</div>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-[22px] font-bold tracking-tight">{formatEuro(facture)}</div>
              {caDelta != null && (
                <span
                  className={
                    "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold " +
                    (caDelta >= 0 ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/12 text-rose-500")
                  }
                >
                  {caDelta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {Math.abs(caDelta) > 999 ? ">999" : Math.abs(caDelta).toFixed(1).replace(".", ",")} %
                </span>
              )}
            </div>
          </div>
          <RevenueArea points={monthlyCA} />
        </div>
      ) : (
        <MiniChart
          title="Montants facturés"
          unit=" €"
          valueFormatter={(n) => formatEuro(n)}
          data={d.invoices
            .slice()
            .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
            .slice(-8)
            .map((inv) => ({ label: (inv.party || "—").split(/[×x·]/)[0].trim().split(" ")[0], value: parseAmount(inv.amount) }))}
          className="mb-4"
        />
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
        <Card index={0} className="md:col-span-12">
          <div className="mb-3.5 text-sm font-semibold">Prochains rendez-vous</div>
          {rdv.length === 0 ? (
            <div className="py-4 text-xs text-muted-foreground">Aucun rendez-vous à venir.</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {rdv.map((e, i) => (
                <div key={i} className="flex min-w-0 flex-col gap-2 rounded-xl bg-panel p-3.5">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-indigo" />
                    <span className="truncate text-[10px] font-semibold tabular-nums text-muted-foreground">
                      {evDate(e).slice(8, 10)}/{evDate(e).slice(5, 7)}
                      {e.time && e.time !== "—" ? ` · ${e.time}` : ""}
                    </span>
                  </div>
                  <div className="line-clamp-2 break-words text-xs font-semibold leading-snug">{e.title}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card index={6} className="flex flex-col md:col-span-8">
          <div className="mb-4 text-sm font-semibold">Activité de l'agence</div>
          <div className="grid flex-1 grid-cols-1 gap-3.5 md:grid-cols-3">
            <div className="flex flex-col rounded-xl bg-panel p-4">
              <div className="text-[22px] font-bold tracking-tight">
                {dealHero ? formatEuro(parseAmount(dealHero.amount)) : "—"}
                <span className="ml-1 text-[11px] text-muted-foreground">DEAL</span>
              </div>
              <div className="mt-1 truncate text-[11px] text-muted-foreground">{dealHero?.party ?? "Aucun deal"}</div>
              <div className="mt-auto pt-4 text-[10px] font-medium text-faint">Plus grosse facture</div>
            </div>
            <div className="rounded-xl bg-panel p-4">
              <div className="mb-3 text-xs font-semibold">Pipeline</div>
              {pipeline.length === 0 ? (
                <div className="text-[11px] text-muted-foreground">Pipeline vide</div>
              ) : (
                pipeline.map((p) => (
                  <div key={p.label} className="flex items-center gap-2.5 py-1.5">
                    <span className="h-2 w-2 rounded-full bg-cyan" />
                    <span className="flex-1 text-[11px]">{p.label}</span>
                    <span className="text-[10px] font-semibold text-muted-foreground">
                      {p.amount ? formatEuro(p.amount) : p.count}
                    </span>
                  </div>
                ))
              )}
            </div>
            <div className="flex flex-col items-center justify-center rounded-xl bg-panel p-4 text-center">
              <div className={"grid h-[42px] w-[42px] place-items-center rounded-xl bg-surface text-lg " + (retardCount > 0 ? "text-rose-500" : "text-signaltext")}>
                {retardCount > 0 ? "⏰" : "✓"}
              </div>
              <div className="mt-3 text-xs font-semibold">
                {retardCount > 0 ? `${retardCount} facture${retardCount > 1 ? "s" : ""} à relancer` : "Aucun impayé"}
              </div>
              <div className="mt-1 text-[10px] leading-snug text-muted-foreground">
                {retardCount > 0 ? `${formatEuro(retardSum)} en retard` : "Tout est encaissé ou à jour."}
              </div>
            </div>
          </div>
        </Card>

        <Card index={7} className="relative flex items-center justify-center overflow-hidden md:col-span-4">
          <Globe
            className="w-full max-w-[200px]"
            dark={isDark ? 1 : 0}
            baseColor={isDark ? [0.14, 0.14, 0.17] : [0.9, 0.91, 0.94]}
            glowColor={isDark ? [0.05, 0.05, 0.08] : [0.9, 0.92, 0.96]}
            markerColor={[0.17, 0.5, 1]}
            markers={GLOBE_MARKERS}
          />
          <div className="pointer-events-none absolute bottom-4 left-5">
            <div className="text-[9px] font-semibold uppercase tracking-wide text-faint">Objectif mensuel</div>
            <div className="text-lg font-bold text-foreground">{objPct}</div>
          </div>
        </Card>

        <Card index={8} className="md:col-span-6">
          <div className="mb-3.5 text-sm font-semibold">À faire</div>
          {todosOpen.length === 0 ? (
            <div className="py-2 text-xs text-muted-foreground">Rien à faire 🎉</div>
          ) : (
            todosOpen.map((t, i) => (
              <div key={i} className="flex items-center gap-2.5 py-[7px]">
                <span className="h-4 w-4 shrink-0 rounded-[5px] border border-faint" />
                <span className="flex-1 truncate text-xs">{t.text}</span>
                <span className="rounded-md bg-rowhover px-2 py-0.5 text-[9px] font-semibold text-muted-foreground">
                  {t.creator ? titleCase(t.creator) : "Agence"}
                </span>
              </div>
            ))
          )}
        </Card>

        <Card index={9} className="md:col-span-6">
          <div className="mb-3.5 text-sm font-semibold">Briefs à valider</div>
          {briefsShown.length === 0 ? (
            <div className="py-2 text-xs text-muted-foreground">Aucun brief.</div>
          ) : (
            briefsShown.map((b, i) => (
              <div key={i} className="flex items-center gap-2.5 border-b border-border py-2 last:border-0">
                <span className="h-2 w-2 shrink-0 rounded-full bg-signal" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">
                    {b.brand} × {titleCase(b.creator)}
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">{b.deliverables}</div>
                </div>
                <span className="text-[9px] font-semibold text-muted-foreground">{frDate(b.due)}</span>
              </div>
            ))
          )}
        </Card>

        <Card index={10} className="md:col-span-6">
          <div className="mb-4 text-sm font-semibold">Qui rapporte</div>
          {topCreators.length === 0 ? (
            <div className="py-2 text-xs text-muted-foreground">Aucun créateur.</div>
          ) : (
            topCreators.map((c, i) => (
              <div key={c.name} className="flex items-center gap-3 py-[7px]">
                <span className="w-4 text-[11px] font-semibold text-muted-foreground">{i + 1}</span>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted text-[9px] font-semibold text-muted-foreground">
                  {initials(c.name)}
                </span>
                <span className="flex-1 truncate text-xs font-medium">{titleCase(c.name)}</span>
                <span className="text-xs font-semibold">{c.caNum ? formatEuro(c.caNum) : "—"}</span>
              </div>
            ))
          )}
        </Card>

        <Card index={11} className="md:col-span-6">
          <div className="mb-3.5 flex items-center justify-between">
            <div className="text-sm font-semibold">Factures récentes</div>
            <span className="text-[9px] font-semibold text-muted-foreground">5 DERNIÈRES</span>
          </div>
          {recent.length === 0 ? (
            <div className="py-2 text-xs text-muted-foreground">Aucune facture.</div>
          ) : (
            recent.map((inv, i) => (
              <div key={i} className="flex items-center gap-3 border-b border-border py-2 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{inv.party}</div>
                  <div className="text-[10px] text-muted-foreground">#{inv.ref}</div>
                </div>
                <span className="text-xs font-semibold">{formatEuro(parseAmount(inv.amount))}</span>
                <AnimatedBadge status={invBadge(inv.status)} size="sm">
                  {invLabel(inv.status)}
                </AnimatedBadge>
              </div>
            ))
          )}
        </Card>
      </div>
    </div>
  );
}
