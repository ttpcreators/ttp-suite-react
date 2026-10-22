import { cn } from "@/lib/utils";
import { SlidersHorizontal, X } from "@/components/icons";
import { useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Tabs } from "./animated-tabs";
import { IosSheet, useIosPhone } from "@/components/mobile/ios-sheet";

/**
 * Filtres d'une page : un bouton « Filtres » (nombre de filtres actifs) qui ouvre
 * les groupes d'onglets segmentés (Tabs) dans une bulle (feuille sur iPhone).
 * Onglet actif NEUTRE (pas la couleur d'accent) : le bleu reste réservé aux
 * actions. « Effacer » en pied.
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
}) {
  const [sheet, setSheet] = useState(false);
  const ios = useIosPhone();

  // Mode iPhone : un bouton « Filtres » (avec le nombre actif) qui ouvre une feuille.
  if (ios) {
    return (
      <section className={cn("flex items-center justify-between gap-3", className)}>
        <button
          type="button"
          onClick={() => setSheet(true)}
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[15px] font-medium",
            activeCount > 0 ? "border-foreground bg-foreground text-background" : "border-border bg-surface text-foreground",
          )}
        >
          <SlidersHorizontal className="h-4 w-4" /> {title}
          {activeCount > 0 && <span className="tabular-nums">· {activeCount}</span>}
        </button>
        {right && <div className="shrink-0">{right}</div>}
        {sheet && (
          <IosSheet onClose={() => setSheet(false)} label={title}>
            <div className="bg-panel">
              <div className="ios-bar sticky top-0 z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-border/70 px-4 pb-3 pt-6">
                {activeCount > 0 && onClear ? (
                  <button type="button" onClick={onClear} className="justify-self-start text-[17px] text-primary">Effacer</button>
                ) : (
                  <span />
                )}
                <div className="text-center text-[17px] font-semibold text-foreground">{title}</div>
                <button type="button" onClick={() => setSheet(false)} className="justify-self-end text-[17px] font-semibold text-primary">OK</button>
              </div>
              <div className="flex flex-col gap-5 px-4 pt-4">
                {groups.map((g) => (
                  <div key={g.id} className="flex flex-col gap-2">
                    <span className="px-1 text-[13px] font-medium uppercase tracking-[0.02em] text-muted-foreground">{g.label}</span>
                    <Tabs
                      size="sm"
                      label={g.label}
                      wrap
                      value={g.value}
                      onValueChange={g.onChange}
                      items={g.options.map((o) => ({ value: o.value, label: o.label, count: o.count ?? undefined }))}
                    />
                  </div>
                ))}
                {extra}
              </div>
            </div>
          </IosSheet>
        )}
      </section>
    );
  }

  // Ordinateur : un simple bouton « Filtres » (avec le nombre actif) qui ouvre les filtres
  // dans une bulle. Pas de carte entière pour dire qu'il n'y a aucun filtre.
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
              activeCount > 0 ? "border-foreground bg-foreground text-background" : "border-border bg-surface text-foreground hover:bg-rowhover",
            )}
          >
            <SlidersHorizontal className="h-4 w-4" /> {title}
            {activeCount > 0 && <span className="tabular-nums">· {activeCount}</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(32rem,calc(100vw-2rem))] p-4"
          // Les menus déroulants (Select) s'ouvrent hors de la bulle : ne pas la fermer.
          onInteractOutside={(e) => {
            if ((e.target as Element | null)?.closest?.('[role="listbox"]')) e.preventDefault();
          }}
        >
          <div className={cn("grid gap-4", groups.length > 1 && "sm:grid-cols-2")}>
            {groups.map((g) => (
              <div key={g.id} className="flex flex-col gap-2">
                <span className="text-[12px] font-medium text-muted-foreground">{g.label}</span>
                <Tabs
                  size="sm"
                  label={g.label}
                  wrap
                  value={g.value}
                  onValueChange={g.onChange}
                  items={g.options.map((o) => ({ value: o.value, label: o.label, count: o.count ?? undefined }))}
                />
              </div>
            ))}
          </div>

          {extra && <div className="mt-4">{extra}</div>}

          {activeCount > 0 && onClear && (
            <div className="mt-4 flex items-center justify-end border-t border-border pt-3">
              <button
                type="button"
                onClick={onClear}
                className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover"
              >
                <X className="h-3.5 w-3.5" /> Effacer
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
