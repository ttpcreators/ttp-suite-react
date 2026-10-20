import { useRef, type PointerEvent } from "react";

/**
 * Survol « vrai » : seulement une souris ou un stylet qui survole. Un doigt envoie aussi
 * des entrées / sorties de pointeur, qu'il faut ignorer (sinon un tap déplie puis replie).
 * enter / leave renvoient true quand l'évènement compte comme un survol.
 */
export function useHoverGesture() {
  const inside = useRef(false);
  return {
    enter(e: PointerEvent<Element>): boolean {
      if (e.pointerType === "touch") return false;
      inside.current = true;
      return true;
    },
    leave(e: PointerEvent<Element>): boolean {
      if (e.pointerType === "touch" || !inside.current) return false;
      inside.current = false;
      return true;
    },
  };
}
