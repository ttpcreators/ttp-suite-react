import { LogOut } from "lucide-react";
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
}: {
  active: ViewId;
  onSelect: (id: ViewId) => void;
  onLogout: () => void;
  space: "agency" | "portal";
  onSpaceChange: (s: "agency" | "portal") => void;
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
    <button
      type="button"
      onClick={onLogout}
      className="group flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-[7px] text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
    >
      <LogOut className="h-4 w-4 text-faint group-hover:text-foreground/70" strokeWidth={1.75} />
      <span className="text-[13px] tracking-wide">Se déconnecter</span>
    </button>
  );

  return (
    <SidebarNav
      groups={GROUPS}
      activeId={active}
      onSelect={(id) => onSelect(id as ViewId)}
      header={header}
      footer={footer}
    />
  );
}
