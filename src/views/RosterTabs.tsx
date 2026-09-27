import { useState } from "react";
import { Users, BarChart3, Tag, Clapperboard, Radar } from "lucide-react";
import { Roster } from "./Roster";
import { Engagement } from "./Engagement";
import { Pricing } from "./Pricing";
import { Ugc } from "./Ugc";
import { RosterTracking } from "./CreatorTracking";
import { Tabs, type TabItem } from "@/components/ui/animated-tabs";

type Tab = "roster" | "suivi" | "ugc" | "engagement" | "pricing";
const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: "roster", label: "Roster", icon: Users },
  { id: "suivi", label: "Suivi", icon: Radar },
  { id: "ugc", label: "UGC", icon: Clapperboard },
  { id: "engagement", label: "Engagement", icon: BarChart3 },
  { id: "pricing", label: "Pricing", icon: Tag },
];
const ITEMS: TabItem[] = TABS.map((t) => ({ value: t.id, label: t.label, icon: <t.icon className="h-4 w-4" /> }));

export function RosterTabs({ onOpen }: { onOpen?: (name: string) => void }) {
  const [tab, setTab] = useState<Tab>("roster");
  return (
    <div>
      <Tabs className="mb-5" items={ITEMS} value={tab} onValueChange={(v) => setTab(v as Tab)} label="Sections créateurs" />
      {tab === "roster" && <Roster onOpen={onOpen} />}
      {tab === "suivi" && <RosterTracking onOpen={onOpen} />}
      {tab === "ugc" && <Ugc />}
      {tab === "engagement" && <Engagement />}
      {tab === "pricing" && <Pricing />}
    </div>
  );
}
