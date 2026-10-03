import { useCallback, useEffect, useState } from "react";
import { Bug, Check, ChevronDown, ChevronUp, Copy, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { Tabs } from "@/components/ui/animated-tabs";

/*
 * « Bugs signalés » (page Diagnostique) : tout ce que l'app a remonté
 * (plantage d'écran, erreur JS, action qui échoue). Regroupés par message.
 * « Copier pour Claude » copie un rapport prêt à coller ; « Marquer résolu »
 * range le bug (toutes ses occurrences).
 */

type Row = {
  id: string; message: string | null; page: string | null; stack: string | null; component_stack: string | null;
  url: string | null; user_agent: string | null; role: string | null; created_at: string; resolved_at?: string | null;
};
type Group = { message: string; rows: Row[]; last: Row; first: Row; resolved: boolean };

const fmt = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const device = (ua: string | null) =>
  !ua ? "" : /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Navigateur";

function group(rows: Row[]): Group[] {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r.message ?? "(sans message)";
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  return [...map.entries()]
    .map(([message, rs]) => ({ message, rows: rs, last: rs[0], first: rs[rs.length - 1], resolved: rs.every((r) => !!r.resolved_at) }))
    .sort((a, b) => b.last.created_at.localeCompare(a.last.created_at));
}

function reportText(g: Group): string {
  const r = g.last;
  return [
    "Bug dans TTP Suite (à corriger) :",
    `Message : ${g.message}`,
    `Page : ${r.page || "?"}`,
    `Occurrences : ${g.rows.length} (première ${fmt(g.first.created_at)}, dernière ${fmt(r.created_at)})`,
    `Appareil : ${device(r.user_agent)}${r.role ? ` · rôle ${r.role}` : ""}`,
    r.url ? `Adresse : ${r.url}` : "",
    r.stack ? `\nStack :\n${r.stack.slice(0, 2500)}` : "",
    r.component_stack ? `\nComposants :\n${r.component_stack.slice(0, 1200)}` : "",
  ].filter(Boolean).join("\n");
}

export function BugsPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data } = await supabase.from("error_log").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(300);
    setRows((data as Row[]) ?? []);
    setBusy(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const groups = group(rows ?? []);
  const open = groups.filter((g) => !g.resolved);
  const shown = filter === "open" ? open : groups;

  const resolve = async (g: Group) => {
    const ids = g.rows.filter((r) => !r.resolved_at).map((r) => r.id);
    const now = new Date().toISOString();
    const { error } = await supabase.from("error_log").update({ resolved_at: now }).in("id", ids);
    if (error) return toast(/resolved_at/.test(error.message) ? "Lance d'abord le SQL « error-log-resolve »." : "Impossible de marquer résolu");
    setRows((l) => l?.map((r) => (ids.includes(r.id) ? { ...r, resolved_at: now } : r)) ?? l);
    toast("Bug marqué résolu ✓");
  };
  const copy = async (g: Group) => {
    try {
      await navigator.clipboard.writeText(reportText(g));
      toast("Rapport copié : colle-le à Claude ✓");
    } catch {
      toast("Copie impossible");
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", open.length ? "bg-rose-500/10 text-rose-600 dark:text-rose-400" : "bg-muted text-muted-foreground")}>
          <Bug className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">Bugs signalés</div>
          <div className="text-[11px] text-faint">Remontés automatiquement depuis l'app (30 derniers jours). Tu es aussi prévenu sur ton téléphone.</div>
        </div>
        <button type="button" onClick={() => void load()} disabled={busy}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[12px] font-semibold text-foreground shadow-sm transition-colors hover:bg-rowhover disabled:opacity-60">
          <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} /> Actualiser
        </button>
      </div>
      <Tabs
        size="sm"
        className="mb-3"
        label="Filtrer les bugs"
        items={[{ value: "open", label: "À régler", count: open.length }, { value: "all", label: "Tous", count: groups.length }]}
        value={filter}
        onValueChange={(v) => setFilter(v as "open" | "all")}
      />
      {rows === null ? (
        <div className="py-6 text-center text-[12px] text-faint">Chargement…</div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-[12px] text-muted-foreground">
          {filter === "open" ? "Aucun bug à régler. 🎉" : "Aucun bug signalé ces 30 derniers jours."}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((g) => {
            const k = g.message;
            const expanded = openKey === k;
            return (
              <li key={k} className={cn("rounded-xl border border-border bg-panel/40 p-3", g.resolved && "opacity-60")}>
                <button type="button" onClick={() => setOpenKey(expanded ? null : k)} className="flex w-full items-start gap-2 text-left">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", g.resolved ? "bg-emerald-500" : "bg-rose-500")} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-foreground [overflow-wrap:anywhere]">{g.message}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {g.last.page || "Page inconnue"} · {fmt(g.last.created_at)}
                      {g.rows.length > 1 ? ` · ${g.rows.length} fois` : ""}
                      {device(g.last.user_agent) ? ` · ${device(g.last.user_agent)}` : ""}
                      {g.resolved ? " · résolu" : ""}
                    </span>
                  </span>
                  {expanded ? <ChevronUp className="mt-0.5 h-4 w-4 shrink-0 text-faint" /> : <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-faint" />}
                </button>
                {expanded && g.last.stack && (
                  <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-muted p-2.5 text-[10.5px] leading-snug text-muted-foreground">{g.last.stack}</pre>
                )}
                <div className="mt-2.5 flex flex-wrap gap-2 pl-4">
                  <button type="button" onClick={() => void copy(g)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[12px] font-semibold text-foreground hover:bg-rowhover">
                    <Copy className="h-3.5 w-3.5" /> Copier pour Claude
                  </button>
                  {!g.resolved && (
                    <button type="button" onClick={() => void resolve(g)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 text-[12px] font-semibold text-white hover:opacity-90">
                      <Check className="h-3.5 w-3.5" /> Marquer résolu
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
