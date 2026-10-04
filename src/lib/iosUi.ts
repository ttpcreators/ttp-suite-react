import { useSyncExternalStore } from "react";

/*
 * « Mode iPhone » : coque façon app iOS sur téléphone (barre d'onglets en bas,
 * barre de titre qui se replie, écran « Plus », pleine largeur…).
 * Réglage PROPRE À CET APPAREIL, en bêta : on l'active d'abord sur son téléphone
 * (Paramètres → Apparence, ou un lien `?ios=1`), puis pour tout le monde.
 * La classe `ios-ui` sur <html> porte les règles CSS (index.css).
 */

const KEY = "ttp:ios";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let current = false;

/** À appeler une fois au démarrage (avant le premier rendu) : lit `?ios=1|0` puis le réglage. */
export function initIosUi(): void {
  try {
    const q = new URLSearchParams(location.search).get("ios");
    if (q === "1" || q === "0") localStorage.setItem(KEY, q);
  } catch {
    /* stockage indisponible */
  }
  current = read();
  document.documentElement.classList.toggle("ios-ui", current);
}

export function getIosUi(): boolean {
  return current;
}

export function setIosUi(on: boolean): void {
  current = on;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* stockage indisponible : le choix vaut pour la session */
  }
  document.documentElement.classList.toggle("ios-ui", on);
  for (const l of listeners) l();
}

/** Le mode iPhone est-il actif sur cet appareil ? (se met à jour quand on le change) */
export function useIosUi(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => current,
    () => false,
  );
}

const phoneMq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(max-width: 767px)") : null;
/** Écran de téléphone (moins de 768 px de large) ? Suit la rotation / le redimensionnement. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    (fn) => {
      phoneMq?.addEventListener("change", fn);
      return () => phoneMq?.removeEventListener("change", fn);
    },
    () => !!phoneMq?.matches,
    () => false,
  );
}
