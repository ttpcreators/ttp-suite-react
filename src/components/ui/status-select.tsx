import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "@/components/icons";
import { cn } from "@/lib/utils";
import { IosActionSheet, useIosPhone } from "@/components/mobile/ios-sheet";

export type StatusOption = { value: string; label: string; dot: string };

/**
 * Sélecteur de statut compact avec pastille colorée (dans le bouton ET le menu).
 * Le menu est rendu dans un PORTAL (position fixe) pour ne jamais être rogné par
 * un conteneur en overflow (ex. colonnes kanban, tableaux, cartes).
 * Sur téléphone : feuille d'actions iOS (lignes de 57 px, « Annuler » à part), comme
 * ActionMenu. Sur ordinateur : le menu s'ouvre vers le haut quand la place manque sous
 * le bouton, et reste toujours dans la fenêtre.
 */
export function StatusSelect({
  value,
  options,
  onChange,
  className,
}: {
  value: string;
  options: StatusOption[];
  onChange: (v: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const ios = useIosPhone();
  const cur = options.find((o) => o.value === value) ?? options[0];
  const pick = (v: string) => {
    setOpen(false);
    onChange(v);
  };

  // Placement du menu (ordinateur) : même mécanique qu'ActionMenu / AddMenuButton.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  const MAX_H = 260;
  const W = rect ? Math.min(rect.width, vw - 16) : 0;
  const left = rect ? Math.min(Math.max(8, rect.left), Math.max(8, vw - W - 8)) : 0;
  const spaceBelow = rect ? vh - rect.bottom - 8 : 0;
  const spaceAbove = rect ? rect.top - 8 : 0;
  // Hauteur voulue ≈ 32 px par ligne + marges, plafonnée à 260 px.
  const wanted = Math.min(MAX_H, options.length * 32 + 10);
  const menuUp = !!rect && spaceBelow < wanted && spaceAbove > spaceBelow;
  const menuMaxH = Math.round(Math.max(120, Math.min(MAX_H, menuUp ? spaceAbove - 4 : spaceBelow - 4)));

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setOpen(true);
  };

  return (
    <div className={cn("relative", className)}>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-haspopup={ios ? "dialog" : "listbox"}
        aria-expanded={open}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] text-foreground outline-none transition-colors hover:bg-rowhover focus:border-primary"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("size-1.5 shrink-0 rounded-full", cur?.dot)} />
          <span className="truncate">{cur?.label ?? "—"}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </button>

      {open && ios && (
        // Les clics d'un portail remontent l'arbre React : on les arrête ici pour ne pas
        // ouvrir la carte ou la ligne qui contient le sélecteur.
        <span className="contents" onClick={(e) => e.stopPropagation()}>
          <IosActionSheet
            actions={options.map((o) => ({ key: o.value, label: o.label, dot: o.dot, selected: o.value === value, onClick: () => pick(o.value) }))}
            onCancel={() => setOpen(false)}
          />
        </span>
      )}
      {open &&
        !ios &&
        rect &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[60]"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
            />
            <div
              role="listbox"
              className="fixed z-[61] overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-xl"
              style={{ ...(menuUp ? { bottom: vh - rect.top + 4 } : { top: rect.bottom + 4 }), left, width: W, maxHeight: menuMaxH }}
            >
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  onClick={(e) => {
                    e.stopPropagation();
                    pick(o.value);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-rowhover"
                >
                  <span className={cn("size-1.5 shrink-0 rounded-full", o.dot)} />
                  <span className="truncate">{o.label}</span>
                  {o.value === value && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" />}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
