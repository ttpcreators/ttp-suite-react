import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type SbItem = { id: string; label: string; icon: LucideIcon; badge?: number | string };
export type SbGroup = { id: string; label: string; icon: LucideIcon; items: SbItem[] };

function Row({
  item,
  active,
  onClick,
}: {
  item: SbItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full select-none items-center justify-between rounded-[7px] py-[7px] pl-3 pr-2.5 text-left transition-colors",
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
        <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
          {item.badge}
        </span>
      )}
    </button>
  );
}

function Group({
  group,
  activeId,
  onSelect,
}: {
  group: SbGroup;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  // Au chargement : groupes repliés (effet aéré) ; seul le groupe de la page
  // active reste ouvert. Se rouvre si un de ses items devient actif (recherche…).
  const containsActive = group.items.some((i) => i.id === activeId);
  const [open, setOpen] = useState(containsActive);
  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="group/h flex select-none items-center justify-between rounded-[6px] px-2.5 py-1.5 text-left transition-colors hover:bg-rowhover/60"
      >
        <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-faint">
          <group.icon className="h-3.5 w-3.5" strokeWidth={2} />
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
            <Row key={item.id} item={item} active={item.id === activeId} onClick={() => onSelect(item.id)} />
          ))}
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
  onSelect,
  header,
  footer,
}: {
  groups: SbGroup[];
  activeId: string;
  onSelect: (id: string) => void;
  header?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col p-3">
      {header}
      <nav className="mt-1 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {groups.map((g) => (
          <Group key={g.id} group={g} activeId={activeId} onSelect={onSelect} />
        ))}
      </nav>
      {footer && <div className="mt-auto border-t border-border pt-3">{footer}</div>}
    </aside>
  );
}
