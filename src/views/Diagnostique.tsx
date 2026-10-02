import { useEffect, useRef, useState } from "react";
import { HeartPulse, CheckCircle2, AlertTriangle, XCircle, RefreshCw, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { useAppState, type AppState } from "@/lib/appState";
import { runDiagnostics, type DiagSnapshot, type DiagStatus, type DiagCheck } from "@/lib/diagnostics";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";

/**
 * Page « Diagnostique » (Réglages) : santé de l'app. Un audit tourne 2×/jour
 * (matin/soir, à l'ouverture) + à l'ouverture de cette page si périmé, et à la
 * demande. Statut par composant + barres d'uptime (historique) + incidents.
 */

const META: Record<DiagStatus, { label: string; cls: string; dot: string; Icon: typeof CheckCircle2 }> = {
  ok: { label: "Opérationnel", cls: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500", Icon: CheckCircle2 },
  warn: { label: "À surveiller", cls: "text-amber", dot: "bg-amber", Icon: AlertTriangle },
  down: { label: "Hors service", cls: "text-rose-600 dark:text-rose-400", dot: "bg-rose-500", Icon: XCircle },
};
const barCls: Record<DiagStatus, string> = { ok: "bg-emerald-500", warn: "bg-amber", down: "bg-rose-500" };

const fmtWhen = (ts: number) => new Date(ts).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Barre d'uptime d'un check : ses N derniers statuts (ancien → récent). */
function UptimeBar({ history, checkKey }: { history: DiagSnapshot[]; checkKey: string }) {
  const last = [...history].slice(0, 30).reverse(); // ancien → récent
  return (
    <div className="mt-1.5 flex w-full min-w-0 flex-wrap items-end gap-[3px]">
      {last.length === 0 && <span className="text-[10px] text-faint">Pas encore d'historique</span>}
      {last.map((snap, i) => {
        const c = snap.checks.find((x) => x.key === checkKey);
        return <div key={i} className={cn("h-5 w-[5px] shrink-0 rounded-sm", c ? barCls[c.status] : "bg-border")} title={`${fmtWhen(snap.ts)} — ${c ? META[c.status].label : "—"}`} />;
      })}
    </div>
  );
}

export function Diagnostique() {
  const { data: history } = useAppState<DiagSnapshot[]>((s: AppState) => (s["diagnosticHistory"] as DiagSnapshot[]) ?? []);
  const [running, setRunning] = useState(false);
  const [showIncidents, setShowIncidents] = useState(false);
  const ranOnce = useRef(false);

  const snap = history?.[0] ?? null;

  const run = async () => {
    if (running) return;
    setRunning(true);
    try {
      const r = await runDiagnostics();
      toast(r.overall === "ok" ? "Audit terminé — tout va bien ✓" : "Audit terminé — voir les détails");
    } finally {
      setRunning(false);
    }
  };

  // À l'ouverture de la page : relance un audit s'il n'y en a pas eu depuis +1 h.
  useEffect(() => {
    if (ranOnce.current) return;
    ranOnce.current = true;
    const last = history?.[0];
    if (!last || Date.now() - last.ts > 3600 * 1000) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  const overall = snap?.overall ?? "ok";
  const OverallIcon = META[overall].Icon;
  const overallLine = !snap
    ? "Premier audit en cours…"
    : overall === "ok"
      ? "Tout fonctionne normalement."
      : overall === "warn"
        ? "Quelques points à surveiller."
        : "Un problème a été détecté.";
  const incidents = (history ?? []).filter((s) => s.overall !== "ok");

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      {/* Bandeau global */}
      <div className={cn("rounded-2xl border p-5 shadow-sm", overall === "ok" ? "border-emerald-500/25 bg-emerald-500/[0.06]" : overall === "warn" ? "border-border bg-foreground/[0.06]" : "border-rose-500/25 bg-rose-500/[0.06]")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface", META[overall].cls)}>
              <OverallIcon className="h-5 w-5" />
            </span>
            <div>
              <div className="text-sm font-bold text-foreground">{overallLine}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Clock className="h-3 w-3" /> {snap ? `Dernier audit : ${fmtWhen(snap.ts)}` : "—"}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", running && "animate-spin")} /> {running ? "Audit…" : "Relancer"}
          </button>
        </div>
      </div>

      {/* Détail par composant */}
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><HeartPulse className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">État des composants</div>
            <div className="text-[11px] text-faint">Audit automatique matin & soir (à l'ouverture de l'app) + à la demande.</div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {(snap?.checks ?? []).map((c: DiagCheck) => {
            const m = META[c.status];
            return (
              <div key={c.key} className="rounded-xl border border-border bg-panel/40 p-3.5">
                <div className="flex flex-wrap items-center justify-start gap-x-2 gap-y-1 text-left md:gap-x-3">
                  <m.Icon className={cn("h-4 w-4 shrink-0", m.cls)} />
                  <span className="min-w-0 text-left text-[13px] font-semibold text-foreground">{c.label}</span>
                  <span className={cn("ml-auto text-[11px] font-medium md:ml-0", m.cls)}>{m.label}</span>
                  <span className="min-w-0 basis-full truncate pl-6 text-left text-[11px] text-muted-foreground md:ml-auto md:basis-auto md:pl-0 md:text-right">{c.detail}</span>
                </div>
                <UptimeBar history={history ?? []} checkKey={c.key} />
              </div>
            );
          })}
          {!snap && <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-[12px] text-faint">Audit en cours…</div>}
        </div>
      </div>

      {/* Historique des incidents */}
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <button type="button" onClick={() => setShowIncidents((v) => !v)} className="flex w-full items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">Historique des incidents</span>
            <span className="rounded-full bg-panel px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{incidents.length}</span>
          </div>
          {showIncidents ? <ChevronUp className="h-4 w-4 text-faint" /> : <ChevronDown className="h-4 w-4 text-faint" />}
        </button>
        {showIncidents && (
          <div className="mt-3 flex flex-col gap-2">
            {incidents.length === 0 ? (
              <div className="text-[12px] text-faint">Aucun incident enregistré — l'app se porte bien 🎉</div>
            ) : (
              incidents.slice(0, 30).map((s, i) => (
                <div key={i} className="rounded-xl bg-panel/40 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={cn("h-1.5 w-1.5 rounded-full", META[s.overall].dot)} />
                    <span className="text-[12px] font-semibold text-foreground">{fmtWhen(s.ts)}</span>
                    <span className={cn("text-[11px] font-medium", META[s.overall].cls)}>{META[s.overall].label}</span>
                  </div>
                  <div className="mt-0.5 pl-3.5 text-[11px] text-muted-foreground">
                    {s.checks.filter((c) => c.status !== "ok").map((c) => `${c.label} : ${c.detail}`).join(" · ") || "—"}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default Diagnostique;
