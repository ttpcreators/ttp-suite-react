/**
 * Logique pure des onglets (façon navigateur), extraite d'App pour être testée.
 * Aucune dépendance React/DOM → couverte par Vitest (cf. tabs.test.ts).
 */

/**
 * Restaure la liste d'onglets depuis le texte localStorage, VALIDÉE.
 * Toute entrée invalide (id inconnu, non-string, JSON cassé, tableau vide) est
 * écartée → on retombe sur `[active]`. C'est ce filtrage qui empêche un état
 * sauvegardé corrompu de casser le rendu au rechargement.
 */
export function restoreTabs(raw: string | null, active: string, isValid: (id: string) => boolean): string[] {
  try {
    const saved = JSON.parse(raw || "null");
    if (Array.isArray(saved)) {
      const valid = saved.filter((id): id is string => typeof id === "string" && isValid(id));
      if (valid.length) return Array.from(new Set(valid));
    }
  } catch {
    /* JSON illisible → défaut */
  }
  return [active];
}

/**
 * Navigue l'onglet COURANT vers `id` (comme un clic de lien dans Chrome) :
 * remplace la page de l'onglet actif, ou bascule dessus s'il est déjà ouvert.
 */
export function navigateTab(tabs: string[], current: string, id: string): string[] {
  if (tabs.includes(id)) return tabs;
  const i = tabs.indexOf(current);
  if (i === -1) return [...tabs, id];
  const copy = [...tabs];
  copy[i] = id;
  return copy;
}

/** Ajoute un onglet (ou no-op s'il est déjà ouvert). */
export function addTab(tabs: string[], id: string): string[] {
  return tabs.includes(id) ? tabs : [...tabs, id];
}

/**
 * Ferme un onglet → nouvelle liste + nouvel onglet actif (voisin si on ferme
 * l'actif). Ne laisse jamais 0 onglet : retombe sur "apercu".
 */
export function closeTab(tabs: string[], active: string, id: string): { tabs: string[]; active: string } {
  const idx = tabs.indexOf(id);
  const next = tabs.filter((t) => t !== id);
  if (next.length === 0) return { tabs: ["apercu"], active: "apercu" };
  const nextActive = id === active ? next[Math.min(idx, next.length - 1)] : active;
  return { tabs: next, active: nextActive };
}
