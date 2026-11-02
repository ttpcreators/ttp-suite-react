import { useEffect, useState } from "react";

/**
 * État « lue » / « archivée » des notifications, propre à cet appareil (chacun lit
 * à son rythme). L'effacement définitif, lui, reste partagé par toute l'équipe
 * (useNotifications → notifDismissed). Listes bornées pour ne pas grossir sans fin.
 * Chaque écriture prévient les autres cloches de l'écran et la pastille de l'icône.
 */
const READ_KEY = "ttp:ui:notif-lues";
const ARCH_KEY = "ttp:ui:notif-archivees";
const CHANGE = "ttp:notif-local";
const MAX = 400;

export function readIds(key: "read" | "archived"): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(key === "read" ? READ_KEY : ARCH_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/** Ajoute ou retire des ids ; garde les plus récents si la liste déborde. */
export function toggleIds(set: Set<string>, ids: string[], on: boolean): Set<string> {
  const next = new Set(set);
  for (const id of ids) {
    if (on) {
      next.delete(id);
      next.add(id);
    } else next.delete(id);
  }
  if (next.size <= MAX) return next;
  return new Set([...next].slice(next.size - MAX));
}

export function writeIds(key: "read" | "archived", set: Set<string>): void {
  try {
    localStorage.setItem(key === "read" ? READ_KEY : ARCH_KEY, JSON.stringify([...set]));
  } catch {
    /* stockage indisponible : l'état vaut pour la session */
  }
  try {
    window.dispatchEvent(new Event(CHANGE));
  } catch {
    /* hors navigateur */
  }
}

/** Notifications à lire : ni lues ni archivées sur cet appareil (chiffre de la cloche et de l'icône). */
export function unreadCount(ids: string[], read: Set<string>, archived: Set<string>): number {
  return ids.filter((id) => !read.has(id) && !archived.has(id)).length;
}

/** Lues / archivées, tenues à jour quand une autre cloche (ou un autre onglet) les change. */
export function useNotifLocal(): { read: Set<string>; archived: Set<string> } {
  const [state, setState] = useState(() => ({ read: readIds("read"), archived: readIds("archived") }));
  useEffect(() => {
    const sync = () => setState({ read: readIds("read"), archived: readIds("archived") });
    const onStorage = (e: StorageEvent) => {
      if (e.key === READ_KEY || e.key === ARCH_KEY) sync();
    };
    window.addEventListener(CHANGE, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGE, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return state;
}

/** Initiales de la personne au début d'un titre d'équipe (« Gianni a terminé… » → « G »). */
export function actorInitials(title: string): string {
  const first = title.trim().split(/\s+/)[0] ?? "";
  return /^[A-ZÀ-ÖØ-Þ]/.test(first) ? first[0] : "";
}
