import { useEffect, useState } from "react";
import { getAppState, invalidateAppState, mergeAppStateKey, useAppState } from "./appState";
import { FOLDER_FRAMES_KEY, FOLDER_TONES_KEY, sanitizeFrameMap, sanitizeToneMap, withTabTone, type FolderTone, type FolderToneMap, type FrameMap } from "./folderTabs";

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

// ── Couleur du cadre (folderFrameColors) : même mécanique que les teintes d'onglets ──
const frameListeners = new Set<(m: FrameMap) => void>();
const announceFrames = (m: FrameMap) => frameListeners.forEach((fn) => fn(m));

export function useFolderFrames(): FrameMap {
  const { data } = useAppState<FrameMap>((s) => sanitizeFrameMap(s[FOLDER_FRAMES_KEY]));
  const [local, setLocal] = useState<{ base: FrameMap | null; map: FrameMap } | null>(null);
  useEffect(() => {
    const fn = (map: FrameMap) => setLocal({ base: data, map });
    frameListeners.add(fn);
    return () => {
      frameListeners.delete(fn);
    };
  }, [data]);
  return local && local.base === data ? local.map : (data ?? {});
}

/** Couleur du cadre d'une page (ou « * » = tous les classeurs) ; `null` = d'origine. */
export async function saveFrameColor(page: string, color: string | null): Promise<boolean> {
  try {
    invalidateAppState();
    const fresh = sanitizeFrameMap((await getAppState())[FOLDER_FRAMES_KEY]);
    const next: FrameMap = { ...fresh };
    if (color) next[page] = color.toLowerCase();
    else delete next[page];
    announceFrames(next);
    const ok = color ? await mergeAppStateKey(FOLDER_FRAMES_KEY, { [page]: color.toLowerCase() }) : await mergeAppStateKey(FOLDER_FRAMES_KEY, {}, [page]);
    if (!ok) announceFrames(fresh);
    return ok;
  } catch {
    return false;
  }
}
