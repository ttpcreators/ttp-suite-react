import { lazy, Suspense } from "react";
import { FolderTabs, type FolderTabItem } from "@/components/ui/folder-tabs";
import { useVisitedTabs } from "@/lib/useVisitedTabs";
import { useNavSub, useSetNavSub } from "@/lib/navSub";
import { Roster } from "./Roster";
import { RosterTracking } from "./CreatorTracking";

const EngagementSuivi = lazy(() => import("./EngagementSuivi").then((m) => ({ default: m.EngagementSuivi })));
const Engagement = lazy(() => import("./Engagement").then((m) => ({ default: m.Engagement })));

// Refonte du menu (2026-10-30) : Évolution et Engagement, qui parlent des chiffres d'un
// créateur, deviennent des onglets du Roster. Leur id de page (« suivi », « engagement »)
// ouvre ici le bon onglet (src/lib/pageMerges.ts).
// L'onglet UGC est retiré à la demande de Marc (2026-10-20) ; la page Ugc.tsx reste dans le code.
type Tab = "liste" | "accompagnement" | "suivi" | "engagement";
const TABS: FolderTabItem[] = [
  { value: "liste", label: "Liste" },
  { value: "accompagnement", label: "Accompagnement" },
  { value: "suivi", label: "Évolution" },
  { value: "engagement", label: "Engagement" },
];
const isTab = (v: string | null): v is Tab => TABS.some((t) => t.value === v);

/**
 * Roster en onglets « dossier » (comme Agents). L'onglet suit la sous-page de la sidebar.
 * L'en-tête de la page (compte, « + Créateur ») reste au-dessus du cadre ; le bandeau de
 * chiffres reste dans l'onglet Liste, dont il résume la liste. Un onglet ouvert une fois reste
 * monté (masqué) : une saisie en cours n'est pas perdue en changeant d'onglet.
 */
export function RosterTabs({ onOpen }: { onOpen?: (name: string) => void }) {
  const navSub = useNavSub();
  const setNavSub = useSetNavSub();
  const tab: Tab = isTab(navSub) ? navSub : "liste";
  const visited = useVisitedTabs(tab);
  return (
    <FolderTabs label="Sections du roster" orderKey="roster" items={TABS} value={tab} onValueChange={setNavSub}>
      {/* Liste toujours montée : elle tient l'en-tête de la page (compte, « + Créateur »),
          visible sur tous les onglets ; « + Créateur » ramène sur la Liste. */}
      <div hidden={tab !== "liste"}>
        <Roster onOpen={onOpen} onShow={() => setNavSub("liste")} />
      </div>
      {visited.includes("accompagnement") && (
        <div hidden={tab !== "accompagnement"}>
          <RosterTracking onOpen={onOpen} />
        </div>
      )}
      <Suspense fallback={null}>
        {visited.includes("suivi") && (
          <div hidden={tab !== "suivi"}>
            <EngagementSuivi />
          </div>
        )}
        {visited.includes("engagement") && (
          <div hidden={tab !== "engagement"}>
            <Engagement />
          </div>
        )}
      </Suspense>
    </FolderTabs>
  );
}
