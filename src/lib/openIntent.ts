import { useEffect, useRef } from "react";

/**
 * Demande d'ouverture d'un formulaire dans une autre page : « + » d'Aujourd'hui,
 * « Nouvelle tâche » / « Nouvelle collab » de la palette ⌘K. On pose l'intention,
 * puis on navigue : la page la consomme à son montage, ou tout de suite si elle est
 * déjà montée (onglets gardés en vie). Une intention ne sert qu'une fois.
 */
export type OpenIntent = "todo:new" | "collab:new";

const EVENT = "ttp-intent";
let pending: OpenIntent | null = null;

export function requestIntent(intent: OpenIntent): void {
  pending = intent;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<OpenIntent>(EVENT, { detail: intent }));
}

/** Exécute `run` quand `intent` est demandée (au montage si elle attendait déjà). */
export function useIntent(intent: OpenIntent, run: () => void): void {
  const ref = useRef(run);
  ref.current = run;
  useEffect(() => {
    if (pending === intent) {
      pending = null;
      ref.current();
    }
    const on = (e: Event) => {
      if ((e as CustomEvent<OpenIntent>).detail !== intent || pending !== intent) return;
      pending = null;
      ref.current();
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [intent]);
}
