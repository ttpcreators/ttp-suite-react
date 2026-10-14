import { useState } from "react";
import { Users, Clapperboard, Radar } from "lucide-react";
import { Roster } from "./Roster";
import { Ugc } from "./Ugc";
import { RosterTracking } from "./CreatorTracking";
import { Tabs, type TabItem } from "@/components/ui/animated-tabs";

// Engagement et Tarifs ont leur propre page dans le menu (Créateurs) : plus d'onglet en double ici.
type Tab = "roster" | "suivi" | "ugc";
const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: "roster", label: "Liste", icon: Users },
  { id: "suivi", label: "Accompagnement", icon: Radar },
  { id: "ugc", label: "UGC", icon: Clapperboard },
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
    </div>
  );
}
