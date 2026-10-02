import { cn } from "@/lib/utils";
import { SlidersHorizontal, X, ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

/**
 * Panneau de filtres dans le langage de l'Aperçu : panneau plat bordé, titre
 * de section avec icône, groupes de pastilles avec libellé en minuscules, et
 * pastille active NEUTRE (encre pleine, pas la couleur d'accent) : le bleu reste
 * réservé aux actions. « Tout effacer » en pied. Repliable.
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
      : "Aucun filtre";

  return (
    <section className={cn("rounded-2xl border border-border bg-surface px-5 py-4", className)}>
      {/* En-tête */}
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 items-center gap-2 text-left" aria-expanded={open}>
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-[14px] font-semibold text-foreground">{title}</span>
          <span className={cn("min-w-0 truncate text-[12px]", activeCount > 0 ? "text-foreground" : "text-muted-foreground")}>· {activeLabel}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-faint transition-transform", open && "rotate-180")} />
        </button>
        {right && <div className="shrink-0">{right}</div>}
      </div>

      {open && (
        <>
          {/* Groupes de pastilles */}
          <div className={cn("mt-4 grid gap-4", groups.length > 1 && "sm:grid-cols-2")}>
            {groups.map((g) => (
              <div key={g.id} className="flex flex-col gap-2">
                <span className="text-[12px] font-medium text-muted-foreground">{g.label}</span>
                <div className="flex flex-wrap gap-1.5">
                  {g.options.map((o) => {
                    const active = g.value === o.value;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => g.onChange(o.value)}
                        aria-pressed={active}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
                          active
                            ? "border-foreground bg-foreground text-background"
                            : "border-border bg-surface text-muted-foreground hover:bg-rowhover hover:text-foreground",
                        )}
                      >
                        {o.label}
                        {o.count != null && (
                          <span className={cn("tabular-nums", active ? "text-background/70" : "text-faint")}>{o.count}</span>
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
            <div className="mt-4 flex items-center justify-end border-t border-border pt-3">
              <button
                type="button"
                onClick={onClear}
                className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover"
              >
                <X className="h-3.5 w-3.5" /> Tout effacer
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
