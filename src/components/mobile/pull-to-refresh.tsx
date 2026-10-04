import { useEffect, useRef, useState, type RefObject } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { refreshNow } from "@/lib/useLive";

/*
 * « Tirer pour actualiser » (mode iPhone) : en haut d'une page, tirer vers le bas
 * fait apparaître une pastille qui tourne ; au-delà du seuil, toutes les vues
 * rechargent leurs données (même mécanisme que le rafraîchissement automatique).
 */
const THRESHOLD = 72;

export function PullToRefresh({ scrollRef }: { scrollRef: RefObject<HTMLElement | null> }) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let startY = 0;
    let active = false;
    let dist = 0;
    const onStart = (e: TouchEvent) => {
      if (busyRef.current || el.scrollTop > 0 || e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      active = true;
      dist = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || el.scrollTop > 0) {
        if (dist) setPull((dist = 0));
        return;
      }
      dist = Math.min(dy * 0.5, 120);
      setPull(dist);
    };
    const onEnd = () => {
      if (!active) return;
      active = false;
      if (dist >= THRESHOLD) {
        busyRef.current = true;
        setBusy(true);
        refreshNow();
        // Les vues rechargent en arrière-plan : la pastille tourne le temps de l'aller-retour.
        window.setTimeout(() => {
          busyRef.current = false;
          setBusy(false);
          setPull(0);
        }, 900);
      } else setPull(0);
      dist = 0;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [scrollRef]);

  if (!pull && !busy) return null;
  const ready = busy || pull >= THRESHOLD;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-[45] flex justify-center md:hidden"
      style={{ top: `calc(env(safe-area-inset-top) + 50px + ${busy ? 6 : Math.min(pull, THRESHOLD) * 0.35}px)` }}
    >
      <span
        className={cn("grid h-9 w-9 place-items-center rounded-full border border-border bg-surface text-muted-foreground shadow-md transition-opacity", ready ? "opacity-100" : "opacity-70")}
        style={{ transform: `scale(${busy ? 1 : 0.6 + Math.min(pull / THRESHOLD, 1) * 0.4})` }}
      >
        <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} style={busy ? undefined : { transform: `rotate(${pull * 4}deg)` }} />
        <span className="sr-only">{busy ? "Actualisation…" : ready ? "Relâcher pour actualiser" : "Tirer pour actualiser"}</span>
      </span>
    </div>
  );
}
