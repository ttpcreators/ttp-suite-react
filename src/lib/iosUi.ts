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
  // Clavier ouvert (un champ a le focus) : classe `kb-open`, qui cache la barre d'onglets
  // du bas. Sinon, sur iPhone, elle remonte au-dessus du clavier et masque le champ.
  const sync = () => document.documentElement.classList.toggle("kb-open", isTextEntry(document.activeElement));
  document.addEventListener("focusin", sync);
  // Au départ d'un champ, le focus passe parfois par <body> : on regarde au tour suivant.
  document.addEventListener("focusout", () => window.setTimeout(sync, 0));
}

const NO_KEYBOARD = new Set(["checkbox", "radio", "range", "button", "submit", "reset", "file", "color", "image", "hidden"]);

/** Ce champ ouvre-t-il le clavier (ou la roue de choix) de l'iPhone ? */
export function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NO_KEYBOARD.has(((el as HTMLInputElement).type || "text").toLowerCase());
  return (el as HTMLElement).isContentEditable === true;
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
