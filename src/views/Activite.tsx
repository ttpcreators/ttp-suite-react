import { useCallback, useEffect, useMemo, useState } from "react";
import { History, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, titleCase } from "@/lib/utils";
import { DashPanel } from "@/components/ui/dash";
import { Tabs } from "@/components/ui/animated-tabs";
import { PageHeaderRow } from "@/components/ui/page-header";
import { useLiveKey } from "@/lib/useLive";
import { letterColor } from "@/lib/mailAvatar";
import { teamNames, type AgencyActivity } from "@/lib/team";
import { activityText } from "../../supabase/functions/_shared/activityText";

/*
 * Page « Activité » : le journal de l'équipe agence (Marc, Gianni…), écrit par la
 * base elle-même à chaque ajout, « Fait », mise à la corbeille ou avancée.
 * Filtres par personne et par période ; regroupé par jour.
 */

const PERIODS = [
  { value: "1", label: "Aujourd'hui" },
  { value: "7", label: "7 jours" },
  { value: "30", label: "30 jours" },
];

const dayKey = (iso: string) => new Date(iso).toDateString();
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === yesterday.toDateString()) return "Hier";
  const s = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
/** Couleur de la pastille : une couleur bien à soi pour chaque fondateur. */
const personColor = (name: string) =>
  /^marc/i.test(name) ? "#7f1d1d" : /^gianni/i.test(name) ? "#0e7490" : letterColor(name);
const hour = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

export function Activite() {
  const live = useLiveKey();
  const [rows, setRows] = useState<AgencyActivity[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [who, setWho] = useState("__all__");
  const [period, setPeriod] = useState("7");

  const load = useCallback(async () => {
    setBusy(true);
    const since = new Date(Date.now() - Number(period) * 86_400_000);
    if (period === "1") since.setHours(0, 0, 0, 0);
    const [{ data, error }, n] = await Promise.all([
      supabase.from("agency_activity").select("*").gte("created_at", since.toISOString())
        .order("created_at", { ascending: false }).limit(500),
      teamNames(),
    ]);
    setBusy(false);
    if (error) {
      setMissing(true);
      setRows([]);
      return;
    }
    setMissing(false);
    setNames(n);
    setRows((data ?? []) as AgencyActivity[]);
  }, [period]);

  useEffect(() => {
    void load();
  }, [load, live]);

  const nameOf = useCallback(
    (r: AgencyActivity) => (r.actor_id && names.get(r.actor_id)) || r.actor_name || "Quelqu'un",
    [names],
  );
  const people = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(nameOf(r), (m.get(nameOf(r)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows, nameOf]);
  const shown = useMemo(() => (rows ?? []).filter((r) => who === "__all__" || nameOf(r) === who), [rows, who, nameOf]);
  const days = useMemo(() => {
    const out: { key: string; label: string; items: AgencyActivity[] }[] = [];
    for (const r of shown) {
      const k = dayKey(r.created_at);
      const last = out[out.length - 1];
      if (last && last.key === k) last.items.push(r);
      else out.push({ key: k, label: dayLabel(r.created_at), items: [r] });
    }
    return out;
  }, [shown]);

  return (
    <div>
      <PageHeaderRow>
        <div className="text-sm text-muted-foreground">
          Qui fait quoi dans l'agence : chaque ajout, « Fait », suppression ou avancée, avec la date.
        </div>
        <button type="button" onClick={() => void load()} disabled={busy}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] font-semibold text-foreground shadow-sm shadow-black/[0.03] transition-colors hover:bg-rowhover disabled:opacity-60">
          <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} /> Actualiser
        </button>
      </PageHeaderRow>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs
          size="sm"
          label="Personne"
          wrap
          value={who}
          onValueChange={setWho}
          items={[
            { value: "__all__", label: "Tout le monde", count: rows?.length ?? undefined },
            ...people.map(([p, c]) => ({ value: p, label: p, count: c })),
          ]}
        />
        <Tabs size="sm" label="Période" value={period} onValueChange={setPeriod} items={PERIODS} />
      </div>

      {rows === null ? (
        <DashPanel className="flex items-center justify-center gap-2 p-10 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </DashPanel>
      ) : missing ? (
        <DashPanel className="px-6 py-10 text-center text-[13px] text-muted-foreground">
          Le journal de l'équipe n'est pas encore activé. Lance le SQL « équipe, activité, routines » dans Supabase.
        </DashPanel>
      ) : days.length === 0 ? (
        <DashPanel className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <History className="h-5 w-5 text-faint" />
          <p className="text-[13px] text-muted-foreground">Rien sur cette période.</p>
        </DashPanel>
      ) : (
        <div className="flex flex-col gap-4">
          {days.map((d) => (
            <DashPanel key={d.key} className="overflow-hidden">
              <div className="border-b border-border px-4 py-2.5 text-[12px] font-semibold text-muted-foreground sm:px-5">
                {d.label} <span className="font-normal text-faint">· {d.items.length}</span>
              </div>
              <ul className="divide-y divide-border">
                {d.items.map((r) => {
                  const name = nameOf(r);
                  const t = activityText(r);
                  return (
                    <li key={r.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                      <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[12px] font-semibold uppercase text-white" style={{ backgroundColor: personColor(name) }}>
                        {name.charAt(0)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] text-foreground [overflow-wrap:anywhere]">
                          <span className="font-semibold">{name}</span> {t.action} <span className="font-medium">« {t.what} »</span>
                        </span>
                        {r.creator && <span className="mt-0.5 block text-[11px] text-muted-foreground">{titleCase(r.creator)}</span>}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-faint">{hour(r.created_at)}</span>
                    </li>
                  );
                })}
              </ul>
            </DashPanel>
          ))}
        </div>
      )}
    </div>
  );
}
