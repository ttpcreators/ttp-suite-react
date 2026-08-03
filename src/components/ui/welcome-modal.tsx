import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Modale « welcome » réutilisable (titre + description + contenu + action), bâtie
 * sur le motif de modale MAISON (overlay + carte centrée) — pas de dépendance
 * radix-dialog (qui entrerait en conflit avec les composants existants). Sert à
 * sortir des encarts explicatifs du flux pour gagner de la place : un bouton ouvre
 * la modale au lieu d'occuper l'écran en permanence.
 */
export function WelcomeModal({
  open,
  onClose,
  icon,
  title,
  description,
  children,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  className,
}: {
  open: boolean;
  onClose: () => void;
  icon?: ReactNode;
  title: ReactNode;
  description?: string;
  children?: ReactNode;
  primaryLabel?: string;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className={cn("w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl", className)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative p-6 sm:p-7">
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2.5 pr-8 text-lg font-bold tracking-tight text-foreground sm:text-xl">
            {icon} {title}
          </div>
          {description && <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
          {children && <div className="mt-5 text-[13px] leading-relaxed text-foreground">{children}</div>}
        </div>
        {primaryLabel && (
          <div className="flex items-center justify-end gap-3 border-t border-border bg-panel/40 px-6 py-4 sm:px-7">
            <button
              type="button"
              onClick={onPrimary}
              disabled={primaryDisabled}
              className="rounded-xl bg-primary px-5 py-2.5 text-[13px] font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {primaryLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
