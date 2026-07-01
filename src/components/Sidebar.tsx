import { useState } from "react";
import { ChevronDown, LogOut } from "lucide-react";
import { NAV, type ViewId } from "@/lib/nav";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL;

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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (id: string) =>
    setCollapsed((c) => ({ ...c, [id]: !c[id] }));

  return (
    <aside className="flex h-full w-[236px] shrink-0 flex-col pb-4 pl-[18px] pr-[10px] pt-2">
      {/* logo */}
      <div className="flex items-center gap-[11px] px-2 py-[14px]">
        <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-[#14181E]">
          <img src={`${BASE}cover.png`} alt="TTP" className="h-full w-full object-cover" />
        </div>
        <div>
          <div className="text-[15px] font-bold tracking-[.2px]">TTP</div>
          <div className="mt-px text-[11px] text-faint">Trust the Process</div>
        </div>
      </div>

      {/* space switch */}
      <div className="mx-[6px] mb-[6px] flex rounded-[11px] bg-panel p-[3px]">
        <button
          type="button"
          onClick={() => onSpaceChange("agency")}
          className={cn(
            "flex-1 rounded-[8px] py-2 text-center text-[10px] font-semibold tracking-[.5px] transition-colors",
            space === "agency"
              ? "bg-surface text-foreground shadow-sm"
              : "text-faint hover:text-foreground",
          )}
        >
          AGENCE
        </button>
        <button
          type="button"
          onClick={() => onSpaceChange("portal")}
          className={cn(
            "flex-1 rounded-[8px] py-2 text-center text-[10px] font-semibold tracking-[.5px] transition-colors",
            space === "portal"
              ? "bg-surface text-foreground shadow-sm"
              : "text-faint hover:text-foreground",
          )}
        >
          CRÉATEURS
        </button>
      </div>

      {/* sections + items */}
      <nav className="mt-0.5 min-h-0 flex-1 overflow-y-auto">
        {NAV.map((family) => {
          const open = !collapsed[family.id];
          return (
            <div key={family.id}>
              <button
                type="button"
                onClick={() => toggle(family.id)}
                className="flex w-full items-center justify-between px-3 pb-[7px] pt-[14px] text-[10px] font-semibold tracking-[1.6px] text-faint transition-colors hover:text-foreground"
              >
                <span>{family.label.toUpperCase()}</span>
                <ChevronDown
                  className={cn("h-3 w-3 transition-transform", !open && "-rotate-90")}
                />
              </button>
              {open &&
                family.items.map((item) => {
                  const isActive = item.id === active;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelect(item.id)}
                      className={cn(
                        "mb-[3px] flex w-full items-center gap-3 rounded-[13px] px-4 py-2.5 text-left transition-colors",
                        isActive ? "bg-foreground" : "hover:bg-rowhover",
                      )}
                    >
                      <item.icon
                        className={cn(
                          "h-4 w-4 shrink-0",
                          isActive ? "text-background" : "text-muted-foreground",
                        )}
                      />
                      <span
                        className={cn(
                          "flex-1 text-[13px] font-medium",
                          isActive ? "text-background" : "text-muted-foreground",
                        )}
                      >
                        {item.label}
                      </span>
                      {isActive && (
                        <span className="ttp-pulse h-2 w-2 rounded-full bg-signal" />
                      )}
                    </button>
                  );
                })}
            </div>
          );
        })}
      </nav>

      {/* prospection card */}
      <button
        type="button"
        onClick={() => onSelect("prospection")}
        className="mt-2.5 rounded-[12px] bg-foreground p-4 text-left"
      >
        <div className="text-[13px] font-semibold leading-tight text-background">
          Prospection active
        </div>
        <div className="mt-1.5 text-[11px] leading-relaxed text-faint">
          Relance tes marques et suis ton pipeline.
        </div>
        <div className="mt-3 rounded-[10px] bg-signal py-[9px] text-center text-[10px] font-semibold text-onsignal">
          OUVRIR
        </div>
      </button>

      {/* logout */}
      <button
        type="button"
        onClick={onLogout}
        className="mt-2 flex items-center gap-2.5 rounded-[8px] px-[14px] py-[11px] text-muted-foreground transition-colors hover:bg-rowhover"
      >
        <LogOut className="h-4 w-4" />
        <span className="text-xs font-medium">Se déconnecter</span>
      </button>
    </aside>
  );
}
