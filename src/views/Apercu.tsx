import { useEffect, useState, lazy, Suspense, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { supabase } from "@/lib/supabase";
import { cn, titleCase, initials } from "@/lib/utils";
import { frDate, toISODate } from "@/lib/dates";
import { parseAmount, formatEuro, useAppState, type AppState } from "@/lib/appState";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { Delta, RadialTicks, TickMeter, SegmentBar } from "@/components/ui/dash";
import { invMonthKey, monthsBetween, monthLabel, momDelta } from "@/lib/timeSeries";
import { Users, ListChecks, CalendarDays, Wallet, ArrowRight, Sparkles, FileText, Trophy, CalendarClock } from "lucide-react";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { presetRange, previousRange, rangeBounds, rangeDays, sameRange, standardPresets, type DateRange } from "@/lib/dateRange";

// Graphique recharts lazy-chargé : sort la lib (~101 Ko gzip) du premier écran.
const DashArea = lazy(() => import("@/views/charts/DashArea"));

/**
 * Aperçu, tableau de bord « Minuit » (inspiré du dashboard Efferd, refait à la
 * main avec les tokens de l'app). `Apercu` charge les données ; `ApercuView` ne
 * fait QUE l'affichage à partir de props (testable avec des données d'exemple).
 */

export type Invoice = { id: string; ref: string; party: string; amount: string; date: string; status: string; creator: string | null };
export type Ev = { date: string | null; day: number | null; time: string | null; title: string; type: string; who: string | null };
export type Todo = { text: string; tag: string | null; creator: string | null; priority: string | null; done: boolean };
export type Brief = { brand: string; creator: string; deliverables: string | null; due: string | null; status: string | null };
export type Creator = { name: string; ca: string | null; commission: string | null; status: string | null };

export type ApercuData = {
  invoices: Invoice[];
  events: Ev[];
  todos: Todo[];
  briefs: Brief[];
  creators: Creator[];
};

export type Cockpit = { jour: string; contenu: string } | null;

const MONTHS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function evDate(e: Ev): string {
  if (e.date) return e.date;
  if (e.day) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(e.day).padStart(2, "0")}`;
  }
  return "9999-12-31";
}

/** Date texte (ISO ou jj/mm/aaaa) → millisecondes (midi local), ou NaN. */
function toMs(s: string | null | undefined): number {
  const iso = toISODate(s);
  if (!iso) return NaN;
  return new Date(`${iso}T12:00:00`).getTime();
}

const pctChange = (cur: number, prev: number): number | null => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Bonne nuit";
  if (h < 12) return "Bonjour";
  if (h < 18) return "Bon après-midi";
  return "Bonsoir";
}

const go = (id: string) => window.dispatchEvent(new CustomEvent("ttp-navigate", { detail: id }));

const invBadge = (s: string) =>
  s === "payee" ? "success" : s === "attente" ? "warning" : s === "retard" ? "danger" : "neutral";
const invLabel = (s: string) =>
  s === "payee" ? "Payée" : s === "attente" ? "En attente" : s === "retard" ? "En retard" : "Brouillon";

/** Panneau bordé (en Minuit, il se fond dans le fond : seules ses bordures le dessinent). */
function Panel({ children, className = "", i = 0 }: { children: ReactNode; className?: string; i?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.section
      initial={reduce ? false : { y: 10 }}
      animate={{ y: 0 }}
      transition={{ delay: i * 0.05, duration: 0.4, ease: "easeOut" }}
      className={cn("overflow-hidden rounded-2xl border border-border bg-surface", className)}
    >
      {children}
    </motion.section>
  );
}

/** Petit bouton plein largeur « Voir … → » (style Efferd). */
function WideLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover"
    >
      {label} <ArrowRight className="h-3.5 w-3.5" />
    </button>
  );
}

function SectionTitle({ icon: Icon, children, right }: { icon: typeof Users; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h2 className="text-[14px] font-semibold text-foreground">{children}</h2>
      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function ApercuView({
  d,
  invDetails,
  obj,
  cockpit,
}: {
  d: ApercuData;
  invDetails: Record<string, { issueDate?: string }>;
  obj: Record<string, unknown> | null;
  cockpit: Cockpit;
}) {
  // Fenêtre des KPI : raccourci 7 / 30 / 90 jours ou dates libres (calendrier).
  const [range, setRange] = useState<DateRange>(() => presetRange("30j")!);
  const quick = (["7j", "30j", "90j"] as const).find((id) => sameRange(presetRange(id), range)) ?? null;
  const [caBasis, setCaBasis] = useState<"emission" | "echeance">("emission");

  const issued = d.invoices.filter((i) => i.status !== "brouillon");
  const issueMs = (iv: Invoice) => toMs(invDetails[iv.id]?.issueDate || iv.date);

  // ── KPI : période courante vs précédente (par date d'émission) ──
  const inWin = (ms: number, [from, to]: [number, number]) => Number.isFinite(ms) && ms >= from && ms < to;
  const cur = issued.filter((iv) => inWin(issueMs(iv), rangeBounds(range)));
  const prev = issued.filter((iv) => inWin(issueMs(iv), rangeBounds(previousRange(range))));
  const sum = (xs: Invoice[]) => xs.reduce((a, i) => a + parseAmount(i.amount), 0);
  const factCur = sum(cur);
  const factPrev = sum(prev);
  const avgCur = cur.length ? factCur / cur.length : 0;
  const avgPrev = prev.length ? factPrev / prev.length : 0;
  const periodSuffix = quick ? `vs ${rangeDays(range)} j préc.` : "vs période préc.";

  // ── Série mensuelle (timeline continue, 12 derniers mois) ──
  const caMonthAgg = new Map<string, number>();
  for (const iv of issued) {
    const basisDate = caBasis === "emission" ? invDetails[iv.id]?.issueDate || iv.date : iv.date;
    const k = invMonthKey(basisDate);
    if (!k) continue;
    caMonthAgg.set(k, (caMonthAgg.get(k) ?? 0) + parseAmount(iv.amount));
  }
  const caKeys = [...caMonthAgg.keys()].sort();
  // La série va au moins jusqu'au mois EN COURS (sinon « ce mois » afficherait un mois passé).
  const todayKey = localISO(new Date()).slice(0, 7);
  const endKey = caKeys.length && caKeys[caKeys.length - 1] > todayKey ? caKeys[caKeys.length - 1] : todayKey;
  const monthKeys = caKeys.length ? monthsBetween(caKeys[0] < todayKey ? caKeys[0] : todayKey, endKey).slice(-12) : [];
  const monthly = monthKeys.map((k) => {
    const [y, m] = k.split("-").map(Number);
    return { label: monthLabel(k), full: `${MONTHS_LONG[m - 1]} ${y}`, value: caMonthAgg.get(k) ?? 0 };
  });
  const hasChart = monthly.length >= 2 && monthly.some((p) => p.value > 0);
  // « Ce mois » = le mois civil en cours, comparé au mois précédent (lus par clé).
  const curIdx = monthKeys.indexOf(todayKey);
  const lastMonth = caMonthAgg.get(todayKey) ?? 0;
  const mom = curIdx > 0 ? momDelta([monthly[curIdx - 1].value, monthly[curIdx].value]) : null;

  // ── Répartition du facturé (statuts) ──
  const byStatus = (st: string) => sum(issued.filter((i) => i.status === st));
  const paidSum = byStatus("payee");
  const waitSum = byStatus("attente");
  const lateSum = byStatus("retard");
  const factTotal = sum(issued);
  const lateCount = issued.filter((i) => i.status === "retard").length;

  // ── Jauge : objectif du mois (moyenne des %) sinon taux d'encaissement ──
  // Objectifs rangés par mois (« aaaa-mm ») ; « 0 » = ancien format, repli seulement.
  const objCur = obj && ((obj[todayKey] ?? obj["0"]) as { pct?: number }[] | undefined);
  const hasObj = Array.isArray(objCur) && objCur.length > 0;
  const gaugePct = hasObj
    ? objCur.reduce((a, o) => a + Math.max(0, Math.min(100, Number(o.pct) || 0)), 0) / objCur.length / 100
    : factTotal > 0
      ? paidSum / factTotal
      : 0;
  const gaugeLabel = hasObj ? "Objectif du mois" : "Taux d'encaissement";
  const gaugeRound = Math.round(Math.max(0, Math.min(1, gaugePct)) * 100);

  // ── Créatrices actives ──
  const isActive = (c: Creator) => !c.status || /^actif/i.test(c.status.trim());
  const activeCount = d.creators.filter(isActive).length;
  const activePct = d.creators.length ? activeCount / d.creators.length : 0;

  // ── Dernière facture émise ──
  const lastInv = issued.slice().sort((a, b) => (issueMs(b) || 0) - (issueMs(a) || 0))[0];

  // ── Insight : cockpit du jour de Megan, sinon calculé depuis les données ──
  const todayIso = localISO(new Date());
  const megan = cockpit && cockpit.jour === todayIso
    ? cockpit.contenu
        .split("\n")
        .map((l) => l.replace(/^[\s#*•>\-–—]+/, "").trim())
        .find((l) => l.length > 12) ?? null
    : null;
  const briefsWaiting = d.briefs.filter((b) => b.status === "valider" || b.status === "attente");
  const openTodos = d.todos.filter((t) => !t.done);
  const hi = (s: string) => <span className="text-foreground">{s}</span>;
  let insight: ReactNode;
  if (megan) insight = megan;
  else if (lateCount > 0)
    insight = (
      <>
        {hi(`${lateCount} facture${lateCount > 1 ? "s" : ""} en retard`)} pour <span className="whitespace-nowrap text-foreground">{formatEuro(lateSum)}</span>. Une relance cette semaine débloquerait l'encaissement.
      </>
    );
  else if (mom != null && mom > 0)
    insight = (
      <>
        Le chiffre d'affaires {caBasis === "emission" ? "facturé" : "attendu (par échéance)"} progresse de {hi(`${mom.toFixed(1).replace(".", ",")} %`)} ce mois-ci par rapport au mois précédent.
      </>
    );
  else if (briefsWaiting.length > 0)
    insight = (
      <>
        {hi(`${briefsWaiting.length} brief${briefsWaiting.length > 1 ? "s" : ""}`)} attendent ta validation avant de partir en production.
      </>
    );
  else if (openTodos.length > 0)
    insight = (
      <>
        Il reste {hi(`${openTodos.length} tâche${openTodos.length > 1 ? "s" : ""}`)} ouvertes. Commence par la plus ancienne.
      </>
    );
  else insight = <>Tout est à jour. {hi("Belle journée pour prospecter.")}</>;

  // ── Blocs opérationnels ──
  const rdv = d.events
    .filter((e) => evDate(e) >= todayIso)
    .sort((a, b) => evDate(a).localeCompare(evDate(b)))
    .slice(0, 4);
  const briefsShown = (briefsWaiting.length ? briefsWaiting : d.briefs).slice(0, 4);
  const caByCreator = new Map<string, number>();
  for (const i of issued.filter((x) => x.status === "payee")) {
    const c = (i.creator ?? "").trim();
    if (c) caByCreator.set(c, (caByCreator.get(c) ?? 0) + parseAmount(i.amount));
  }
  const topCreators = d.creators
    .map((c) => ({ name: c.name, ca: caByCreator.get(c.name) ?? 0 }))
    .sort((a, b) => b.ca - a.ca)
    .slice(0, 5);

  const kpis = [
    { label: "Facturé", value: formatEuro(factCur), delta: pctChange(factCur, factPrev) },
    { label: "Factures émises", value: String(cur.length), delta: pctChange(cur.length, prev.length) },
    { label: "Facture moyenne", value: cur.length ? formatEuro(Math.round(avgCur)) : "—", delta: cur.length ? pctChange(avgCur, avgPrev) : null },
  ];

  return (
    <div>
      {/* En-tête : salutation + période */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[24px] font-semibold tracking-tight md:text-[28px]">{greeting()}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border bg-surface p-0.5">
            {(["7j", "30j", "90j"] as const).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setRange(presetRange(id)!)}
                aria-pressed={quick === id}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                  quick === id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {parseInt(id, 10)} jours
              </button>
            ))}
          </div>
          {/* Dates libres : raccourcis + calendrier « du … au … » */}
          <DateRangePicker
            value={range}
            onChange={(r) => r && setRange(r)}
            presets={standardPresets(["7j", "30j", "90j", "mois", "mois-1", "annee", "12m"])}
          />
        </div>
      </div>

      {/* Raccourcis (mobile uniquement : sur ordinateur, la barre latérale suffit) */}
      <div className="mb-4 grid grid-cols-3 gap-2 md:hidden">
        {[
          { id: "roster", label: "Roster", Icon: Users },
          { id: "todo", label: "To-do", Icon: ListChecks },
          { id: "planning", label: "Planning", Icon: CalendarDays },
        ].map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => go(s.id)}
            className="flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3 py-3 text-xs font-semibold text-foreground transition-colors hover:bg-rowhover"
          >
            <s.Icon className="h-4 w-4 text-muted-foreground" /> {s.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* ── Colonne principale ── (flex : la dernière rangée s'étire jusqu'en bas) */}
        <Panel className="flex flex-col xl:col-span-8" i={0}>
          {/* KPI séparés par des filets */}
          <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {kpis.map((k) => (
              <div key={k.label} className="px-5 py-5">
                <div className="text-[13px] text-muted-foreground">{k.label}</div>
                <div className="mt-2 text-[28px] font-semibold leading-none tracking-tight tabular-nums">{k.value}</div>
                <div className="mt-3">
                  <Delta value={k.delta} suffix={periodSuffix} />
                </div>
              </div>
            ))}
          </div>

          {/* Grand graphique */}
          <div className="border-t border-border px-5 pb-3 pt-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[30px] font-semibold leading-none tracking-tight tabular-nums">{formatEuro(lastMonth)}</div>
                <div className="mt-2 text-[13px] text-muted-foreground">
                  {caBasis === "emission" ? "Facturé ce mois" : "Attendu ce mois"}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="flex rounded-lg border border-border p-0.5">
                  {([["emission", "Facturé"], ["echeance", "Attendu"]] as const).map(([v, l]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setCaBasis(v)}
                      aria-pressed={caBasis === v}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                        caBasis === v ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <Delta value={mom} suffix="vs mois préc." />
              </div>
            </div>
            <div className="mt-4">
              {hasChart ? (
                <Suspense fallback={<div className="h-[260px] animate-pulse rounded-xl bg-panel/60" />}>
                  <DashArea points={monthly} name={caBasis === "emission" ? "Facturé" : "Attendu"} format={formatEuro} />
                </Suspense>
              ) : (
                <div className="grid h-[200px] place-items-center rounded-xl border border-dashed border-border text-center text-[12px] text-faint">
                  La courbe apparaîtra dès deux mois de facturation.
                </div>
              )}
            </div>
          </div>

          {/* Insight Megan + répartition */}
          <div className="grid flex-1 grid-cols-1 divide-y divide-border border-t border-border md:grid-cols-2 md:divide-x md:divide-y-0">
            <div className="px-5 py-5">
              <SectionTitle
                icon={Sparkles}
                right={
                  megan ? (
                    <button type="button" onClick={() => go("agent")} className="text-[12px] text-muted-foreground transition-colors hover:text-foreground">
                      Voir le cockpit
                    </button>
                  ) : undefined
                }
              >
                {megan ? "Megan, cockpit du jour" : "À retenir"}
              </SectionTitle>
              <p className="line-clamp-4 text-[19px] leading-snug text-muted-foreground md:text-[21px]">{insight}</p>
            </div>
            <div className="px-5 py-5">
              <div className="text-[13px] text-muted-foreground">Facturé au total</div>
              <div className="mb-5 mt-2 text-[28px] font-semibold leading-none tracking-tight tabular-nums">{formatEuro(factTotal)}</div>
              <SegmentBar
                segments={[
                  { label: "Payé", value: paidSum, className: "bg-foreground/70" },
                  { label: "En attente", value: waitSum, className: "bg-foreground/30" },
                  { label: "En retard", value: lateSum, className: "bg-rose-500/80" },
                ]}
              />
            </div>
          </div>
        </Panel>

        {/* ── Colonne de droite ── */}
        <Panel className="flex flex-col xl:col-span-4" i={1}>
          <div className="px-5 pb-5 pt-6">
            <RadialTicks pct={gaugePct} label={`${gaugeLabel} : ${gaugeRound} %`}>
              <span className="mb-2 grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
                <Wallet className="h-4 w-4" />
              </span>
              <span className="text-[12px] text-muted-foreground">Encaissé au total</span>
              <span className="mt-0.5 text-[20px] font-semibold tabular-nums">{formatEuro(paidSum)}</span>
            </RadialTicks>
            <div className="mt-1 flex items-center justify-center gap-5 text-[12px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-foreground/80" /> {gaugeLabel} {gaugeRound} %
              </span>
            </div>
            <div className="mt-4">
              <WideLink label={hasObj ? "Voir les objectifs" : "Voir la facturation"} onClick={() => go(hasObj ? "objectifs" : "facturation")} />
            </div>
          </div>

          <div className="border-t border-border px-5 py-5">
            <div className="text-[13px] text-muted-foreground">Créatrices actives</div>
            <div className="mb-3 mt-2 text-[28px] font-semibold leading-none tracking-tight tabular-nums">{activeCount}</div>
            <TickMeter pct={activePct} label={`${activeCount} créatrices actives sur ${d.creators.length}`} />
            <div className="mt-3 flex gap-5 text-[12px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-foreground/75" /> Actives</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-foreground/20" /> Inactives</span>
            </div>
          </div>

          <div className="border-t border-border px-5 py-5">
            <div className="mb-3 text-[13px] text-muted-foreground">Dernière facture</div>
            {lastInv ? (
              <dl className="flex flex-col gap-2.5 text-[13px]">
                {[
                  ["Émise le", frDate(invDetails[lastInv.id]?.issueDate || lastInv.date)],
                  ["Montant", formatEuro(parseAmount(lastInv.amount))],
                  ["Client", lastInv.party || "—"],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="truncate font-medium tabular-nums text-foreground">{v}</dd>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Statut</dt>
                  <dd>
                    <AnimatedBadge status={invBadge(lastInv.status)} size="sm">{invLabel(lastInv.status)}</AnimatedBadge>
                  </dd>
                </div>
              </dl>
            ) : (
              <div className="text-[12px] text-faint">Aucune facture émise pour le moment.</div>
            )}
            <div className="mt-4">
              <WideLink label="Voir les factures" onClick={() => go("facturation")} />
            </div>
          </div>
        </Panel>

        {/* ── Blocs opérationnels ── */}
        <Panel className="xl:col-span-12" i={2}>
          <div className="px-5 py-5">
            <SectionTitle icon={CalendarClock}>Prochains rendez-vous</SectionTitle>
            {rdv.length === 0 ? (
              <div className="text-[12px] text-faint">Aucun rendez-vous à venir.</div>
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {rdv.map((e, i) => (
                  <div key={i} className="flex min-w-0 flex-col gap-2 rounded-xl bg-panel p-3.5">
                    <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                      {evDate(e).slice(8, 10)}/{evDate(e).slice(5, 7)}
                      {e.time && e.time !== "—" ? ` · ${e.time}` : ""}
                    </span>
                    <span className="line-clamp-2 break-words text-[13px] font-medium leading-snug">{e.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>

        <Panel className="xl:col-span-4" i={3}>
          <div className="px-5 py-5">
            <SectionTitle icon={ListChecks}>To-do</SectionTitle>
            {openTodos.length === 0 ? (
              <div className="text-[12px] text-faint">Rien à faire pour le moment.</div>
            ) : (
              openTodos.slice(0, 5).map((t, i) => (
                <div key={i} className="flex items-center gap-2.5 py-[7px]">
                  <span className="h-4 w-4 shrink-0 rounded-[5px] border border-faint" />
                  <span className="flex-1 truncate text-[13px]">{t.text}</span>
                  <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {t.creator ? titleCase(t.creator) : "Agence"}
                  </span>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel className="xl:col-span-4" i={4}>
          <div className="px-5 py-5">
            <SectionTitle icon={FileText}>Briefs à valider</SectionTitle>
            {briefsShown.length === 0 ? (
              <div className="text-[12px] text-faint">Aucun brief.</div>
            ) : (
              briefsShown.map((b, i) => (
                <div key={i} className="flex items-center gap-3 border-b border-border py-2.5 last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">
                      {b.brand} × {titleCase(b.creator)}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">{b.deliverables || "Livrables à préciser"}</div>
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{frDate(b.due)}</span>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel className="xl:col-span-4" i={5}>
          <div className="px-5 py-5">
            <SectionTitle icon={Trophy}>Qui rapporte</SectionTitle>
            {topCreators.length === 0 ? (
              <div className="text-[12px] text-faint">Aucune créatrice.</div>
            ) : (
              topCreators.map((c, i) => (
                <div key={c.name} className="flex items-center gap-3 py-[7px]">
                  <span className="w-4 text-[12px] tabular-nums text-faint">{i + 1}</span>
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted text-[10px] font-semibold text-muted-foreground">
                    {initials(c.name)}
                  </span>
                  <span className="flex-1 truncate text-[13px] font-medium">{titleCase(c.name)}</span>
                  <span className="text-[13px] font-medium tabular-nums">{c.ca ? formatEuro(c.ca) : "—"}</span>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function Apercu() {
  const [d, setData] = useState<ApercuData | null>(() => getCache<ApercuData>("apercu"));
  const [cockpit, setCockpit] = useState<Cockpit>(null);
  const [err, setErr] = useState(false);
  const live = useLiveKey();
  const { data: obj } = useAppState<Record<string, unknown> | null>(
    (s: AppState) => (s["objByMonth"] as Record<string, unknown>) ?? null,
  );
  // Détails de facture (blob) : seule source de la DATE D'ÉMISSION — la colonne
  // `invoices.date` contient l'ÉCHÉANCE (cf. Facturation `date: draft.dueDate`).
  const { data: invDetails } = useAppState<Record<string, { issueDate?: string }>>(
    (s: AppState) => (s["invoiceDetails"] as Record<string, { issueDate?: string }>) ?? {},
  );

  useEffect(() => {
    let alive = true;
    Promise.all([
      supabase.from("invoices").select("id,ref,party,amount,date,status,creator").order("sort_order"),
      supabase.from("events").select("day,date,time,title,type,who").or("deleted.is.null,deleted.eq.false").order("sort_order"),
      supabase.from("todos").select("text,tag,creator,priority,done").order("sort_order"),
      supabase.from("briefs").select("brand,creator,deliverables,due,status").order("sort_order"),
      supabase.from("creators").select("name,ca,commission,status").order("sort_order"),
    ])
      .then(([inv, ev, td, br, cr]) => {
        if (!alive) return;
        if (inv.error || ev.error || td.error || br.error || cr.error) {
          setErr(true);
          return;
        }
        const next: ApercuData = {
          invoices: (inv.data as Invoice[]) ?? [],
          events: (ev.data as Ev[]) ?? [],
          todos: (td.data as Todo[]) ?? [],
          briefs: (br.data as Brief[]) ?? [],
          creators: (cr.data as Creator[]) ?? [],
        };
        setCache("apercu", next);
        setData(next);
      })
      .catch(() => alive && setErr(true));
    // Cockpit du jour de Megan (facultatif : silencieux si indisponible).
    supabase
      .schema("agent")
      .from("cockpits")
      .select("jour,contenu")
      .order("jour", { ascending: false })
      .limit(1)
      .then(
        ({ data }) => {
          if (alive) setCockpit(((data as { jour: string; contenu: string }[] | null) ?? [])[0] ?? null);
        },
        () => {},
      );
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

  return <ApercuView d={d} invDetails={invDetails ?? {}} obj={obj ?? null} cockpit={cockpit} />;
}
