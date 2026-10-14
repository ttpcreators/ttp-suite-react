import { Gauge } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { readQuota, useMetaQuota } from "@/lib/instagram";

/**
 * Compteur Meta : part du quota de demandes utilisée, pause éventuelle et heure de
 * reprise. Au clic : le détail (demandes de l'heure et du jour, coût de chaque outil).
 */
export function MetaQuotaBadge({ className }: { className?: string }) {
  const q = useMetaQuota();
  const r = readQuota(q);
  const tone = r.blockedMin ? "red" : r.pct >= 85 ? "red" : r.pct >= 60 ? "amber" : "green";
  const label = r.blockedMin
    ? `Meta en pause · reprise dans ${r.blockedMin} min`
    : q
      ? `Quota Meta : ${r.pct} %`
      : "Quota Meta";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-9 items-center gap-2 rounded-full border px-3 text-[12px] font-medium transition-colors hover:bg-rowhover",
            tone === "red" ? "border-rose-500/30 text-rose-600 dark:text-rose-400" : tone === "amber" ? "border-amber/40 text-amber" : "border-border text-muted-foreground",
            className,
          )}
          title="Combien de demandes Instagram il te reste"
        >
          <Gauge className="h-3.5 w-3.5" />
          <span className="whitespace-nowrap">{label}</span>
          {!r.blockedMin && q && (
            <span className="h-1.5 w-12 overflow-hidden rounded-full bg-panel">
              <span className={cn("block h-full rounded-full", tone === "red" ? "bg-rose-500" : tone === "amber" ? "bg-amber" : "bg-emerald-500")} style={{ width: `${Math.min(100, Math.max(3, r.pct))}%` }} />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))] p-4 text-[12px] leading-relaxed">
        <div className="mb-2 text-[13px] font-semibold text-foreground">Demandes à Instagram (Meta)</div>
        {!q ? (
          <p className="text-muted-foreground">Pas encore de relevé : il apparaît après la première recherche.</p>
        ) : (
          <div className="flex flex-col gap-1.5 text-muted-foreground">
            {r.blockedMin ? (
              <p className="font-medium text-rose-600 dark:text-rose-400">Meta a mis les demandes en pause. Reprise estimée dans {r.blockedMin} min.</p>
            ) : (
              <p>
                <span className="font-medium text-foreground">{r.pct} %</span> du quota utilisé
                {r.left != null && <> · il reste environ <span className="font-medium text-foreground">{r.left} demandes</span> cette heure</>}.
              </p>
            )}
            <p>Cette heure : {r.hourCalls} demande{r.hourCalls > 1 ? "s" : ""}{r.resetMin ? ` (le compteur repart à zéro dans ~${r.resetMin} min)` : ""} · aujourd'hui : {r.dayCalls}.</p>
            <p className="text-faint">Meta compte sur une heure glissante : le pourcentage redescend tout seul.</p>
            <div className="mt-1 rounded-lg bg-panel px-3 py-2 text-[11px]">
              <div className="mb-0.5 font-medium text-foreground">Ce que coûte chaque outil (environ)</div>
              <div>Depuis une marque : 40 demandes · Comme un créateur : 50</div>
              <div>Liste de @ : 1 par @ · Radar : jusqu'à 80 % du quota · Actualiser une fiche : 1 à 2</div>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
