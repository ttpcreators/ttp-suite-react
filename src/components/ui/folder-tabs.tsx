import { useState, type ReactNode } from "react";
import { MorphingTabs } from "@/components/ui/morphing-tabs";
import { Tabs } from "@/components/ui/animated-tabs";
import { useIsPhone } from "@/lib/iosUi";
import { parseTabOrder, sortByOrder, tabLabel } from "@/lib/folderTabs";

export type FolderTabItem = { value: string; label: string; count?: number };

/**
 * Onglets « dossier » de la page Agents, pour d'autres pages : sur ordinateur (≥ 768 px),
 * cadre sombre et onglet actif fondu dans le panneau clair (`MorphingTabs`), onglets
 * réordonnables au glisser, ordre gardé sur l'appareil (`ttp:<orderKey>-tab-order`) ;
 * sur téléphone, onglets simples au-dessus du contenu (comme Agents).
 *
 * `children` = le contenu de l'onglet actif, monté une seule fois (pas remonté au
 * changement d'onglet). `phoneTabs={false}` : sur téléphone la page affiche son propre
 * sélecteur, seul `children` est rendu.
 */
export function FolderTabs({
  items,
  value,
  onValueChange,
  label,
  orderKey,
  maxTabWidth,
  phoneTabs = true,
  children,
}: {
  items: FolderTabItem[];
  value: string;
  onValueChange: (value: string) => void;
  /** Nom accessible de la barre d'onglets (ex. « Sous-pages Contrats »). */
  label: string;
  orderKey: string;
  maxTabWidth?: number;
  phoneTabs?: boolean;
  children: ReactNode;
}) {
  const phone = useIsPhone();
  const storageKey = `ttp:${orderKey}-tab-order`;
  const [order, setOrder] = useState<string[]>(() => {
    try {
      return parseTabOrder(localStorage.getItem(storageKey));
    } catch {
      return [];
    }
  });
  const saveOrder = (ids: string[]) => {
    setOrder(ids);
    try {
      localStorage.setItem(storageKey, JSON.stringify(ids));
    } catch {
      /* stockage bloqué : l'ordre vaut pour cette visite */
    }
  };

  if (phone) {
    if (!phoneTabs) return <>{children}</>;
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <Tabs label={label} value={value} onValueChange={onValueChange} items={items} />
        {children}
      </div>
    );
  }

  return (
    <MorphingTabs
      ariaLabel={label}
      value={value}
      onValueChange={(v) => v && onValueChange(v)}
      onOrderChange={saveOrder}
      maxTabWidth={maxTabWidth}
      items={sortByOrder(items, order).map((it) => ({ id: it.value, label: tabLabel(it.label, it.count) }))}
      // `overflow-clip` (au lieu de hidden) : mêmes coins arrondis, mais un aperçu
      // `sticky` du contenu reste collé en défilant. Panneau au-dessus du rail : une
      // fenêtre `fixed` ouverte depuis le contenu passe devant les onglets.
      classNames={{ root: "overflow-clip", content: "z-40 overflow-clip" }}
      panel={<div className="min-w-0 p-4 sm:p-5">{children}</div>}
    />
  );
}
