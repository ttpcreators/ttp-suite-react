import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Coque « app iPhone » (mode iPhone, téléphone seulement) :
 *   - IosTabBar  : barre d'onglets en bas (icône + libellé), translucide ;
 *   - IosNavBar  : barre de titre du haut, transparente en haut de page puis
 *                  floutée avec le titre centré quand le grand titre a défilé ;
 *   - IosGroup / IosRow / IosSwitch : listes groupées façon Réglages d'iOS.
 * Couleurs : encre pour l'onglet actif (code couleur de l'app), vert = activé.
 */

export type IosTab = { id: string; label: string; icon: LucideIcon; badge?: number | null };

/** Barre d'onglets du bas. Toucher l'onglet déjà ouvert remonte en haut de la page. */
export function IosTabBar({ items, active, onSelect, onReselect }: {
  items: IosTab[]; active: string; onSelect: (id: string) => void; onReselect?: (id: string) => void;
}) {
  return (
    <nav aria-label="Navigation principale" className="ios-chrome ios-bar fixed inset-x-0 bottom-0 z-50 border-t border-border/70 md:hidden">
      <div className="grid h-[50px]" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((t) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              aria-current={on ? "page" : undefined}
              onClick={() => (on ? onReselect?.(t.id) : onSelect(t.id))}
              className={cn("relative flex min-w-0 flex-col items-center justify-center gap-[3px] pt-1", on ? "text-foreground" : "text-faint")}
            >
              <span className="relative">
                <t.icon className="h-[23px] w-[23px]" strokeWidth={on ? 2.2 : 1.7} />
                {t.badge ? (
                  <span className="absolute -right-2.5 -top-1 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground">
                    {t.badge > 99 ? "99+" : t.badge}
                  </span>
                ) : null}
              </span>
              <span className={cn("max-w-full truncate px-0.5 text-[10px] leading-none", on ? "font-semibold" : "font-medium")}>{t.label}</span>
            </button>
          );
        })}
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}

/** Le contenu défilant a-t-il dépassé `threshold` px ? (barre de titre repliée) */
function useScrolledPast(scrollRef: RefObject<HTMLElement | null>, threshold = 44): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const on = () => setPast(el.scrollTop > threshold);
    on();
    el.addEventListener("scroll", on, { passive: true });
    return () => el.removeEventListener("scroll", on);
  }, [scrollRef, threshold]);
  return past;
}

/**
 * Barre de titre du haut, collée en haut de la zone qui défile. En haut de page,
 * elle est transparente (le grand titre de la page est visible dessous) ; dès que
 * le grand titre a défilé, elle devient floutée et affiche le titre au centre.
 */
export function IosNavBar({ scrollRef, title, left, right, className }: {
  scrollRef: RefObject<HTMLElement | null>; title: string; left?: ReactNode; right?: ReactNode; className?: string;
}) {
  const collapsed = useScrolledPast(scrollRef, 40);
  return (
    <div
      className={cn(
        "ios-chrome sticky top-0 z-40 border-b transition-[background-color,border-color] duration-200 md:hidden",
        collapsed ? "ios-bar border-border/70" : "border-transparent",
        className,
      )}
    >
      <div className="h-[env(safe-area-inset-top)]" />
      <div className="relative flex h-11 items-center px-1.5">
        <div className="z-10 flex min-w-0 flex-1 items-center">{left}</div>
        <div
          aria-hidden={!collapsed}
          className={cn(
            "pointer-events-none absolute inset-x-20 truncate text-center text-[17px] font-semibold text-foreground transition-opacity duration-200",
            collapsed ? "opacity-100" : "opacity-0",
          )}
        >
          {title}
        </div>
        <div className="z-10 flex shrink-0 items-center justify-end gap-0.5">{right}</div>
      </div>
    </div>
  );
}

/** Bouton « ‹ Retour » de la barre de titre. */
export function IosBackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-11 min-w-0 items-center gap-0.5 pr-2 text-[17px] text-primary">
      <ChevronLeft className="h-7 w-7 shrink-0" strokeWidth={2.2} />
      <span className="truncate">{label}</span>
    </button>
  );
}

/** Bouton icône de la barre de titre (recherche, notifications…). */
export function IosBarIcon({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="grid h-11 w-11 place-items-center text-foreground">
      <Icon className="h-[22px] w-[22px]" strokeWidth={1.9} />
    </button>
  );
}

/** Groupe d'une liste façon Réglages d'iOS (titre gris au-dessus, cartes arrondies). */
export function IosGroup({ title, footer, children, className }: { title?: string; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col", className)}>
      {title && <h2 className="px-4 pb-1.5 text-[0.8125rem] font-normal uppercase tracking-[0.02em] text-muted-foreground">{title}</h2>}
      <div className="overflow-hidden rounded-xl border border-border/60 bg-surface">{children}</div>
      {footer && <p className="px-4 pt-1.5 text-[0.8125rem] leading-snug text-muted-foreground">{footer}</p>}
    </section>
  );
}

/** Ligne d'une liste groupée : pastille d'icône, libellé, détail, chevron. */
export function IosRow({ icon: Icon, label, detail, onClick, chevron = true, destructive, right, indent, leading }: {
  icon?: LucideIcon; label: string; detail?: ReactNode; onClick?: () => void; chevron?: boolean;
  destructive?: boolean; right?: ReactNode; indent?: boolean; leading?: ReactNode;
}) {
  const body = (
    <>
      {leading ?? (Icon ? (
        <span className={cn("grid h-[29px] w-[29px] shrink-0 place-items-center rounded-[8px]", destructive ? "bg-red-500/10 text-red-600 dark:text-red-400" : "bg-muted text-foreground")}>
          <Icon className="h-[17px] w-[17px]" strokeWidth={1.9} />
        </span>
      ) : null)}
      {label && <span className={cn("min-w-0 flex-1 truncate text-[16px]", destructive ? "text-red-600 dark:text-red-400" : indent ? "text-muted-foreground" : "text-foreground")}>{label}</span>}
      {detail != null && <span className="max-w-[45%] shrink-0 truncate text-[15px] text-muted-foreground">{detail}</span>}
      {right}
      {chevron && onClick && <ChevronRight className="h-[18px] w-[18px] shrink-0 text-faint" strokeWidth={2.2} />}
    </>
  );
  const cls = cn(
    "relative flex min-h-[46px] w-full items-center gap-3 py-2 pr-3.5 text-left",
    indent ? "pl-[58px]" : "pl-3.5",
    // Filet inset (après l'icône), comme iOS ; pas sous la dernière ligne.
    "after:absolute after:bottom-0 after:right-0 after:h-px after:bg-border/70 last:after:hidden",
    Icon || leading || indent ? "after:left-[58px]" : "after:left-3.5",
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cls}>{body}</button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Interrupteur iOS (vert quand activé). */
export function IosSwitch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200", checked ? "bg-[#34c759]" : "bg-foreground/15")}
    >
      <span
        className={cn(
          "absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.16)] transition-[left] duration-200",
          checked ? "left-[22px]" : "left-[2px]",
        )}
      />
    </button>
  );
}
