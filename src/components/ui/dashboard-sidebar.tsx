import { useEffect, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { ChevronRight, Columns2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type SbChild = { id: string; label: string };
export type SbItem = { id: string; label: string; icon: LucideIcon; badge?: number | string; children?: SbChild[] };
export type SbGroup = { id: string; label: string; icon: LucideIcon; items: SbItem[] };

function Row({
  item,
  active,
  onClick,
  onContext,
  onSplit,
  hasChildren,
  open,
  onToggle,
}: {
  item: SbItem;
  active: boolean;
  onClick: () => void;
  onContext?: (e: ReactMouseEvent) => void;
  /** Ouvre cette page « à côté » (vue partagée) — bouton révélé au survol. */
  onSplit?: () => void;
  hasChildren?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="group relative flex items-center">
      <button
        type="button"
        onClick={onClick}
        onContextMenu={onContext}
        className={cn(
          "flex w-full select-none items-center justify-between rounded-[7px] py-[7px] pl-3 pr-2.5 text-left transition-colors",
          hasChildren && "pr-9",
          active
            ? "bg-rowhover font-medium text-foreground"
            : "text-muted-foreground hover:bg-rowhover hover:text-foreground",
        )}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <item.icon
            className={cn(
              "h-4 w-4 shrink-0 transition-colors",
              active ? "text-primary" : "text-faint group-hover:text-foreground/70",
            )}
            strokeWidth={1.75}
          />
          <span className="truncate text-[13px] tracking-wide">{item.label}</span>
        </span>
        {item.badge != null && (
          <span className={cn("flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary", (hasChildren || onSplit) && "mr-6")}>
            {item.badge}
          </span>
        )}
      </button>

      {/* Chevron de repli (items à sous-pages) — toggle SANS naviguer */}
      {hasChildren ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.();
          }}
          aria-label={open ? "Replier" : "Déplier"}
          aria-expanded={open}
          className="absolute right-1.5 grid h-6 w-6 place-items-center rounded-md text-faint transition-colors hover:bg-surface hover:text-foreground"
        >
          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform duration-200", open && "rotate-90")} strokeWidth={2} />
        </button>
      ) : (
        onSplit && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSplit();
            }}
            title="Ouvrir à côté (2 pages côte à côte)"
            aria-label="Ouvrir à côté"
            className="absolute right-1.5 grid h-6 w-6 place-items-center rounded-md text-faint opacity-0 transition-opacity hover:bg-surface hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Columns2 className="h-3.5 w-3.5" />
          </button>
        )
      )}
    </div>
  );
}

/**
 * Un item de nav + ses sous-pages REPLIABLES (chevron, animation, guide
 * d'indentation). Ouvert par défaut (sidebar aérée) ; état mémorisé par item ;
 * se rouvre toujours quand la page/ sous-page active est dedans.
 */
function ItemBlock({
  item,
  activeId,
  activeSub,
  onSelect,
  onItemContext,
  onItemSplit,
}: {
  item: SbItem;
  activeId: string;
  activeSub?: string | null;
  onSelect: (id: string, sub?: string) => void;
  onItemContext?: (id: string, e: ReactMouseEvent) => void;
  onItemSplit?: (id: string) => void;
}) {
  const hasChildren = !!item.children && item.children.length > 0;
  const parentActive = item.id === activeId;
  const childActive = hasChildren && parentActive && item.children!.some((c) => c.id === activeSub);
  const storageKey = `ttp:sb-item:${item.id}`;
  const [open, setOpen] = useState(() => {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(storageKey) !== "0"; // défaut : ouvert
  });
  // La page active rouvre toujours son item (navigation / recherche).
  useEffect(() => {
    if (parentActive && hasChildren) setOpen(true);
  }, [parentActive, hasChildren]);
  const toggle = () =>
    setOpen((o) => {
      const next = !o;
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* stockage indispo : état gardé en mémoire */
      }
      return next;
    });

  return (
    <div className="flex flex-col">
      <Row
        item={item}
        active={parentActive && !childActive}
        hasChildren={hasChildren}
        open={open}
        onToggle={toggle}
        onClick={() => {
          onSelect(item.id);
          if (hasChildren) setOpen(true);
        }}
        onContext={onItemContext ? (e) => onItemContext(item.id, e) : undefined}
        onSplit={!hasChildren && onItemSplit ? () => onItemSplit(item.id) : undefined}
      />
      {hasChildren && (
        <div
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-300 ease-in-out",
            open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="ml-[26px] mt-0.5 flex flex-col gap-0.5 border-l border-border pl-2">
              {item.children!.map((c) => {
                const on = parentActive && activeSub === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onSelect(item.id, c.id)}
                    className={cn(
                      "select-none rounded-[6px] py-1.5 pl-2.5 pr-2 text-left text-[12px] tracking-wide transition-colors",
                      on ? "bg-rowhover font-medium text-foreground" : "text-muted-foreground hover:bg-rowhover hover:text-foreground",
                    )}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Group({
  group,
  activeId,
  activeSub,
  onSelect,
  onItemContext,
  onItemSplit,
}: {
  group: SbGroup;
  activeId: string;
  activeSub?: string | null;
  onSelect: (id: string, sub?: string) => void;
  onItemContext?: (id: string, e: ReactMouseEvent) => void;
  onItemSplit?: (id: string) => void;
}) {
  // Toutes les sections OUVERTES par défaut (sidebar aérée) ; repliable + mémorisé.
  // Le groupe de la page active se rouvre toujours.
  const containsActive = group.items.some((i) => i.id === activeId);
  const storageKey = `ttp:sb-group:${group.id}`;
  const [open, setOpen] = useState(() => {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(storageKey) !== "0"; // défaut : ouvert
  });
  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);
  const toggle = () =>
    setOpen((o) => {
      const next = !o;
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* stockage indispo : on garde juste l'état en mémoire */
      }
      return next;
    });
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={toggle}
        className="group/h flex select-none items-center justify-between rounded-[6px] px-2.5 py-1.5 text-left transition-colors hover:bg-rowhover/60"
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          {group.label}
        </span>
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-faint/60 transition-transform duration-200 group-hover/h:text-faint",
            open && "rotate-90",
          )}
          strokeWidth={2}
        />
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-in-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="flex min-h-0 flex-col gap-0.5 overflow-hidden pt-0.5">
          {group.items.map((item) => (
            <ItemBlock
              key={item.id}
              item={item}
              activeId={activeId}
              activeSub={activeSub}
              onSelect={onSelect}
              onItemContext={onItemContext}
              onItemSplit={onItemSplit}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Sidebar desktop premium : en-tête (logo / switch d'espace), groupes de nav
 * repliables (et sous-pages repliables par item), et pied de page. Générique —
 * on lui passe les groupes + le contenu header/footer.
 */
export function SidebarNav({
  groups,
  activeId,
  activeSub,
  onSelect,
  onItemContext,
  onItemSplit,
  header,
  footer,
}: {
  groups: SbGroup[];
  activeId: string;
  activeSub?: string | null;
  onSelect: (id: string, sub?: string) => void;
  onItemContext?: (id: string, e: ReactMouseEvent) => void;
  onItemSplit?: (id: string) => void;
  header?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col p-3">
      {header}
      <nav className="mt-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {groups.map((g) => (
          <Group
            key={g.id}
            group={g}
            activeId={activeId}
            activeSub={activeSub}
            onSelect={onSelect}
            onItemContext={onItemContext}
            onItemSplit={onItemSplit}
          />
        ))}
      </nav>
      {footer && <div className="mt-auto border-t border-border pt-3">{footer}</div>}
    </aside>
  );
}
