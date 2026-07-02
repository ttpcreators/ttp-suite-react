import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, AlertTriangle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type ActionItem = {
  key: string;
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  /** Si présent, ouvre une confirmation avant de lancer l'action. */
  confirm?: { title?: string; message: string; confirmLabel?: string };
};

/** Dialogue de confirmation (destructif) — réutilisable seul. */
export function ConfirmDialog({
  title = "Confirmer",
  message,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  danger,
  onConfirm,
  onCancel,
}: {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full", danger ? "bg-rose-500/10 text-rose-500" : "bg-primary/10 text-primary")}>
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">{title}</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{message}</p>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-border bg-surface px-4 py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground">
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} className={cn("rounded-lg px-4 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90", danger ? "bg-rose-500" : "bg-primary")}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Bouton d'actions compact (⋯) : regroupe plusieurs actions dans un menu déroulant
 * pour gagner de l'espace. Menu rendu en PORTAL (jamais rogné). Une action peut
 * demander une confirmation (ex. suppression).
 */
export function ActionMenu({ items, buttonClassName, align = "right" }: { items: ActionItem[]; buttonClassName?: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [confirmItem, setConfirmItem] = useState<ActionItem | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setOpen(true);
  };

  const run = (item: ActionItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    if (item.confirm) setConfirmItem(item);
    else item.onClick();
  };

  const W = 210;
  const left = rect ? (align === "left" ? rect.left : Math.max(8, rect.right - W)) : 0;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        title="Actions"
        className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground", buttonClassName)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open &&
        rect &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[70]" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
            <div
              className="fixed z-[71] overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-xl"
              style={{ top: rect.bottom + 6, left, width: W }}
            >
              {items.map((it) => (
                <button
                  key={it.key}
                  type="button"
                  onClick={(e) => run(it, e)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
                    it.danger ? "text-rose-500 hover:bg-rose-500/10" : "text-foreground hover:bg-rowhover",
                  )}
                >
                  {it.icon && <it.icon className="h-4 w-4 shrink-0" />}
                  <span className="truncate">{it.label}</span>
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}

      {confirmItem && (
        <ConfirmDialog
          title={confirmItem.confirm?.title ?? "Confirmer la suppression"}
          message={confirmItem.confirm?.message ?? "Cette action est irréversible."}
          confirmLabel={confirmItem.confirm?.confirmLabel ?? "Supprimer"}
          danger={confirmItem.danger}
          onCancel={() => setConfirmItem(null)}
          onConfirm={() => {
            const it = confirmItem;
            setConfirmItem(null);
            it.onClick();
          }}
        />
      )}
    </>
  );
}
