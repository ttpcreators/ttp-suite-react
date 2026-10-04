import { useSyncExternalStore } from "react";

/*
 * Affichage iPhone : sur un écran de téléphone (< 768 px), l'app prend la forme
 * d'une app iOS (barre d'onglets en bas, grands titres, écran « Plus », feuilles…).
 * C'est le SEUL affichage téléphone (l'ancien menu flottant a été retiré).
 * La classe `ios-ui` sur <html> porte les règles CSS (index.css), toutes limitées
 * aux petits écrans.
 */

/** À appeler une fois au démarrage (avant le premier rendu). */
export function initIosUi(): void {
  document.documentElement.classList.add("ios-ui");
  try {
    localStorage.removeItem("ttp:ios"); // ancien réglage « Mode iPhone (bêta) »
  } catch {
    /* stockage indisponible */
  }
}

const phoneMq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(max-width: 767px)") : null;

/** Écran de téléphone (moins de 768 px de large) ? Suit la rotation / le redimensionnement. */
export function isPhoneNow(): boolean {
  return !!phoneMq?.matches;
}

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
