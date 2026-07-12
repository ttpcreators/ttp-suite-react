import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { supabase } from "@/lib/supabase";
import { parseAmount } from "@/lib/money";
import { titleCase, initials } from "@/lib/utils";
import { frDate } from "@/lib/dates";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { useLiveKey } from "@/lib/useLive";
import {
  Wallet,
  Percent,
  Users,
  ListChecks,
  CalendarDays,
  AlertTriangle,
  TrendingUp,
  Trophy,
} from "lucide-react";

// ── Types (sous-ensemble des tables, juste ce qu'il faut pour la vue) ──
type Invoice = { amount: string | null; status: string | null; date: string | null; creator: string | null };
type Creator = { name: string; status: string | null };
type Prospect = { stage: string | null; value: string | null };
type Ev = { date: string | null; title: string | null; who: string | null };
type Todo = { done: boolean | null };
type Brief = { status: string | null };

type Data = {
  invoices: Invoice[];
  creators: Creator[];
  prospects: Prospect[];
  events: Ev[];
  todos: Todo[];
  briefs: Brief[];
};

const TODAY = new Intl.DateTimeFormat("fr-CA").format(new Date());
const MONTH_LABEL = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(new Date());
const monthKey = (iso: string | null): string => {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[1]}-${m[2]}` : "";
};
const NOW_KEY = monthKey(TODAY);

/** Carte bento animée (entrée douce décalée), au style de l'app. */
function Card({ children, className = "", index = 0 }: { children: ReactNode; className?: string; index?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4, ease: "easeOut" }}
      className={"rounded-2xl border border-border bg-surface p-5 shadow-sm " + className}
    >
      {children}
    </motion.div>
  );
}

/** Grand chiffre animé en euros (ou tiret si zéro/indispo). */
function Euro({ value, className = "" }: { value: number; className?: string }) {
  if (!value) return <span className={className}>—</span>;
  return (
    <NumberFlow
      value={value}
      locales="fr-FR"
      format={{ style: "currency", currency: "EUR", maximumFractionDigits: 0 }}
      className={className}
    />
  );
}

export function VueEnsemble() {
  const [d, setD] = useState<Data | null>(null);
  const live = useLiveKey();

  useEffect(() => {
    let alive = true;
    Promise.all([
      supabase.from("invoices").select("amount,status,date,creator"),
      supabase.from("creators").select("name,status"),
      supabase.from("prospects").select("stage,value"),
      supabase.from("events").select("date,title,who").or("deleted.is.null,deleted.eq.false"),
      supabase.from("todos").select("done"),
      supabase.from("briefs").select("status"),
    ]).then(([inv, cr, pr, ev, td, br]) => {
      if (!alive) return;
      setD({
        invoices: (inv.data as Invoice[]) ?? [],
        creators: (cr.data as Creator[]) ?? [],
        prospects: (pr.data as Prospect[]) ?? [],
        events: (ev.data as Ev[]) ?? [],
        todos: (td.data as Todo[]) ?? [],
        briefs: (br.data as Brief[]) ?? [],
      });
    });
    return () => {
      alive = false;
    };
  }, [live]);

  if (!d) {
    return (
      <AnimatedBadge status="loading" size="sm">
        Chargement de la vue d'ensemble…
      </AnimatedBadge>
    );
  }

  // ── Calculs (mêmes règles que le reste de l'app) ──
  const paid = d.invoices.filter((i) => i.status === "payee");
  const encaisse = paid.reduce((a, i) => a + parseAmount(i.amount), 0);
  const facture = d.invoices.reduce((a, i) => a + parseAmount(i.amount), 0);
  const taux = facture > 0 ? Math.round((encaisse / facture) * 100) : 0;

  const encaisseMois = paid.filter((i) => monthKey(i.date) === NOW_KEY).reduce((a, i) => a + parseAmount(i.amount), 0);

  const retard = d.invoices.filter((i) => i.status === "retard");
  const retardSum = retard.reduce((a, i) => a + parseAmount(i.amount), 0);

  const caByCreator = new Map<string, number>();
  for (const i of paid) {
    const c = (i.creator ?? "").trim();
    if (!c) continue;
    caByCreator.set(c, (caByCreator.get(c) ?? 0) + parseAmount(i.amount));
  }
  const top = [...caByCreator.entries()].map(([name, ca]) => ({ name, ca })).sort((a, b) => b.ca - a.ca).slice(0, 4);

  const stages = ["Prospection", "Contact", "Négociation", "Signé"];
  const pipeline = stages
    .map((st) => {
      const rows = d.prospects.filter((p) => (p.stage ?? "Prospection") === st);
      return { label: st, count: rows.length, amount: rows.reduce((a, p) => a + parseAmount(p.value), 0) };
    })
    .filter((s) => s.count > 0);
  const pipelineTotal = pipeline.reduce((a, s) => a + s.amount, 0);

  const activeCreators = d.creators.filter((c) => String(c.status ?? "actif").toLowerCase() !== "inactif").length;

  const todosOpen = d.todos.filter((t) => !t.done).length;
  const briefsPending = d.briefs.filter((b) => b.status === "valider" || b.status === "attente").length;

  const rdv = d.events
    .filter((e) => (e.date ?? "") >= TODAY)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
    .slice(0, 4);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Vue d'ensemble</h1>
        <p className="text-sm capitalize text-muted-foreground">{MONTH_LABEL}</p>
      </div>

      {/* Grille bento : 6 colonnes en desktop, cartes de tailles variées */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {/* HERO — CA encaissé */}
        <Card index={0} className="col-span-2 flex flex-col justify-between md:col-span-3 md:row-span-2">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
            <Wallet className="h-4 w-4" /> CA encaissé
          </div>
          <div className="mt-3">
            <Euro value={encaisse} className="text-4xl font-bold tracking-tight text-foreground md:text-5xl" />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-panel px-3 py-1.5 text-xs font-semibold text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5 text-signal" /> Ce mois <Euro value={encaisseMois} className="text-foreground" />
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-panel px-3 py-1.5 text-xs font-semibold text-muted-foreground">
              Facturé <Euro value={facture} className="text-foreground" />
            </span>
          </div>
        </Card>

        {/* Taux d'encaissement */}
        <Card index={1} className="col-span-1 md:col-span-2">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
            <Percent className="h-4 w-4" /> Encaissement
          </div>
          <div className="mt-2 flex items-baseline text-3xl font-bold tracking-tight text-foreground">
            <NumberFlow value={taux} locales="fr-FR" />
            <span className="ml-0.5 text-lg">%</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-panel">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, taux)}%` }} />
          </div>
        </Card>

        {/* Factures en retard */}
        <Card index={2} className="col-span-1 md:col-span-1">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
            <AlertTriangle className={"h-4 w-4 " + (retard.length ? "text-amber-500" : "")} /> Retard
          </div>
          <div className="mt-2 flex items-baseline text-3xl font-bold tracking-tight text-foreground">
            <NumberFlow value={retard.length} />
          </div>
          <div className="mt-1 truncate text-[11px] text-faint">{retard.length ? <Euro value={retardSum} /> : "à jour ✓"}</div>
        </Card>

        {/* Roster */}
        <Card index={3} className="col-span-2 md:col-span-2">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
            <Users className="h-4 w-4" /> Roster
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-foreground">
              <NumberFlow value={d.creators.length} />
            </span>
            <span className="text-xs text-muted-foreground">créateur{d.creators.length > 1 ? "s" : ""}</span>
          </div>
          <div className="mt-1 text-[11px] text-faint">
            <NumberFlow value={activeCreators} /> actif{activeCreators > 1 ? "s" : ""}
          </div>
        </Card>

        {/* Qui rapporte */}
        <Card index={4} className="col-span-2 md:col-span-3">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
            <Trophy className="h-4 w-4" /> Qui rapporte
          </div>
          {top.length === 0 ? (
            <div className="py-2 text-xs text-muted-foreground">Aucune facture payée pour l'instant.</div>
          ) : (
            <div className="flex flex-col gap-1">
              {top.map((c, i) => (
                <div key={c.name} className="flex items-center gap-3 py-1">
                  <span className="w-4 text-[11px] font-semibold text-muted-foreground">{i + 1}</span>
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-panel text-[9px] font-semibold text-muted-foreground">
                    {initials(c.name)}
                  </span>
                  <span className="flex-1 truncate text-xs font-medium text-foreground">{titleCase(c.name)}</span>
                  <Euro value={c.ca} className="text-xs font-semibold text-foreground" />
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Pipeline prospection */}
        <Card index={5} className="col-span-2 md:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
              <TrendingUp className="h-4 w-4" /> Pipeline
            </div>
            {pipelineTotal > 0 && <Euro value={pipelineTotal} className="text-xs font-semibold text-muted-foreground" />}
          </div>
          {pipeline.length === 0 ? (
            <div className="py-2 text-xs text-muted-foreground">Aucun prospect en cours.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {pipeline.map((s) => (
                <div key={s.label} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 truncate text-xs font-medium text-muted-foreground">{s.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel">
                    <div className="h-full rounded-full bg-primary/70" style={{ width: `${pipelineTotal > 0 ? Math.max(6, Math.round((s.amount / pipelineTotal) * 100)) : 6}%` }} />
                  </div>
                  <span className="w-6 shrink-0 text-right text-[11px] font-semibold text-faint">{s.count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* À faire / Briefs */}
        <Card index={6} className="col-span-2 md:col-span-2">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
            <ListChecks className="h-4 w-4" /> À traiter
          </div>
          <div className="mt-3 flex items-end gap-5">
            <div>
              <div className="text-3xl font-bold tracking-tight text-foreground">
                <NumberFlow value={todosOpen} />
              </div>
              <div className="text-[11px] text-faint">tâche{todosOpen > 1 ? "s" : ""}</div>
            </div>
            <div>
              <div className="text-3xl font-bold tracking-tight text-foreground">
                <NumberFlow value={briefsPending} />
              </div>
              <div className="text-[11px] text-faint">brief{briefsPending > 1 ? "s" : ""}</div>
            </div>
          </div>
        </Card>

        {/* RDV à venir */}
        <Card index={7} className="col-span-2 md:col-span-4">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
            <CalendarDays className="h-4 w-4" /> Prochains RDV
          </div>
          {rdv.length === 0 ? (
            <div className="py-2 text-xs text-muted-foreground">Rien de prévu à venir.</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {rdv.map((e, i) => (
                <div key={i} className="flex items-center gap-3 border-b border-border py-1.5 last:border-0">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-panel">
                    <CalendarDays className="h-4 w-4 text-muted-foreground" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-foreground">{e.title || "Évènement"}</div>
                    {e.who && <div className="truncate text-[11px] text-faint">{titleCase(e.who)}</div>}
                  </div>
                  <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">{frDate(e.date)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
