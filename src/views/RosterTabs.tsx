import { useState } from "react";
import { Users, BarChart3, Tag } from "lucide-react";
import { Roster } from "./Roster";
import { Engagement } from "./Engagement";
import { Pricing } from "./Pricing";

type Tab = "roster" | "engagement" | "pricing";
const TABS = [
  { id: "roster", label: "Roster", icon: Users },
  { id: "engagement", label: "Engagement", icon: BarChart3 },
  { id: "pricing", label: "Pricing", icon: Tag },
] as const;

export function RosterTabs({ onOpen }: { onOpen?: (name: string) => void }) {
  const [tab, setTab] = useState<Tab>("roster");
  return (
    <div>
      <div className="mb-5 flex w-fit gap-1 rounded-xl bg-panel p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={
              "flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors " +
              (tab === t.id
                ? "bg-surface text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>
      {tab === "roster" && <Roster onOpen={onOpen} />}
      {tab === "engagement" && <Engagement />}
      {tab === "pricing" && <Pricing />}
    </div>
  );
}
