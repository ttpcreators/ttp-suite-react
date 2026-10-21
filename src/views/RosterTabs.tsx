import { useStickyState } from "@/lib/useStickyState";
import { FolderTabs, type FolderTabItem } from "@/components/ui/folder-tabs";
import { useVisitedTabs } from "@/lib/useVisitedTabs";
import { Roster } from "./Roster";
import { RosterTracking } from "./CreatorTracking";

// Engagement et Tarifs ont leur propre page dans le menu (Talents) : plus d'onglet en double ici.
// L'onglet UGC est retiré à la demande de Marc (2026-10-20) ; la page Ugc.tsx reste dans le code.
type Tab = "roster" | "suivi";
const TABS: FolderTabItem[] = [
  { value: "roster", label: "Liste" },
  { value: "suivi", label: "Accompagnement" },
];

/**
 * Roster en onglets « dossier » (comme Agents) : Liste et Accompagnement. L'en-tête de la
 * page (compte, « + Créateur ») reste au-dessus du cadre ; le bandeau de chiffres reste
 * dans l'onglet Liste, dont il résume la liste. Accompagnement, ouvert une fois, reste
 * monté (masqué) : une saisie en cours n'est pas perdue en changeant d'onglet.
 */
export function RosterTabs({ onOpen }: { onOpen?: (name: string) => void }) {
  const [tab, setTab] = useStickyState<Tab>("roster:section", ["roster", "suivi"], "roster");
  const visited = useVisitedTabs(tab);
  return (
    <FolderTabs label="Sections du roster" orderKey="roster" items={TABS} value={tab} onValueChange={(v) => setTab(v === "suivi" ? "suivi" : "roster")}>
      {/* Liste toujours montée : elle tient l'en-tête de la page (compte, « + Créateur »),
          visible sur les deux onglets ; « + Créateur » ramène sur la Liste. */}
      <div hidden={tab !== "roster"}>
        <Roster onOpen={onOpen} onShow={() => setTab("roster")} />
      </div>
      {visited.includes("suivi") && (
        <div hidden={tab !== "suivi"}>
          <RosterTracking onOpen={onOpen} />
        </div>
      )}
    </FolderTabs>
  );
}
