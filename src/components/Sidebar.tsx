import type { MouseEvent as ReactMouseEvent } from "react";
import { LogOut, Trash2 } from "lucide-react";
import { NAV, type ViewId } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { SidebarNav, type SbGroup } from "@/components/ui/dashboard-sidebar";

const BASE = import.meta.env.BASE_URL;

const GROUPS: SbGroup[] = NAV.map((f) => ({
  id: f.id,
  label: f.label,
  icon: f.icon,
  items: f.items.map((i) => ({ id: i.id, label: i.label, icon: i.icon })),
}));

export function Sidebar({
  active,
  onSelect,
  onLogout,
  space,
  onSpaceChange,
  onItemContext,
}: {
  active: ViewId;
  onSelect: (id: ViewId) => void;
  onLogout: () => void;
  space: "agency" | "portal";
  onSpaceChange: (s: "agency" | "portal") => void;
  onItemContext?: (id: ViewId, e: ReactMouseEvent) => void;
}) {
  const header = (
    <>
      {/* logo */}
      <div className="flex items-center gap-3 px-1.5 py-2.5">
        <div className="h-8 w-8 shrink-0 overflow-hidden rounded-[7px] bg-[#14181E]">
          <img src={`${BASE}cover.png`} alt="TTP" className="h-full w-full object-cover" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold leading-tight">TTP Suite</div>
          <div className="text-[11px] text-faint">Trust the Process</div>
        </div>
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
      onSelect={(id) => onSelect(id as ViewId)}
      onItemContext={onItemContext ? (id, e) => onItemContext(id as ViewId, e) : undefined}
      header={header}
      footer={footer}
    />
  );
}
