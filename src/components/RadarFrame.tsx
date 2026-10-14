import type { ReactNode } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs } from "@/components/ui/animated-tabs";
import { fmtAgo } from "@/lib/instagram";

/**
 * Cadre commun des trois radars à marques (Instagram, TikTok, YouTube) : la même
 * organisation partout, du plus important au plus fin.
 *   1. En-tête : le réseau (onglets) à gauche ; dernier passage + « Lancer le radar » + aide à droite.
 *   2. Le tri, en sections : À traiter · Au Pipeline · Pas pertinentes (comme le tri des
 *      créateurs trouvés), et la recherche.
 *   3. Les réglages fins (période, chez qui, cases à cocher) sur une ligne discrète, avec
 *      à droite un résumé chiffré d'une ligne (au lieu de grandes tuiles).
 * Ensuite : avertissements éventuels, puis la liste.
 */
export type RadarStatus = "nouveau" | "pipeline" | "ignore";

export function RadarFrame({
  platformTabs,
  lastRun,
  runNote,
  running,
  runLabel = "Lancer le radar",
  onRun,
  help,
  status,
  onStatus,
  counts,
  query,
  onQuery,
  placeholder,
  filters,
  summary,
  notice,
  children,
}: {
  platformTabs?: ReactNode;
  /** Date ISO du dernier passage (null : jamais lancé ; absent : on affiche `runNote`). */
  lastRun?: string | null;
  runNote?: string;
  running: boolean;
  runLabel?: string;
  onRun: () => void;
  help?: ReactNode;
  status: RadarStatus;
  onStatus: (s: RadarStatus) => void;
  counts: Record<RadarStatus, number>;
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
  filters?: ReactNode;
  summary?: ReactNode;
  notice?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 rounded-2xl bg-surface p-3 sm:p-4">
        {/* 1. Réseau + passage du radar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">{platformTabs}</div>
          <div className="flex items-center gap-2">
            <span className="hidden text-[12px] text-muted-foreground sm:inline">
              {running ? "Lecture en cours…" : lastRun === undefined ? runNote : lastRun ? `Dernier passage ${fmtAgo(lastRun)}` : "Pas encore lancé"}
            </span>
            <button
              type="button"
              onClick={onRun}
              disabled={running}
              className="flex h-9 items-center gap-1.5 rounded-full border border-border px-3.5 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover disabled:opacity-50"
            >
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {runLabel}
            </button>
            {help}
          </div>
        </div>

        {/* 2. Le tri + la recherche */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Tabs
            size="sm"
            label="Quelles marques"
            value={status}
            onValueChange={(v) => onStatus(v as RadarStatus)}
            items={[
              { value: "nouveau", label: "À traiter", count: counts.nouveau },
              { value: "pipeline", label: "Au Pipeline", count: counts.pipeline },
              { value: "ignore", label: "Pas pertinentes", count: counts.ignore },
            ]}
          />
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" aria-hidden />
            <input
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder={placeholder}
              aria-label={placeholder}
              className="h-9 w-full rounded-full border border-border bg-surface pl-8 pr-3 text-[12px] outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* 3. Réglages fins + résumé */}
        {(filters || summary) && (
          <div className={cn("mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2", !filters && "justify-end")}>
            {filters && <div className="flex min-w-0 flex-wrap items-center gap-2">{filters}</div>}
            {summary && <div className="ml-auto text-[12px] text-muted-foreground">{summary}</div>}
          </div>
        )}
      </div>

      {notice}
      {children}
    </div>
  );
}

/** Bouton d'action d'une ligne de radar (Voir, Pipeline, Pas pertinente…). */
export const RADAR_BTN = "inline-flex h-8 items-center gap-1 rounded-full border border-border px-3 text-[11px] font-medium text-foreground transition-colors hover:bg-rowhover";
