import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { supabase } from "@/lib/supabase";
import { titleCase, initials } from "@/lib/utils";
import { parseAmount, formatEuro, useAppState, type AppState } from "@/lib/appState";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { LocationTag } from "@/components/ui/location-tag";
import { MiniChart } from "@/components/ui/mini-chart";
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

function DotMatrix({ ratio, tone }: { ratio: number; tone: "signal" | "muted" }) {
  const total = 120;
  const filled = Math.round(Math.min(1, Math.max(0, ratio)) * total);
  return (
    <div className="flex flex-wrap gap-[5px]">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={
            "h-[6px] w-[6px] rounded-full " +
            (i < filled ? (tone === "signal" ? "bg-signal" : "bg-foreground/70") : "bg-rowhover")
          }
        />
      ))}
    </div>
  );
}

function Bars({ heights, color, h }: { heights: number[]; color: string; h: number }) {
  return (
    <div className="flex items-end gap-[3px]" style={{ height: h }}>
      {heights.map((v, i) => (
        <motion.span
          key={i}
          className={"flex-1 rounded-[3px] " + color}
          initial={{ height: 0 }}
          animate={{ height: `${v}%` }}
          transition={{ delay: 0.15 + i * 0.03, type: "spring", stiffness: 200, damping: 24 }}
        />
      ))}
    </div>
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
        if (inv.error && ev.error && cr.error) {
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
  const attente = d.invoices.filter((i) => i.status === "attente").reduce((a, i) => a + parseAmount(i.amount), 0);
  const facture = d.invoices.reduce((a, i) => a + parseAmount(i.amount), 0);

  const comms = d.creators.map((c) => parseAmount(c.commission)).filter((n) => n > 0);
  const avgComm = comms.length ? comms.reduce((a, b) => a + b, 0) / comms.length / 100 : 0.2;
  const reverse = Math.round(encaisse * (1 - avgComm));
  const margePct = Math.round(avgComm * 100);

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

  const topCreators = d.creators
    .slice()
    .sort((a, b) => parseAmount(b.ca) - parseAmount(a.ca))
    .slice(0, 4);

  const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  let objPct = "—";
  const cur = obj && (obj["0"] as { ca?: string; target?: string }[] | undefined);
  if (Array.isArray(cur) && cur.length) {
    const t = cur.reduce((a, o) => a + parseAmount(o.target), 0);
    const c = cur.reduce((a, o) => a + parseAmount(o.ca), 0);
    if (t > 0) objPct = Math.round((c / t) * 100) + "%";
  } else if (facture > 0) {
    objPct = Math.round((encaisse / facture) * 100) + "%";
  }

  const H = (seed: number, n: number) =>
    Array.from({ length: n }, (_, i) => 35 + ((Math.sin(seed + i * 1.3) + 1) / 2) * 60);

  const recent = d.invoices.slice(0, 5);

  return (
    <div>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <div className="mb-1.5 text-sm text-foreground">
            Hello Marc ✌️
          </div>
          <div className="text-[26px] font-semibold tracking-tight md:text-[30px]">
            Aperçu financier
          </div>
        </div>
        <LocationTag city="Lyon" country="France" timezone="CET" />
      </div>

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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
        <Card index={0} className="md:col-span-12">
          <div className="mb-3.5 text-sm font-semibold">Prochains rendez-vous</div>
          {rdv.length === 0 ? (
            <div className="py-4 text-xs text-muted-foreground">Aucun rendez-vous à venir.</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {rdv.map((e, i) => (
                <div key={i} className="min-w-0 rounded-xl bg-panel p-3.5">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-indigo" />
                    <span className="text-[10px] font-semibold text-muted-foreground">
                      {evDate(e).slice(8, 10)}/{evDate(e).slice(5, 7)}
                      {e.time && e.time !== "—" ? ` · ${e.time}` : ""}
                    </span>
                  </div>
                  <div className="mt-2 truncate text-xs font-semibold">{e.title}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card index={1} className="flex flex-col md:col-span-3">
          <div className="flex items-center justify-between">
            <div className="grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-signalsoft text-sm font-bold text-signaltext">€</div>
            <span className="rounded-lg bg-rowhover px-2.5 py-1 text-[9px] font-semibold tracking-wide text-muted-foreground">ENCAISSÉ</span>
          </div>
          <div className="my-5">
            <DotMatrix ratio={facture ? encaisse / facture : 0} tone="signal" />
          </div>
          <div className="mt-auto">
            <div className="text-[11px] text-muted-foreground">CA encaissé</div>
            <div className="mt-1 whitespace-nowrap text-[26px] font-bold tracking-tight">{formatEuro(encaisse)}</div>
          </div>
        </Card>

        <Card index={2} className="flex flex-col md:col-span-3">
          <div className="flex items-center justify-between">
            <div className="grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-rowhover text-sm font-bold text-muted-foreground">↩</div>
            <span className="rounded-lg bg-rowhover px-2.5 py-1 text-[9px] font-semibold tracking-wide text-muted-foreground">REVERSÉ</span>
          </div>
          <div className="my-5">
            <DotMatrix ratio={facture ? reverse / facture : 0} tone="muted" />
          </div>
          <div className="mt-auto">
            <div className="text-[11px] text-muted-foreground">Reversé aux créateurs</div>
            <div className="mt-1 whitespace-nowrap text-[26px] font-bold tracking-tight">{formatEuro(reverse)}</div>
          </div>
        </Card>

        <Card index={3} className="relative flex items-center justify-center overflow-hidden md:col-span-2">
          <Globe
            className="w-full max-w-[190px]"
            dark={isDark ? 1 : 0}
            baseColor={isDark ? [0.14, 0.14, 0.17] : [0.9, 0.91, 0.94]}
            glowColor={isDark ? [0.05, 0.05, 0.08] : [0.9, 0.92, 0.96]}
            markerColor={[0.17, 0.5, 1]}
            markers={GLOBE_MARKERS}
          />
          <div className="pointer-events-none absolute bottom-3 left-4">
            <div className="text-[8px] font-semibold uppercase tracking-wide text-faint">Objectif mensuel</div>
            <div className="text-sm font-bold text-foreground">{objPct}</div>
          </div>
        </Card>
        <Card index={4} className="flex flex-col md:col-span-2">
          <div className="flex items-baseline justify-between">
            <div className="text-[22px] font-bold tracking-tight">
              {margePct}
              <span className="text-[13px]">%</span>
            </div>
            <div className="text-right text-[8px] leading-tight text-muted-foreground">Marge<br />agence</div>
          </div>
          <div className="mt-auto pt-3.5">
            <Bars heights={H(2, 11)} color="bg-primary/60" h={42} />
          </div>
        </Card>

        <Card index={5} className="flex flex-col md:col-span-2">
          <div className="text-[11px] text-muted-foreground">Total facturé</div>
          <div className="mt-1 whitespace-nowrap text-[20px] font-bold tracking-tight">{formatEuro(facture)}</div>
          <svg viewBox="0 0 360 70" preserveAspectRatio="none" className="mt-auto h-12 w-full">
            <path
              d="M4,46 C30,30 46,52 70,40 C96,28 110,54 134,42 C160,30 174,18 200,30 C226,42 240,24 266,32 C292,40 306,18 332,22 C346,24 352,20 356,18"
              fill="none"
              stroke="var(--signal)"
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </Card>

        <Card index={6} className="md:col-span-8">
          <div className="mb-4 text-sm font-semibold">Activité de l'agence</div>
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
            <div className="flex flex-col rounded-xl bg-panel p-4">
              <div className="text-[22px] font-bold tracking-tight">
                {dealHero ? formatEuro(parseAmount(dealHero.amount)) : "—"}
                <span className="ml-1 text-[11px] text-muted-foreground">DEAL</span>
              </div>
              <div className="mt-1 truncate text-[11px] text-muted-foreground">{dealHero?.party ?? "Aucun deal"}</div>
              <div className="mt-auto pt-4">
                <Bars heights={H(5, 9)} color="bg-signal" h={44} />
              </div>
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
              <div className="grid h-[42px] w-[42px] place-items-center rounded-xl bg-surface text-lg text-amber">✲</div>
              <div className="mt-3 text-xs font-semibold">
                {attente ? `${formatEuro(attente)} en attente` : "Tout est à jour"}
              </div>
              <div className="mt-1 text-[10px] leading-snug text-muted-foreground">Relance tes factures impayées.</div>
            </div>
          </div>
        </Card>

        <Card index={7} className="flex flex-col bg-foreground text-background md:col-span-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[11px] text-faint">CA total facturé</div>
              <div className="mt-1.5 text-[40px] font-bold leading-none tracking-tighter">{formatEuro(facture)}</div>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1.5 text-[9px] font-semibold text-signal">
              <span className="h-1.5 w-1.5 rounded-full bg-signal" /> EN HAUSSE
            </div>
          </div>
          <div className="mt-auto pt-4">
            <Bars heights={H(9, 14)} color="bg-signal" h={54} />
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
                <span className="text-[9px] font-semibold text-muted-foreground">{b.due}</span>
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
                <span className="text-xs font-semibold">{c.ca ? formatEuro(parseAmount(c.ca)) : "—"}</span>
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
