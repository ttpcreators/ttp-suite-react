import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { ActionMenu, type ActionItem } from "@/components/ui/action-menu";
import { useIosPhone } from "@/components/mobile/ios-sheet";
import { useNavActionSlot } from "@/lib/navAction";
import { cn } from "@/lib/utils";

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
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div role="tablist" aria-label={label} className="-ml-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto pl-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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

/** Chiffres clés en bande compacte qui défile (téléphone). Une case cliquable reste un bouton. */
export function PhoneStrip({ items, className }: { items: StripItem[]; className?: string }) {
  return (
    <div className={cn("-mx-4 flex gap-2 overflow-x-auto px-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}>
      {items.map((it) => {
        const body = (
          <>
            <span className="block truncate text-[12px] text-muted-foreground">{it.label}</span>
            <span className={cn("mt-0.5 block truncate text-[19px] font-semibold tabular-nums tracking-tight text-foreground", it.tone)}>{it.value}</span>
          </>
        );
        const cls = cn(
          "min-w-[38%] max-w-[60%] shrink-0 rounded-[14px] px-3.5 py-2.5 text-left",
          it.active ? "bg-primary/[0.08] ring-[1.5px] ring-inset ring-primary" : "bg-surface",
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
