import { useStickyState } from "@/lib/useStickyState";
import { Users, Radar } from "lucide-react";
import { Roster } from "./Roster";
import { RosterTracking } from "./CreatorTracking";
import { MotionTabs, MotionTabsList, MotionTabsTrigger } from "@/components/ui/motion-tabs";

// Engagement et Tarifs ont leur propre page dans le menu (Talents) : plus d'onglet en double ici.
// L'onglet UGC est retiré à la demande de Marc (2026-10-20) ; la page Ugc.tsx reste dans le code.
type Tab = "roster" | "suivi";
const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: "roster", label: "Liste", icon: Users },
  { id: "suivi", label: "Accompagnement", icon: Radar },
];

export function RosterTabs({ onOpen }: { onOpen?: (name: string) => void }) {
  const [tab, setTab] = useStickyState<Tab>("roster:section", ["roster", "suivi"], "roster");
  return (
    <div>
      {/* Onglets animés : la pastille glisse, le texte change de couleur à son passage,
          l'icône ne s'ouvre que sur la section choisie. */}
      <MotionTabs value={tab} onValueChange={(v) => setTab(v as Tab)} icons="selected" className="mb-5">
        <MotionTabsList aria-label="Sections créateurs" wrapperClassName="w-fit" className="border border-border bg-surface">
          {TABS.map((t) => (
            <MotionTabsTrigger
              key={t.id}
              value={t.id}
              icon={<t.icon className="h-4 w-4" />}
              indicatorClassName="bg-foreground"
              activeLabelClassName="text-background"
              className="h-9 text-[14px]"
            >
              {t.label}
            </MotionTabsTrigger>
          ))}
        </MotionTabsList>
      </MotionTabs>
      {tab === "roster" && <Roster onOpen={onOpen} />}
      {tab === "suivi" && <RosterTracking onOpen={onOpen} />}
    </div>
  );
}
