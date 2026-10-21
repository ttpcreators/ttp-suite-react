import { useEffect, useState } from "react";
import { getAppState, invalidateAppState, mergeAppStateKey, useAppState } from "./appState";
import { FOLDER_TONES_KEY, sanitizeToneMap, withTabTone, type FolderTone, type FolderToneMap } from "./folderTabs";

/*
 * Couleurs des classeurs choisies par l'équipe (Paramètres → Apparence), rangées dans le
 * blob agence sous `folderTabTones` = { [page]: { [onglet]: teinte } }. Lecture partagée
 * par toutes les barres d'onglets « dossier » ; après un choix, les barres déjà montées
 * se mettent à jour tout de suite (sans attendre le tick live).
 */
const listeners = new Set<(m: FolderToneMap) => void>();
const announce = (m: FolderToneMap) => listeners.forEach((fn) => fn(m));

export function useFolderTones(): FolderToneMap {
  const { data } = useAppState<FolderToneMap>((s) => sanitizeToneMap(s[FOLDER_TONES_KEY]));
  // Choix annoncé localement, valable tant que la donnée partagée n'a pas changé depuis
  // (écriture relue au tick suivant, ou choix d'un collègue).
  const [local, setLocal] = useState<{ base: FolderToneMap | null; map: FolderToneMap } | null>(null);
  useEffect(() => {
    const fn = (map: FolderToneMap) => setLocal({ base: data, map });
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, [data]);
  return local && local.base === data ? local.map : (data ?? {});
}

/** Relit le réglage frais (ne pas écraser le choix d'un collègue). */
async function freshMap(): Promise<FolderToneMap> {
  invalidateAppState();
  return sanitizeToneMap((await getAppState())[FOLDER_TONES_KEY]);
}

/** Choisit la teinte d'un onglet (`null` = Automatique). Écrit seulement la page touchée. */
export async function saveTabTone(page: string, tab: string, tone: FolderTone | null): Promise<boolean> {
  try {
    const fresh = await freshMap();
    const pageTones = withTabTone(fresh[page], tab, tone);
    const empty = Object.keys(pageTones).length === 0;
    const next: FolderToneMap = { ...fresh };
    if (empty) delete next[page];
    else next[page] = pageTones;
    announce(next);
    const ok = empty ? await mergeAppStateKey(FOLDER_TONES_KEY, {}, [page]) : await mergeAppStateKey(FOLDER_TONES_KEY, { [page]: pageTones });
    if (!ok) announce(fresh);
    return ok;
  } catch {
    return false;
  }
}

/** « Revenir aux couleurs d'origine » d'une page. */
export async function resetPageTones(page: string): Promise<boolean> {
  try {
    const fresh = await freshMap();
    const next: FolderToneMap = { ...fresh };
    delete next[page];
    announce(next);
    const ok = await mergeAppStateKey(FOLDER_TONES_KEY, {}, [page]);
    if (!ok) announce(fresh);
    return ok;
  } catch {
    return false;
  }
}
