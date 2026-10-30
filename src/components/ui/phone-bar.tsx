import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { ActionMenu, type ActionItem } from "@/components/ui/action-menu";
import { useIosPhone } from "@/components/mobile/ios-sheet";
import { useNavActionSlot } from "@/lib/navAction";
import { cn } from "@/lib/utils";
import { useEdgeFade } from "@/lib/useEdgeFade";

/*
 * Affichage téléphone de l'espace agence : en-têtes et filtres compacts, pour que la liste
 * commence dans le premier écran (demande de Marc, 2026-10-24). Rien ici ne s'affiche sur
 * ordinateur.
 *   • PhoneMenu   : les actions secondaires d'une page montent dans la barre de titre, en « ⋯ ».
 *   • PhonePills  : UNE rangée de pastilles qui défile (les segments principaux d'une liste).
 *   • PhoneStrip  : les chiffres clés en bande qui défile, au lieu d'une grille de cases.
 */

/** « ⋯ » dans la barre de titre (téléphone) : les actions secondaires de la page. */
export function PhoneMenu({ items }: { items: ActionItem[] }) {
  const slot = useNavActionSlot(true);
  if (!slot || !items.length) return null;
  return createPortal(<ActionMenu items={items} buttonClassName="h-11 w-11 text-foreground" />, slot);
}

export type PillOption = { value: string; label: string; count?: number };

/** Pastilles qui défilent sur une ligne ; `after` reste collé à droite (bouton « Filtres »). */
export function PhonePills({ value, onChange, options, after, className, label }: {
  value: string;
  onChange: (v: string) => void;
  options: PillOption[];
  after?: ReactNode;
  className?: string;
  label: string;
}) {
  const { ref: fadeRef, style: fadeStyle } = useEdgeFade();
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div ref={fadeRef} style={fadeStyle} role="tablist" aria-label={label} className="-ml-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto pl-1 pr-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onChange(o.value)}
              className={cn(
                "flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[15px] font-medium transition-colors",
                on ? "bg-foreground text-background" : "bg-surface text-foreground",
              )}
            >
              {o.label}
              {o.count != null && <span className={cn("tabular-nums", on ? "text-background/70" : "text-muted-foreground")}>{o.count}</span>}
            </button>
          );
        })}
      </div>
      {after && <div className="shrink-0">{after}</div>}
    </div>
  );
}

export type StripItem = { label: string; value: string; tone?: string; active?: boolean; onClick?: () => void };

/**
 * Chiffres clés du téléphone : UNE carte, les chiffres côte à côte séparés d'un filet (façon
 * Keel). Tout tient dans l'écran, rien n'est coupé : 2 ou 3 colonnes, 4 chiffres en 2 × 2.
 * Une case cliquable reste un bouton.
 */
export function PhoneStrip({ items, className }: { items: StripItem[]; className?: string }) {
  const cols = items.length === 4 ? 2 : Math.min(items.length, 3);
  return (
    <div
      className={cn("grid overflow-hidden rounded-[18px] bg-surface", className)}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {items.map((it, i) => {
        const body = (
          <>
            <span className="line-clamp-2 text-[12px] leading-tight text-muted-foreground">{it.label}</span>
            <span className={cn("mt-1 block truncate text-[20px] font-medium leading-none tabular-nums tracking-[-0.03em] text-foreground", it.tone, it.active && "text-primary")}>{it.value}</span>
          </>
        );
        const cls = cn(
          "flex min-w-0 flex-col justify-between gap-1 px-3.5 py-3 text-left transition-colors",
          i % cols !== 0 && "border-l border-border",
          i >= cols && "border-t border-border",
          it.active && "bg-primary/[0.06]",
        );
        return it.onClick ? (
          <button key={it.label} type="button" onClick={it.onClick} aria-pressed={it.active} className={cls}>{body}</button>
        ) : (
          <div key={it.label} className={cls}>{body}</div>
        );
      })}
    </div>
  );
}

/** Vrai sur téléphone : pratique pour choisir entre la version compacte et celle d'ordinateur. */
export const usePhoneLayout = useIosPhone;
