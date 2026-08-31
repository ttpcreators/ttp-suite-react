import { cn } from "@/lib/utils";
import { SlidersHorizontal, X } from "lucide-react";
import { useState, type ReactNode } from "react";

/**
 * Panneau de filtres en carte (façon « task-filters » shadcn, porté natif TTP) :
 * en-tête avec titre + compteur de filtres actifs, groupes de pastilles labellisés
 * (Statut / Priorité / …), zone libre (`extra`) pour un sélecteur, et bouton
 * « Tout effacer ». Repliable sur mobile pour ne pas manger l'écran.
 *
 * Composant natif (tokens app, lucide-react) — pas de dépendances Radix.
 */

export type FilterOption = { value: string; label: string; count?: number };
export type FilterGroup = {
  id: string;
  label: string;
  options: FilterOption[];
  value: string;
  onChange: (v: string) => void;
};

export function FilterPanel({
  title = "Filtres",
  groups,
  activeCount,
  onClear,
  right,
  extra,
  className,
  defaultOpen = true,
}: {
  title?: string;
  groups: FilterGroup[];
  /** Nombre de filtres actifs (hors valeurs par défaut) — pilote le compteur + « Tout effacer ». */
  activeCount: number;
  onClear?: () => void;
  /** Contenu à droite de l'en-tête (ex. bascule de vue Liste/Colonnes). */
  right?: ReactNode;
  /** Contrôle libre sous les groupes (ex. sélecteur de créatrice). */
  extra?: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const activeLabel =
    activeCount > 0
      ? `${activeCount} filtre${activeCount > 1 ? "s" : ""} actif${activeCount > 1 ? "s" : ""}`
      : "Aucun filtre actif";

  return (
    <section className={cn("rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5", className)}>
      {/* En-tête */}
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 items-center gap-2.5 text-left"
          aria-expanded={open}
        >
          <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors", activeCount > 0 ? "bg-primary/10 text-primary" : "bg-panel text-muted-foreground")}>
            <SlidersHorizontal className="h-4 w-4" />
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-1.5 text-[13px] font-bold text-foreground">
              {title}
              {activeCount > 0 && (
                <span className="grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">{activeCount}</span>
              )}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">{activeLabel}</span>
          </span>
        </button>
        {right && <div className="shrink-0">{right}</div>}
      </div>

      {open && (
        <>
          {/* Groupes de pastilles */}
          <div className={cn("mt-4 grid gap-4", groups.length > 1 && "sm:grid-cols-2")}>
            {groups.map((g) => (
              <div key={g.id} className="flex flex-col gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">{g.label}</span>
                <div className="flex flex-wrap gap-1.5">
                  {g.options.map((o) => {
                    const active = g.value === o.value;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => g.onChange(o.value)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors",
                          active
                            ? "bg-primary text-primary-foreground"
                            : "border border-border bg-surface text-muted-foreground hover:bg-rowhover hover:text-foreground",
                        )}
                      >
                        {o.label}
                        {o.count != null && (
                          <span className={cn("rounded-full px-1.5 text-[9px] font-bold leading-4", active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-panel text-faint")}>{o.count}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {extra && <div className="mt-4">{extra}</div>}

          {/* Tout effacer */}
          {activeCount > 0 && onClear && (
            <>
              <div className="mt-4 h-px w-full bg-border" />
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">{activeLabel}</span>
                <button
                  type="button"
                  onClick={onClear}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" /> Tout effacer
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
