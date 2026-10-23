import { useEffect, useRef } from "react";

/**
 * Demande d'ouverture d'un formulaire ou d'une fiche dans une autre page : « + »
 * d'Aujourd'hui, « Nouvelle tâche » / « Nouvelle collab » de la palette ⌘K, « Ouvrir »
 * d'une collab bloquée, fil de mail d'une notification (« mail:open », données
 * `{"thread","box"}` en JSON). On pose l'intention (avec, au besoin, l'id visé), puis on
 * navigue : la page la consomme à son montage, ou tout de suite si elle est déjà montée
 * (onglets gardés en vie). Une intention ne sert qu'une fois.
 */
export type OpenIntent = "todo:new" | "todo:open" | "cs-todo:open" | "collab:new" | "collab:open" | "collab:recap" | "mail:open";

const EVENT = "ttp-intent";
let pending: OpenIntent | null = null;
let pendingData: string | undefined;

export function requestIntent(intent: OpenIntent, data?: string): void {
  pending = intent;
  pendingData = data;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<OpenIntent>(EVENT, { detail: intent }));
}

/** Exécute `run` (avec l'id éventuel) quand `intent` est demandée (au montage si elle attendait déjà). */
export function useIntent(intent: OpenIntent, run: (data?: string) => void): void {
  const ref = useRef(run);
  ref.current = run;
  useEffect(() => {
    const consume = () => {
      const data = pendingData;
      pending = null;
      pendingData = undefined;
      ref.current(data);
    };
    if (pending === intent) consume();
    const on = (e: Event) => {
      if ((e as CustomEvent<OpenIntent>).detail !== intent || pending !== intent) return;
      consume();
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [intent]);
}
