import type { KeyboardEvent, ReactNode, Ref } from "react";
import { Spin } from "@/components/ui/loader";
import { Search, type LucideIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/*
 * Briques de la mise en page « client mail », partagées par la page Mails de
 * l'agence et la section Mails des créateurs : barre d'icônes, boutons des
 * barres du lecteur, champ de recherche de la liste.
 */

export type TipSide = "right" | "bottom" | "bottom-start" | "bottom-end" | "top";
const TIP_SIDE: Record<TipSide, string> = {
  right: "left-full top-1/2 ml-2.5 -translate-y-1/2",
  bottom: "left-1/2 top-full mt-1.5 -translate-x-1/2",
  "bottom-start": "left-0 top-full mt-1.5",
  "bottom-end": "right-0 top-full mt-1.5",
  top: "bottom-full left-1/2 mb-1.5 -translate-x-1/2",
};

/**
 * Bulle au survol d'un bouton (à droite par défaut, pour la barre d'icônes).
 * Le bouton parent porte la classe `group/tip relative`.
 */
export function Tip({ children, side = "right" }: { children: ReactNode; side?: TipSide }) {
  return (
    <span
      role="tooltip"
      className={cn(
        "pointer-events-none absolute z-30 flex items-center gap-1.5 whitespace-nowrap rounded-full bg-foreground px-2 py-1 text-[11px] font-medium text-background opacity-0 shadow-lg transition-opacity duration-150 group-hover/tip:opacity-100 group-focus-visible/tip:opacity-100",
        TIP_SIDE[side],
      )}
    >
      {children}
    </span>
  );
}

/** Touche de raccourci clavier (dans une bulle ou l'aide des raccourcis). */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn("rounded bg-background/20 px-1 font-mono text-[10px] font-semibold leading-[15px]", className)}>{children}</kbd>
  );
}

/**
 * Bouton de la barre d'icônes : trait à gauche quand c'est la vue affichée
 * (`bar={false}` : contour à la place). `badge` = pastille ; `count` = nombre sous l'icône ;
 * `caption` = petit libellé sous l'icône ; `shortcut` = raccourci affiché dans la bulle.
 */
export function RailButton({ label, active, bar = true, badge, count, caption, shortcut, onClick, children }: {
  label: string; active?: boolean; bar?: boolean; badge?: number | null; count?: number | null;
  caption?: string; shortcut?: string; onClick: () => void; children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "group/tip relative grid shrink-0 place-items-center rounded-xl transition-colors",
        caption ? "h-[50px] w-14" : "w-10",
        !caption && (count != null ? "h-12" : "h-10"),
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-rowhover hover:text-foreground",
        active && !bar && "ring-1 ring-border",
      )}
    >
      {active && bar && <span aria-hidden className={cn("absolute bottom-2 top-2 w-[3px] rounded-r-full bg-foreground", caption ? "-left-2" : "-left-3")} />}
      {caption ? (
        <span className="relative flex flex-col items-center gap-1">
          {children}
          <span className="max-w-[52px] truncate text-[10.5px] font-medium leading-none">{caption}</span>
        </span>
      ) : count != null ? (
        <span className="flex flex-col items-center gap-1">
          {children}
          <span className="text-[10px] font-semibold leading-none tabular-nums">{count}</span>
        </span>
      ) : (
        children
      )}
      {badge ? (
        <span className={cn(
          "absolute min-w-[18px] rounded-full bg-foreground px-1 text-center text-[10px] font-semibold leading-[18px] tabular-nums text-background ring-2 ring-surface",
          caption ? "right-0.5 top-0.5" : "-right-1.5 -top-1.5",
        )}>
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
      <Tip>
        {label}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </Tip>
    </button>
  );
}

/**
 * Bouton icône des barres du lecteur. `shortcut` / `tipSide` : bulle stylée (avec le
 * raccourci) à la place de la bulle du navigateur ; `text` : libellé visible sur grand écran (≥ xl).
 */
export function ToolButton({ icon: Icon, label, onClick, disabled, busy, spin, danger, className, shortcut, tipSide, text }: {
  icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean; busy?: boolean; spin?: boolean; danger?: boolean; className?: string;
  shortcut?: string; tipSide?: TipSide; text?: string;
}) {
  const styled = shortcut != null || tipSide != null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={styled ? undefined : label}
      aria-label={label}
      className={cn(
        "group/tip relative grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:pointer-events-none disabled:opacity-35",
        text && "@4xl:flex @4xl:w-auto @4xl:items-center @4xl:gap-1.5 @4xl:px-3",
        danger && "hover:bg-danger/[0.08] hover:text-dangertext dark:hover:text-dangertext",
        className,
      )}
    >
      {busy ? <Spin size={16} /> : <Icon className={cn("h-[17px] w-[17px]", spin && "animate-spin")} />}
      {text && <span className="hidden text-[13px] font-medium @4xl:inline">{text}</span>}
      {styled && (
        <Tip side={tipSide ?? "bottom"}>
          {label}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </Tip>
      )}
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
        "inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50",
        danger && "hover:bg-danger/[0.08] hover:text-dangertext dark:hover:text-dangertext",
      )}
    >
      {busy ? <Spin size={16} /> : <Icon className="h-4 w-4" />}
      {label}
    </button>
  );
}

/** Champ de recherche en tête de liste (`size="sm"` : 32 px). */
export function SearchField({ value, onChange, placeholder, size = "md", inputRef, onKeyDown, label }: {
  value: string; onChange: (v: string) => void; placeholder: string;
  size?: "sm" | "md"; inputRef?: Ref<HTMLInputElement>; onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void; label?: string;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        className={cn(
          "w-full rounded-md border border-border bg-surface pl-9 pr-3 text-[13px] text-foreground outline-none placeholder:text-faint focus:border-primary [&::-webkit-search-cancel-button]:hidden",
          size === "sm" ? "h-8" : "h-9",
        )}
      />
    </div>
  );
}

/** Ligne de la liste : fond blanc quand ouverte, léger survol sinon. */
export const mailRowCls = (on: boolean) =>
  cn("flex w-full gap-3 px-4 text-left transition-colors sm:px-5", on ? "bg-surface dark:bg-white/[0.07]" : "hover:bg-surface/60 dark:hover:bg-white/[0.04]");

/** Bouton « pilule » de la barre en ligne (téléphone, tablette). */
export const pillCls = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold transition-colors";
