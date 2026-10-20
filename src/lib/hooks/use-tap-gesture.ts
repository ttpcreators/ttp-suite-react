import { useCallback, useRef, type PointerEvent } from "react";

/**
 * Mémorise le geste qui a commencé un clic (type de pointeur + un état noté au début),
 * pour que le clic sache s'il vient d'un doigt et dans quel état était l'interface.
 * take() le rend une seule fois ; un clic clavier n'en a pas (null).
 */
export function useTapGesture<T>() {
  const g = useRef<{ pointerType: string; state: T } | null>(null);
  const start = useCallback((e: PointerEvent<Element>, state: T) => {
    g.current = { pointerType: e.pointerType, state };
  }, []);
  const take = useCallback(() => {
    const v = g.current;
    g.current = null;
    return v;
  }, []);
  const drop = useCallback(() => {
    g.current = null;
  }, []);
  return { start, take, drop };
}
