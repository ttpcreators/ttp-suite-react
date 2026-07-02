/**
 * Cache mémoire (par vue) pour éviter le flash « Chargement… » au changement de
 * page. À la 1ʳᵉ visite, la vue charge normalement puis stocke le résultat ici.
 * Aux visites suivantes, les données s'affichent INSTANTANÉMENT (plus d'état
 * vide/loading qui clignote), pendant que la vue re-fetch en arrière-plan
 * (voir `useLive` pour la resynchro multi-appareils).
 *
 * Volontairement simple + en mémoire (perdu au reload complet, ce qui est le
 * comportement voulu : on veut des données fraîches au vrai démarrage).
 */
const store = new Map<string, unknown>();

export function getCache<T>(key: string): T | null {
  return store.has(key) ? (store.get(key) as T) : null;
}

export function setCache<T>(key: string, value: T): void {
  store.set(key, value);
}
