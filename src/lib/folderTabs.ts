/*
 * Onglets « dossier » (cadre sombre, onglet actif fondu dans le panneau clair, comme la
 * page Agents) : logique PURE partagée par les pages qui les utilisent (fiche créateur,
 * Contrats, Media kit, Paramètres). Testable sous Node ; l'affichage vit dans
 * src/components/ui/folder-tabs.tsx.
 */

/** Libellé d'un onglet avec son compteur : « Agents · 2 ». Zéro ou absent = libellé seul. */
export function tabLabel(label: string, count?: number | null): string {
  return count ? `${label} · ${count}` : label;
}

/** Range les onglets dans l'ordre enregistré ; les inconnus (nouveaux onglets) gardent leur place à la fin. */
export function sortByOrder<T extends { value: string }>(items: readonly T[], order: readonly string[]): T[] {
  const pos = (v: string) => {
    const k = order.indexOf(v);
    return k < 0 ? order.length + items.findIndex((x) => x.value === v) : k;
  };
  return [...items].sort((a, b) => pos(a.value) - pos(b.value));
}

/** Ordre gardé sur l'appareil (JSON d'une liste d'ids) ; illisible ou absent = liste vide. */
export function parseTabOrder(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** Sous-page de nav (sidebar) → onglet de la page ; inconnue ou absente = `fallback`. */
export function tabFromSub<T extends string>(sub: string | null | undefined, allowed: readonly T[], fallback: T): T {
  return sub != null && (allowed as readonly string[]).includes(sub) ? (sub as T) : fallback;
}

/*
 * Contrats : « Tous » = la page d'arrivée (sous-page nulle), puis un onglet par
 * générateur, mêmes ids que les sous-pages de la sidebar (Marque × Créateur,
 * Représentation, Contrat UGC).
 */
export const CONTRATS_TABS = ["tous", "marque", "repr", "ugc"] as const;
export type ContratsTab = (typeof CONTRATS_TABS)[number];

export const contratsTabFromSub = (sub: string | null | undefined): ContratsTab => tabFromSub(sub, CONTRATS_TABS, "tous");
export const contratsSubFromTab = (tab: ContratsTab): string | null => (tab === "tous" ? null : tab);
