import { useMemo, useState } from "react";
import { Activity, TrendingUp, TrendingDown, Users, Hash } from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useAppState, type AppState } from "@/lib/appState";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { SelectField } from "@/components/ui/form";
import { cn, titleCase } from "@/lib/utils";
import { PlatformIcon } from "@/components/ui/platform-icon";

/**
 * Suivi engagement — page dédiée à l'ÉVOLUTION des mesures enregistrées dans
 * Roster → Engagement (blob `engagementHistory`) : taux d'engagement, abonnés
 * et volume d'interactions dans le temps, par créateur et par plateforme.
 * Lecture seule : les mesures s'ajoutent/s'éditent depuis le calculateur.
 */

export type SuiviEntry = {
  id: string;
  date: string; // jj/mm/aaaa
  creator: string;
  creatorId?: string;
  platform: string;
  platformLabel: string;
  er: string; // "3,98 %"
  verdict: string;
  detail: string;
  vals: Record<string, string>;
  followers: string;
};
type HistEntry = SuiviEntry;

function num(v: string | undefined): number {
  const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
function parseEr(s: string): number {
  const n = parseFloat(String(s ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
/** "04/07/2026" → timestamp (tri chronologique). */
function frTime(s: string): number {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec((s ?? "").trim());
  if (!m) return 0;
  const y = m[3].length === 2 ? "20" + m[3] : m[3];
  return new Date(Number(y), Number(m[2]) - 1, Number(m[1])).getTime();
}
function fmtCompact(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(Math.round(n));
}
/** Somme des interactions d'une entrée (tout sauf les clés de base). */
function interactionsOf(h: HistEntry): number {
  return Object.entries(h.vals ?? {})
    .filter(([k]) => !["views", "reach", "posts"].includes(k))
    .reduce((a, [, v]) => a + num(v), 0);
}

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
  snapchat: "Snapchat",
};

/**
 * Panneau réutilisable : côté AGENCE (sélecteur de créateur) et côté ESPACE
 * CRÉATEUR (`lockedCreator` = verrouillé sur soi, entries déjà filtrées par la
 * fonction serveur — un créateur ne voit jamais les mesures des autres).
 */
export function SuiviPanel({ entries, lockedCreator }: { entries: SuiviEntry[]; lockedCreator?: string }) {
  // Sélecteur créateur (ceux qui ont au moins une mesure)
  const creatorNames = useMemo(() => [...new Set(entries.map((h) => h.creator))], [entries]);
  const [selCreator, setSelCreator] = useState("");
  const creator = lockedCreator || selCreator || creatorNames[0] || "";
  const sameCreator = (h: HistEntry) => h.creator.trim().toLowerCase() === creator.trim().toLowerCase();

  // Plateformes disponibles pour ce créateur
  const platforms = useMemo(
    () => [...new Set(entries.filter(sameCreator).map((h) => h.platform))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, creator],
  );
  const [selPlatform, setSelPlatform] = useState("");
  const platform = platforms.includes(selPlatform) ? selPlatform : platforms[0] || "";

  // Série chronologique du créateur × plateforme.
  // `entries` est dans l'ordre du blob (récent en tête). À date ÉGALE, on veut
  // que la mesure la plus récente (index le plus faible) soit le DERNIER point →
  // tri par date croissante puis par index décroissant.
  const points = useMemo(() => {
    return entries
      .filter((h) => sameCreator(h) && h.platform === platform)
      .map((h, i) => ({
        label: h.date.slice(0, 5),
        full: h.date,
        t: frTime(h.date),
        i,
        er: parseEr(h.er),
        followers: num(h.followers),
        interactions: interactionsOf(h),
        verdict: h.verdict,
      }))
      .sort((a, b) => a.t - b.t || b.i - a.i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, creator, platform]);

  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const dEr = last && prev ? Math.round((last.er - prev.er) * 100) / 100 : null;
  const dFol = last && prev && last.followers > 0 && prev.followers > 0 ? last.followers - prev.followers : null;

  if (entries.length === 0)
    return (
      <div className="rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
        <Activity className="mx-auto h-8 w-8 text-faint" />
        <div className="mt-3 text-sm font-medium text-foreground">Pas encore de mesures</div>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
          {lockedCreator
            ? "Ton évolution apparaîtra ici dès que l'agence aura enregistré tes premières mesures d'engagement."
            : "Enregistre des calculs dans Roster → Engagement : chaque mesure alimente automatiquement l'évolution ici."}
        </p>
      </div>
    );

  const tooltipStyle = {
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--surface)",
    fontSize: 12,
    boxShadow: "0 4px 16px rgba(0,0,0,.06)",
  } as const;

  return (
    <div className="space-y-4">
      {/* Sélecteurs (le créateur connecté est verrouillé sur lui-même) */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        {!lockedCreator ? (
          <div className="w-full sm:max-w-xs">
            <SelectField
              label="Créateur"
              value={creator}
              onChange={(v) => {
                setSelCreator(v);
                setSelPlatform("");
              }}
              options={creatorNames.map((n) => ({ value: n, label: titleCase(n) }))}
            />
          </div>
        ) : (
          <div className="text-sm font-semibold text-foreground">Ton évolution</div>
        )}
        <div className="flex flex-wrap gap-2">
          {platforms.map((pk) => (
            <button
              key={pk}
              type="button"
              onClick={() => setSelPlatform(pk)}
              className={cn(
                "flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[11px] font-semibold transition-colors",
                pk === platform
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:bg-rowhover",
              )}
            >
              <PlatformIcon platform={pk} className="h-3.5 w-3.5" />
              {PLATFORM_LABELS[pk] ?? pk}
            </button>
          ))}
        </div>
      </div>

      {/* Cartes de synthèse */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-border bg-surface p-[18px] shadow-sm">
          <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-faint">
            <Activity className="h-3 w-3" /> Dernier taux
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight">{last ? `${String(last.er).replace(".", ",")} %` : "—"}</div>
          {dEr !== null && (
            <div className={cn("mt-1 flex items-center gap-1 text-[11px] font-semibold", dEr >= 0 ? "text-signaltext" : "text-rose-500")}>
              {dEr >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {dEr >= 0 ? "+" : ""}{String(dEr).replace(".", ",")} pt vs mesure précédente
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-border bg-surface p-[18px] shadow-sm">
          <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-faint">
            <Users className="h-3 w-3" /> Abonnés
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight">{last && last.followers > 0 ? fmtCompact(last.followers) : "—"}</div>
          {dFol !== null && dFol !== 0 && (
            <div className={cn("mt-1 flex items-center gap-1 text-[11px] font-semibold", dFol >= 0 ? "text-signaltext" : "text-rose-500")}>
              {dFol >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {dFol >= 0 ? "+" : ""}{fmtCompact(Math.abs(dFol))}
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-border bg-surface p-[18px] shadow-sm">
          <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-faint">
            <Hash className="h-3 w-3" /> Mesures
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight">{points.length}</div>
          <div className="mt-1 text-[11px] text-faint">{PLATFORM_LABELS[platform] ?? platform}</div>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-[18px] shadow-sm">
          <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-faint">
            <TrendingUp className="h-3 w-3" /> Meilleur taux
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight">
            {points.length ? `${String(Math.max(...points.map((x) => x.er))).replace(".", ",")} %` : "—"}
          </div>
        </div>
      </div>

      {/* Évolution du taux d'engagement */}
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <div className="mb-4 text-sm font-semibold">Évolution du taux d'engagement</div>
        {points.length < 2 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Il faut au moins 2 mesures pour tracer une courbe — enregistre un nouveau calcul le mois prochain 📈
          </p>
        ) : (
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="suiviEr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2b7fff" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#2b7fff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v) => `${v} %`} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={48} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(_, pl) => (pl?.[0]?.payload?.full ? `Le ${pl[0].payload.full}` : "")}
                  formatter={(value) => [`${String(value ?? "").replace(".", ",")} %`, "Taux"]}
                />
                <Area type="monotone" dataKey="er" stroke="#2b7fff" strokeWidth={2.5} fill="url(#suiviEr)" dot={{ r: 3, fill: "#2b7fff" }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Évolution des abonnés */}
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="mb-4 text-sm font-semibold">Évolution des abonnés</div>
          {points.filter((x) => x.followers > 0).length < 2 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Renseigne les abonnés à chaque mesure pour suivre leur évolution ici.
            </p>
          ) : (
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={points.filter((x) => x.followers > 0)} margin={{ top: 6, right: 8, left: -6, bottom: 0 }}>
                  <defs>
                    <linearGradient id="suiviFol" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(v) => fmtCompact(Number(v))} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={44} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelFormatter={(_, pl) => (pl?.[0]?.payload?.full ? `Le ${pl[0].payload.full}` : "")}
                    formatter={(value) => [fmtCompact(Number(value ?? 0)), "Abonnés"]}
                  />
                  <Area type="monotone" dataKey="followers" stroke="#6366f1" strokeWidth={2.5} fill="url(#suiviFol)" dot={{ r: 3, fill: "#6366f1" }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Volume d'interactions par mesure */}
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="mb-4 text-sm font-semibold">Interactions par mesure (30 j)</div>
          {points.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">Aucune mesure.</p>
          ) : (
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={points} margin={{ top: 6, right: 8, left: -6, bottom: 0 }}>
                  <defs>
                    <linearGradient id="suiviInt" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.9} />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.45} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(v) => fmtCompact(Number(v))} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={44} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelFormatter={(_, pl) => (pl?.[0]?.payload?.full ? `Le ${pl[0].payload.full}` : "")}
                    formatter={(value) => [fmtCompact(Number(value ?? 0)), "Interactions"]}
                  />
                  <Bar dataKey="interactions" fill="url(#suiviInt)" radius={[6, 6, 0, 0]} maxBarSize={42} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Détail des mesures */}
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <div className="mb-3 text-sm font-semibold">Mesures enregistrées</div>
        <div className="flex flex-col gap-2">
          {points
            .slice()
            .reverse()
            .map((x, i) => (
              <div key={`${x.full}-${i}`} className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
                <span className="w-20 shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">{x.full}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-faint">
                  {fmtCompact(x.interactions)} interactions{x.followers > 0 ? ` · ${fmtCompact(x.followers)} abonnés` : ""}
                </span>
                <span className="shrink-0 text-sm font-bold">{String(x.er).replace(".", ",")} %</span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold",
                    x.verdict === "Moyen" ? "bg-amber/15 text-amber" : "bg-signalsoft text-signaltext",
                  )}
                >
                  {x.verdict}
                </span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

/** Page agence : tout l'historique (blob agence) + sélecteur de créateur. */
export function EngagementSuivi() {
  const { data: hist, loading } = useAppState<HistEntry[]>(
    (s: AppState) => ((s["engagementHistory"] as HistEntry[]) ?? []),
  );
  const entries = useMemo(() => (hist ?? []).filter((h) => h.creator && h.creator !== "Calcul libre"), [hist]);
  if (loading)
    return (
      <AnimatedBadge status="loading" size="sm">
        Chargement du suivi…
      </AnimatedBadge>
    );
  return <SuiviPanel entries={entries} />;
}
