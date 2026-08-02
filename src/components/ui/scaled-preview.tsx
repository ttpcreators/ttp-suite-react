import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Aperçu d'une page conçue pour ORDINATEUR (ex : media kit paysage 16:9) affiché sur
 * petit écran SANS être écrasé : on rend l'iframe à sa largeur « desktop » puis on la
 * met à l'échelle pour remplir le conteneur (transform: scale). Résultat = même rendu
 * paysage que sur ordinateur, en réduit, et la page reste scrollable à l'intérieur.
 */
export function ScaledPreview({
  src,
  title,
  designWidth = 1180,
  className,
  height = "70vh",
}: {
  src: string;
  title: string;
  /** Largeur de rendu « ordinateur » (px) mise à l'échelle vers la largeur réelle. */
  designWidth?: number;
  className?: string;
  height?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setDim({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = dim.w ? dim.w / designWidth : 0;
  return (
    <div ref={ref} className={cn("relative w-full overflow-hidden bg-white", className)} style={{ height }}>
      {scale > 0 && (
        <iframe
          title={title}
          src={src}
          style={{ width: designWidth, height: dim.h / scale, transform: `scale(${scale})`, transformOrigin: "top left", border: 0 }}
        />
      )}
    </div>
  );
}
