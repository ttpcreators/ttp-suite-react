import { motion } from "motion/react";
import { Moon, Sun, LogOut } from "lucide-react";
import { NAV, type ViewId } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function Sidebar({
  active,
  onSelect,
  dark,
  onToggleTheme,
  onLogout,
}: {
  active: ViewId;
  onSelect: (id: ViewId) => void;
  dark: boolean;
  onToggleTheme: () => void;
  onLogout: () => void;
}) {
  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-border bg-card">
      {/* logo */}
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary font-bold text-primary-foreground">
          T
        </div>
        <div>
          <div className="text-sm font-semibold leading-tight">TTP Suite</div>
          <div className="text-xs text-muted-foreground">Trust the Process</div>
        </div>
      </div>

      {/* families + items */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {NAV.map((family) => (
          <div key={family.id} className="mb-4">
            <div className="mb-1 flex items-center gap-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <family.icon className="h-3.5 w-3.5" />
              {family.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {family.items.map((item) => {
                const isActive = item.id === active;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelect(item.id)}
                    className={cn(
                      "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium outline-none transition-colors",
                      isActive
                        ? "text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="sidebar-active"
                        className="absolute inset-0 rounded-lg bg-primary"
                        transition={{ type: "spring", stiffness: 500, damping: 40 }}
                      />
                    )}
                    <item.icon className="relative z-10 h-4 w-4 shrink-0" />
                    <span className="relative z-10">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* theme toggle + logout */}
      <div className="flex flex-col gap-0.5 border-t border-border p-3">
        <button
          type="button"
          onClick={onToggleTheme}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          <span>{dark ? "Thème clair" : "Thème sombre"}</span>
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          <span>Déconnexion</span>
        </button>
      </div>
    </aside>
  );
}
