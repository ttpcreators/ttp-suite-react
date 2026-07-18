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
}: {
  item: SbItem;
  active: boolean;
  onClick: () => void;
  onContext?: (e: ReactMouseEvent) => void;
  /** Ouvre cette page « à côté » (vue partagée) — bouton révélé au survol. */
  onSplit?: () => void;
}) {
  return (
    <div className="group relative flex items-center">
      <button
        type="button"
        onClick={onClick}
        onContextMenu={onContext}
        className={cn(
          "flex w-full select-none items-center justify-between rounded-[7px] py-[7px] pl-3 pr-2.5 text-left transition-colors",
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
          <span className="mr-6 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
            {item.badge}
          </span>
        )}
      </button>
      {onSplit && (
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
  // Toutes les sections OUVERTES par défaut (sidebar aérée, sous-pages visibles) ;
  // chaque section reste repliable et son état est MÉMORISÉ (localStorage). Le groupe
  // de la page active se rouvre toujours (navigation / recherche).
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
        <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground">
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
          {group.items.map((item) => {
            // Une sous-page (3e niveau) est active → on ne surligne pas le parent.
            const childActive = !!item.children && item.id === activeId && item.children.some((c) => c.id === activeSub);
            return (
              <div key={item.id} className="flex flex-col">
                <Row
                  item={item}
                  active={item.id === activeId && !childActive}
                  onClick={() => onSelect(item.id)}
                  onContext={onItemContext ? (e) => onItemContext(item.id, e) : undefined}
                  onSplit={onItemSplit ? () => onItemSplit(item.id) : undefined}
                />
                {item.children && item.children.length > 0 && (
                  <div className="ml-[26px] mt-0.5 flex flex-col gap-0.5 border-l border-border pl-2">
                    {item.children.map((c) => {
                      const on = item.id === activeId && activeSub === c.id;
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
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Sidebar desktop premium : en-tête (logo / switch d'espace), groupes de nav
 * repliables, et pied de page (déconnexion). Générique — on lui passe les
 * groupes + le contenu header/footer.
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
