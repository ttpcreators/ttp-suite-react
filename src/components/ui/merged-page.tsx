import type { ComponentType } from "react";
import { FolderTabs } from "@/components/ui/folder-tabs";
import { Tabs } from "@/components/ui/animated-tabs";
import { useNavSub, useSetNavSub } from "@/lib/navSub";

export type MergedTab = { value: string; label: string; View: ComponentType };

/**
 * Page hôte qui regroupe plusieurs pages en onglets (refonte du menu) : Facturation + Relances,
 * Stats + Objectifs… L'onglet suit la sous-page de la sidebar (`useNavSub`), comme Contrats.
 * Chaque page garde son propre contenu et ses actions d'en-tête ; seul l'onglet actif est monté.
 *
 * `variant="pills"` : onglets simples au-dessus du contenu, pour une page qui occupe toute la
 * hauteur (Mails), où le cadre du classeur serait de trop.
 */
export function MergedPage({ tabs, label, orderKey, variant = "folder" }: {
  tabs: MergedTab[];
  label: string;
  orderKey: string;
  variant?: "folder" | "pills";
}) {
  const navSub = useNavSub();
  const setNavSub = useSetNavSub();
  const current = tabs.find((t) => t.value === navSub) ?? tabs[0];
  const items = tabs.map((t) => ({ value: t.value, label: t.label }));
  const View = current.View;

  if (variant === "pills") {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        <Tabs label={label} items={items} value={current.value} onValueChange={setNavSub} />
        <div className="min-h-0 flex-1">
          <View />
        </div>
      </div>
    );
  }
  return (
    <FolderTabs label={label} orderKey={orderKey} items={items} value={current.value} onValueChange={setNavSub}>
      <View />
    </FolderTabs>
  );
}
