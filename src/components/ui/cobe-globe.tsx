import { useEffect, useRef, useCallback } from "react";
import createGlobe from "cobe";
import { cn } from "@/lib/utils";

export interface GlobeMarker {
  location: [number, number];
  size?: number;
}

/**
 * Globe 3D interactif (cobe / WebGL). Rotation auto + drag à la souris.
 * Les marqueurs sont dessinés sur le canvas (fiable). Couleurs en [r,g,b] 0→1.
 */
export function Globe({
  markers = [],
  className,
  markerColor = [0.17, 0.5, 1],
  baseColor = [0.9, 0.91, 0.94],
  glowColor = [0.9, 0.92, 0.96],
  dark = 0,
  markerSize = 0.045,
}: {
  markers?: GlobeMarker[];
  className?: string;
  markerColor?: [number, number, number];
  baseColor?: [number, number, number];
  glowColor?: [number, number, number];
  dark?: number;
  markerSize?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef<number | null>(null);
  const lastX = useRef(0);
  const phiOffset = useRef(0);

  const onDown = useCallback((e: React.PointerEvent) => {
    dragging.current = e.clientX;
    lastX.current = e.clientX;
    if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (dragging.current !== null) {
        phiOffset.current += (e.clientX - lastX.current) / 200;
        lastX.current = e.clientX;
      }
    };
    const up = () => {
      dragging.current = null;
      if (canvasRef.current) canvasRef.current.style.cursor = "grab";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Rendu léger sur mobile : le globe s'affiche en ≤200px, inutile de payer
    // le coût GPU/CPU d'un échantillonnage et d'un DPR pensés pour desktop.
    const isMobile = window.matchMedia("(max-width: 768px)").matches;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let globe: ReturnType<typeof createGlobe> | null = null;
    let raf = 0;
    let phi = 0;
    let running = !document.hidden;

    const init = () => {
      const width = canvas.offsetWidth;
      if (width === 0 || globe) return;
      globe = createGlobe(canvas, {
        devicePixelRatio: Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2),
        width: width * 2,
        height: width * 2,
        phi: 0,
        theta: 0.25,
        dark,
        diffuse: 1.4,
        mapSamples: isMobile ? 6000 : 16000,
        mapBrightness: dark ? 6 : 9,
        baseColor,
        markerColor,
        glowColor,
        opacity: 0.92,
        markers: markers.map((m) => ({ location: m.location, size: m.size ?? markerSize })),
      });
      const animate = () => {
        if (running) {
          if (dragging.current === null && !reducedMotion) phi += 0.004;
          globe!.update({ phi: phi + phiOffset.current, theta: 0.25 });
        }
        raf = requestAnimationFrame(animate);
      };
      animate();
      requestAnimationFrame(() => {
        if (canvas) canvas.style.opacity = "1";
      });
    };

    // En arrière-plan (onglet caché / app minimisée), on arrête de recalculer
    // le globe : évite de cramer batterie/CPU pour un rendu invisible.
    const onVisibility = () => {
      running = !document.hidden;
    };
    document.addEventListener("visibilitychange", onVisibility);

    if (canvas.offsetWidth > 0) {
      init();
    } else {
      const ro = new ResizeObserver((entries) => {
        if ((entries[0]?.contentRect.width ?? 0) > 0) {
          ro.disconnect();
          init();
        }
      });
      ro.observe(canvas);
      return () => {
        ro.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
        if (raf) cancelAnimationFrame(raf);
        globe?.destroy();
      };
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (raf) cancelAnimationFrame(raf);
      globe?.destroy();
    };
  }, [markers, markerColor, baseColor, glowColor, dark, markerSize]);

  return (
    <div className={cn("relative aspect-square", className)}>
      <canvas
        ref={canvasRef}
        onPointerDown={onDown}
        style={{ width: "100%", height: "100%", cursor: "grab", opacity: 0, transition: "opacity 1s ease", touchAction: "none" }}
      />
    </div>
  );
}
