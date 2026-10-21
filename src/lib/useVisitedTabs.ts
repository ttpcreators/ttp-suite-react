import { useState } from "react";
import { withVisited } from "./folderTabs";

/**
 * Onglets ouverts au moins une fois : la page les garde montés (masqués) pour ne rien
 * perdre d'une saisie, sans charger d'avance ceux qu'on n'a jamais ouverts.
 */
export function useVisitedTabs<T extends string>(current: T): readonly T[] {
  const [visited, setVisited] = useState<readonly T[]>([current]);
  const next = withVisited(visited, current);
  if (next !== visited) setVisited(next);
  return next;
}
