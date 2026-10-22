import { useEffect, useRef, type RefObject } from "react";

/**
 * Retour par glissement depuis le bord gauche (comme iOS) : un doigt posé à moins de
 * 24 px du bord, puis tiré vers la droite (80 px au moins, sans trop monter ni descendre),
 * déclenche `onBack`. Sans `onBack` (écran racine), rien ne se passe.
 */
export function useEdgeSwipeBack(ref: RefObject<HTMLElement | null>, onBack: (() => void) | null, enabled = true) {
  const cb = useRef(onBack);
  useEffect(() => {
    cb.current = onBack;
  }, [onBack]);
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let start: { x: number; y: number } | null = null;
    const down = (e: TouchEvent) => {
      const p = e.touches[0];
      start = p && p.clientX <= 24 && cb.current ? { x: p.clientX, y: p.clientY } : null;
    };
    const up = (e: TouchEvent) => {
      const p = e.changedTouches[0];
      if (!start || !p) return;
      const dx = p.clientX - start.x;
      const dy = Math.abs(p.clientY - start.y);
      start = null;
      if (dx > 80 && dy < 60) {
        if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(8);
        cb.current?.();
      }
    };
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchend", up, { passive: true });
    return () => {
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchend", up);
    };
  }, [ref, enabled]);
}
