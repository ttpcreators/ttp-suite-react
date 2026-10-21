import { useMemo, useState, type ReactNode } from "react";
import { MorphingTabs } from "@/components/ui/morphing-tabs";
import { Tabs } from "@/components/ui/animated-tabs";
import { useIsPhone } from "@/lib/iosUi";
import { TONE_VAR, pageDefaultTones, parseTabOrder, resolveTabTones, sortByOrder, tabLabel, type FolderTone } from "@/lib/folderTabs";
import { useFolderTones } from "@/lib/useFolderTones";

export type FolderTabItem = {
  value: string;
  label: string;
  count?: number;
  /** Libellé court sur téléphone (sinon `label`). */
  short?: string;
  /** Couleur d'intercalaire par défaut (sinon celle de FOLDER_PAGES, sinon automatique). */
  tone?: FolderTone;
};

/**
 * Onglets « dossier » de la page Agents, pour d'autres pages : sur ordinateur (≥ 768 px),
 * cadre sombre et onglet actif fondu dans le panneau clair (`MorphingTabs`), onglets
 * réordonnables au glisser, ordre gardé sur l'appareil (`ttp:<orderKey>-tab-order`) ;
 * sur téléphone, onglets simples au-dessus du contenu (comme Agents).
 *
 * Code couleur : chaque onglet a sa teinte (pastille avant le libellé, filet en haut de
 * l'onglet actif). Choix de l'équipe dans Paramètres (`folderTabTones`, page = `orderKey`)
 * > `tone` de l'onglet ou défaut de FOLDER_PAGES > automatique, stable par id d'onglet.
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

  const custom = useFolderTones()[orderKey];
  const tones = useMemo(() => {
    const defaults: Record<string, FolderTone> = pageDefaultTones(orderKey);
    for (const it of items) if (it.tone) defaults[it.value] = it.tone;
    return resolveTabTones(
      items.map((it) => it.value),
      defaults,
      custom,
    );
  }, [items, orderKey, custom]);
  const toneOf = (v: string) => (tones[v] ? TONE_VAR[tones[v]] : undefined);

  if (phone) {
    if (!phoneTabs) return <>{children}</>;
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <Tabs
          label={label}
          value={value}
          onValueChange={onValueChange}
          items={items.map((it) => ({ value: it.value, label: it.short ?? it.label, count: it.count, dotColor: toneOf(it.value) }))}
        />
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
      items={sortByOrder(items, order).map((it) => ({ id: it.value, label: tabLabel(it.label, it.count), tone: toneOf(it.value) }))}
      // `overflow-clip` (au lieu de hidden) : mêmes coins arrondis, mais un aperçu
      // `sticky` du contenu reste collé en défilant. Panneau au-dessus du rail : une
      // fenêtre `fixed` ouverte depuis le contenu passe devant les onglets.
      classNames={{ root: "overflow-clip", content: "z-40 overflow-clip" }}
      panel={<div className="min-w-0 p-4 sm:p-5">{children}</div>}
    />
  );
}
