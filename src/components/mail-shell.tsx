import type { ReactNode } from "react";
import { Loader2, Search, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Briques de la mise en page « client mail », partagées par la page Mails de
 * l'agence et la section Mails des créatrices : barre d'icônes, boutons des
 * barres du lecteur, champ de recherche de la liste.
 */

/** Bulle au survol, à droite d'un bouton de la barre d'icônes. */
export function Tip({ children }: { children: ReactNode }) {
  return (
    <span role="tooltip" className="pointer-events-none absolute left-full top-1/2 z-30 ml-2.5 -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] font-medium text-background opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
      {children}
    </span>
  );
}

/**
 * Bouton de la barre d'icônes : trait à gauche quand c'est la vue affichée
 * (`bar={false}` : contour à la place). `badge` = pastille ; `count` = nombre sous l'icône.
 */
export function RailButton({ label, active, bar = true, badge, count, onClick, children }: {
  label: string; active?: boolean; bar?: boolean; badge?: number | null; count?: number | null; onClick: () => void; children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "group relative grid w-10 shrink-0 place-items-center rounded-xl transition-colors",
        count != null ? "h-12" : "h-10",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-rowhover hover:text-foreground",
        active && !bar && "ring-1 ring-border",
      )}
    >
      {active && bar && <span aria-hidden className="absolute -left-3 bottom-2 top-2 w-[3px] rounded-r-full bg-foreground" />}
      {count != null ? (
        <span className="flex flex-col items-center gap-1">
          {children}
          <span className="text-[10px] font-semibold leading-none tabular-nums">{count}</span>
        </span>
      ) : (
        children
      )}
      {badge ? (
        <span className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-foreground px-1 text-center text-[10px] font-semibold leading-[18px] tabular-nums text-background ring-2 ring-surface">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
      <Tip>{label}</Tip>
    </button>
  );
}

/** Bouton icône des barres du lecteur. */
export function ToolButton({ icon: Icon, label, onClick, disabled, busy, spin, danger, className }: {
  icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean; busy?: boolean; spin?: boolean; danger?: boolean; className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:pointer-events-none disabled:opacity-35",
        danger && "hover:bg-red-500/[0.08] hover:text-red-600 dark:hover:text-red-400",
        className,
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className={cn("h-[17px] w-[17px]", spin && "animate-spin")} />}
    </button>
  );
}

/** Bouton avec texte de la barre du bas (Répondre, Transférer…). */
export function BarButton({ icon: Icon, label, onClick, disabled, busy, danger }: {
  icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean; busy?: boolean; danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50",
        danger && "hover:bg-red-500/[0.08] hover:text-red-600 dark:hover:text-red-400",
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      {label}
    </button>
  );
}

/** Champ de recherche en tête de liste. */
export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-[13px] text-foreground outline-none placeholder:text-faint focus:border-primary"
      />
    </div>
  );
}

/** Ligne de la liste : fond blanc quand ouverte, léger survol sinon. */
export const mailRowCls = (on: boolean) =>
  cn("flex w-full gap-3 px-4 text-left transition-colors sm:px-5", on ? "bg-surface dark:bg-white/[0.07]" : "hover:bg-surface/60 dark:hover:bg-white/[0.04]");

/** Bouton « pilule » de la barre en ligne (téléphone, tablette). */
export const pillCls = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold transition-colors";
