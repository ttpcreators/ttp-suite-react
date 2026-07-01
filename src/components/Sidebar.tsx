import { LogOut, type LucideIcon } from "lucide-react";
import { NAV, type ViewId } from "@/lib/nav";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL;

function NavItem({
  icon: Icon,
  title,
  active,
  badge,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  active: boolean;
  badge?: number | string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-center justify-between rounded-[7px] px-2.5 py-[7px] text-left transition-colors select-none",
        active
          ? "bg-rowhover font-medium text-foreground"
          : "text-muted-foreground hover:bg-rowhover hover:text-foreground",
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <Icon
          className={cn(
            "h-4 w-4 shrink-0 transition-colors",
            active ? "text-foreground" : "text-faint group-hover:text-foreground/70",
          )}
          strokeWidth={1.75}
        />
        <span className="truncate text-[13px] tracking-wide">{title}</span>
      </span>
      {badge != null && (
        <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-signalsoft px-1.5 text-[10px] font-semibold text-signaltext">
          {badge}
        </span>
      )}
    </button>
  );
}

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
  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col p-3">
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
      <div className="mb-3 mt-2 flex rounded-[9px] bg-panel p-[3px]">
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

      {/* nav groups */}
      <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {NAV.map((family) => (
          <div key={family.id} className="flex flex-col gap-0.5">
            <span className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-faint">
              {family.label}
            </span>
            {family.items.map((item) => (
              <NavItem
                key={item.id}
                icon={item.icon}
                title={item.label}
                active={item.id === active}
                onClick={() => onSelect(item.id)}
              />
            ))}
          </div>
        ))}
      </nav>

      {/* bottom */}
      <div className="mt-auto flex flex-col gap-0.5 border-t border-border pt-3">
        <button
          type="button"
          onClick={onLogout}
          className="group flex items-center gap-2.5 rounded-[7px] px-2.5 py-[7px] text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
        >
          <LogOut className="h-4 w-4 text-faint group-hover:text-foreground/70" strokeWidth={1.75} />
          <span className="text-[13px] tracking-wide">Se déconnecter</span>
        </button>
      </div>
    </aside>
  );
}
