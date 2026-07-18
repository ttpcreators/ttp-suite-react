import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { LogOut, Trash2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NAV, type ViewId } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { SidebarNav, type SbGroup } from "@/components/ui/dashboard-sidebar";

const BASE = import.meta.env.BASE_URL;

const GROUPS: SbGroup[] = NAV.map((f) => ({
  id: f.id,
  label: f.label,
  icon: f.icon,
  items: f.items.map((i) => ({ id: i.id, label: i.label, icon: i.icon, children: i.children })),
}));

export function Sidebar({
  active,
  activeSub,
  onSelect,
  onLogout,
  space,
  onSpaceChange,
  onItemContext,
  onItemSplit,
}: {
  active: ViewId;
  activeSub?: string | null;
  onSelect: (id: ViewId, sub?: string) => void;
  onLogout: () => void;
  space: "agency" | "portal";
  onSpaceChange: (s: "agency" | "portal") => void;
  onItemContext?: (id: ViewId, e: ReactMouseEvent) => void;
  onItemSplit?: (id: ViewId) => void;
}) {
  // Sidebar repliable en rail d'icônes (mémorisé).
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("ttp:sidebar-collapsed") === "1");
  useEffect(() => {
    localStorage.setItem("ttp:sidebar-collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  // ── Rail replié : logo + icônes seules (tooltip au survol) + pied ──
  if (collapsed) {
    return (
      <aside className="flex h-full w-[68px] shrink-0 flex-col items-center p-2">
        <div className="mt-1 h-9 w-9 shrink-0 overflow-hidden rounded-[8px] bg-[#14181E]">
          <img src={`${BASE}cover.png`} alt="TTP" className="h-full w-full object-cover" />
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="mt-2 grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-faint shadow-sm transition-colors hover:text-foreground"
          title="Déplier le menu"
          aria-label="Déplier le menu"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
        <nav className="mt-3 flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {GROUPS.map((g, gi) => (
            <div key={g.id} className="flex w-full flex-col items-center gap-1">
              {gi > 0 && <div className="my-1 h-px w-6 bg-border" />}
              {g.items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => onSelect(it.id as ViewId)}
                  onContextMenu={onItemContext ? (e) => onItemContext(it.id as ViewId, e) : undefined}
                  title={it.label}
                  className={cn(
                    "grid h-10 w-10 shrink-0 place-items-center rounded-[10px] transition-colors",
                    active === it.id ? "bg-primary/10 text-primary" : "text-faint hover:bg-rowhover hover:text-foreground",
                  )}
                >
                  <it.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="mt-auto flex w-full flex-col items-center gap-1 border-t border-border pt-2">
          <button
            type="button"
            onClick={() => onSelect("corbeille")}
            title="Corbeille"
            className={cn(
              "grid h-10 w-10 place-items-center rounded-[10px] transition-colors",
              active === "corbeille" ? "bg-primary/10 text-primary" : "text-faint hover:bg-rowhover hover:text-foreground",
            )}
          >
            <Trash2 className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onLogout}
            title="Se déconnecter"
            className="grid h-10 w-10 place-items-center rounded-[10px] text-faint transition-colors hover:bg-rowhover hover:text-foreground"
          >
            <LogOut className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>
        </div>
      </aside>
    );
  }

  const header = (
    <>
      {/* logo + bouton replier */}
      <div className="flex items-center gap-3 px-1.5 py-2.5">
        <div className="h-8 w-8 shrink-0 overflow-hidden rounded-[7px] bg-[#14181E]">
          <img src={`${BASE}cover.png`} alt="TTP" className="h-full w-full object-cover" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-tight">TTP Suite</div>
          <div className="text-[11px] text-faint">Trust the Process</div>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
          title="Replier le menu"
          aria-label="Replier le menu"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      {/* space switch */}
      <div className="mb-2 mt-2 flex rounded-[9px] bg-panel p-[3px]">
        <button
          type="button"
          onClick={() => onSpaceChange("agency")}
          className={cn(
            "flex-1 rounded-[7px] py-1.5 text-center text-[10px] font-semibold tracking-[.5px] transition-colors",
            space === "agency" ? "bg-surface text-foreground shadow-sm" : "text-faint hover:text-foreground",
          )}
        >
          AGENCE
        </button>
        <button
          type="button"
          onClick={() => onSpaceChange("portal")}
          className={cn(
            "flex-1 rounded-[7px] py-1.5 text-center text-[10px] font-semibold tracking-[.5px] transition-colors",
            space === "portal" ? "bg-surface text-foreground shadow-sm" : "text-faint hover:text-foreground",
          )}
        >
          CRÉATEURS
        </button>
      </div>
    </>
  );

  const footer = (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => onSelect("corbeille")}
        className={cn(
          "group flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-[7px] transition-colors",
          active === "corbeille"
            ? "bg-rowhover font-medium text-foreground"
            : "text-muted-foreground hover:bg-rowhover hover:text-foreground",
        )}
      >
        <Trash2
          className={cn("h-4 w-4", active === "corbeille" ? "text-primary" : "text-faint group-hover:text-foreground/70")}
          strokeWidth={1.75}
        />
        <span className="text-[13px] tracking-wide">Corbeille</span>
      </button>
      <button
        type="button"
        onClick={onLogout}
        className="group flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-[7px] text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
      >
        <LogOut className="h-4 w-4 text-faint group-hover:text-foreground/70" strokeWidth={1.75} />
        <span className="text-[13px] tracking-wide">Se déconnecter</span>
      </button>
    </div>
  );

  return (
    <SidebarNav
      groups={GROUPS}
      activeId={active}
      activeSub={activeSub}
      onSelect={(id, sub) => onSelect(id as ViewId, sub)}
      onItemContext={onItemContext ? (id, e) => onItemContext(id as ViewId, e) : undefined}
      onItemSplit={onItemSplit ? (id) => onItemSplit(id as ViewId) : undefined}
      header={header}
      footer={footer}
    />
  );
}
