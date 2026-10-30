import { useEffect, useRef, useState } from "react";

/**
 * Fondu sur le bord d'une rangée qui défile (pastilles, onglets) : on voit qu'il y a une
 * suite, sans élément coupé net. Recalculé au défilement et au redimensionnement.
 */
export function useEdgeFade<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [fade, setFade] = useState<"none" | "end" | "start" | "both">("none");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const start = el.scrollLeft > 4;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
      setFade(start && end ? "both" : start ? "start" : end ? "end" : "none");
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);
  const mask = {
    none: undefined,
    end: "linear-gradient(to right, #000 calc(100% - 28px), transparent)",
    start: "linear-gradient(to left, #000 calc(100% - 28px), transparent)",
    both: "linear-gradient(to right, transparent, #000 28px, #000 calc(100% - 28px), transparent)",
  }[fade];
  return { ref, style: mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined };
}
