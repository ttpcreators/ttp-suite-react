import { useEffect, useRef, useCallback } from "react";
import createGlobe from "cobe";

/**
 * Globe interactif (cobe) avec des stickers emoji « collés » sur des villes.
 *
 * ⚠️ Le composant d'origine (21st.dev) positionnait les emoji via **CSS Anchor
 * Positioning** (`position-anchor` / `anchor()`), non supporté par Safari/iOS —
 * donc invisible sur l'app installée sur iPhone. Ici on **projette nous-mêmes**
 * chaque marqueur (lat/lng → écran) dans le `onRender` de cobe : ça marche sur
 * tous les navigateurs. On met à jour le DOM en impératif (pas de re-render React
 * à chaque frame). On respecte `prefers-reduced-motion` (globe figé, orientable).
 */

export interface StickerMarker {
  id: string;
  location: [number, number]; // [lat, lng]
  sticker: string;
}

interface GlobeStickersProps {
  markers?: StickerMarker[];
  className?: string;
  speed?: number;
  /** Thème sombre → globe foncé + halo discret. */
  dark?: boolean;
}

const defaultMarkers: StickerMarker[] = [
  { id: "paris", location: [48.86, 2.35], sticker: "🥐" },
  { id: "tokyo", location: [35.68, 139.65], sticker: "🗼" },
  { id: "nyc", location: [40.71, -74.01], sticker: "🍎" },
  { id: "rio", location: [-22.91, -43.17], sticker: "🎭" },
  { id: "sydney", location: [-33.87, 151.21], sticker: "🐨" },
  { id: "cairo", location: [30.04, 31.24], sticker: "🐪" },
  { id: "rome", location: [41.9, 12.5], sticker: "🍕" },
  { id: "mexico", location: [19.43, -99.13], sticker: "🌮" },
  { id: "india", location: [28.61, 77.21], sticker: "🐘" },
  { id: "london", location: [51.51, -0.13], sticker: "☕" },
  { id: "hawaii", location: [21.31, -157.86], sticker: "🏄" },
  { id: "amsterdam", location: [52.37, 4.9], sticker: "🚲" },
  { id: "seoul", location: [37.57, 126.98], sticker: "🎮" },
];

const DEG = Math.PI / 180;
// Sens de rotation aligné sur la texture du globe cobe. Passer à -1 si les
// stickers dérivent dans le sens inverse des continents.
const SPIN = 1;

/** Projette un marqueur (lat/lng) vers l'écran selon l'orientation courante. */
function project(lat: number, lng: number, phi: number, theta: number, size: number) {
  const latR = lat * DEG;
  const lngR = lng * DEG + SPIN * phi;
  const x = Math.cos(latR) * Math.sin(lngR);
  const y = Math.sin(latR);
  const z = Math.cos(latR) * Math.cos(lngR);
  // Inclinaison (theta) autour de l'axe horizontal.
  const yt = y * Math.cos(theta) + z * Math.sin(theta);
  const zt = -y * Math.sin(theta) + z * Math.cos(theta);
  const r = size / 2;
  return {
    sx: r + x * r,
    sy: r - yt * r,
    front: zt > 0.02, // hémisphère face à nous
    depth: Math.max(0, zt), // 0 (bord) → 1 (centre)
  };
}

export function GlobeStickers({
  markers = defaultMarkers,
  className = "",
  speed = 0.004,
  dark = false,
}: GlobeStickersProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stickerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const pointerInteracting = useRef<{ x: number; y: number } | null>(null);
  const dragOffset = useRef({ phi: 0, theta: 0 });
  const phiOffsetRef = useRef(0);
  const thetaOffsetRef = useRef(0);
  const isPausedRef = useRef(false);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerInteracting.current = { x: e.clientX, y: e.clientY };
    if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
    isPausedRef.current = true;
  }, []);

  const handlePointerUp = useCallback(() => {
    if (pointerInteracting.current !== null) {
      phiOffsetRef.current += dragOffset.current.phi;
      thetaOffsetRef.current += dragOffset.current.theta;
      dragOffset.current = { phi: 0, theta: 0 };
    }
    pointerInteracting.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = "grab";
    isPausedRef.current = false;
  }, []);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (pointerInteracting.current !== null) {
        dragOffset.current = {
          phi: (e.clientX - pointerInteracting.current.x) / 300,
          theta: (e.clientY - pointerInteracting.current.y) / 1000,
        };
      }
    };
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerup", handlePointerUp, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [handlePointerUp]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const spin = reduce ? 0 : speed;
    let globe: ReturnType<typeof createGlobe> | null = null;
    let animationId = 0;
    let phi = 0;
    let size = 0;

    // cobe v2 n'expose pas onRender → on pilote le globe via update() dans notre
    // propre boucle, et on y projette les stickers (même orientation exactement).
    function frame() {
      if (!globe) return;
      const curPhi = phi + phiOffsetRef.current + dragOffset.current.phi;
      const curTheta = 0.2 + thetaOffsetRef.current + dragOffset.current.theta;
      globe.update({ phi: curPhi, theta: curTheta });
      if (!isPausedRef.current) phi += spin;
      for (let i = 0; i < markers.length; i++) {
        const el = stickerRefs.current[i];
        if (!el) continue;
        const p = project(markers[i].location[0], markers[i].location[1], curPhi, curTheta, size);
        if (!p.front) {
          el.style.opacity = "0";
          continue;
        }
        const scale = 0.7 + 0.45 * p.depth;
        const tilt = [-8, 6, -4, 10][i % 4];
        el.style.opacity = String(0.35 + 0.65 * p.depth);
        el.style.transform = `translate(${p.sx}px, ${p.sy}px) translate(-50%, -50%) rotate(${tilt}deg) scale(${scale})`;
      }
      animationId = requestAnimationFrame(frame);
    }

    function init() {
      size = canvas.offsetWidth;
      if (size === 0 || globe) return;

      globe = createGlobe(canvas, {
        devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        width: size,
        height: size,
        phi: 0,
        theta: 0.2,
        dark: dark ? 1 : 0,
        diffuse: 1.4,
        mapSamples: 16000,
        mapBrightness: dark ? 4 : 8,
        baseColor: dark ? [0.28, 0.32, 0.4] : [1, 1, 1],
        markerColor: [0.17, 0.5, 1], // primary #2b7fff
        glowColor: dark ? [0.1, 0.12, 0.18] : [0.94, 0.95, 0.98],
        markers: [],
        opacity: 0.85,
      });
      frame();
      requestAnimationFrame(() => canvas && (canvas.style.opacity = "1"));
    }

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
    }

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
      if (globe) globe.destroy();
    };
  }, [markers, speed, dark]);

  return (
    <div className={`relative aspect-square select-none ${className}`}>
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        style={{
          width: "100%",
          height: "100%",
          cursor: "grab",
          opacity: 0,
          transition: "opacity 1s ease",
          borderRadius: "50%",
          touchAction: "none",
          contain: "layout paint",
        }}
      />
      {markers.map((m, i) => (
        <div
          key={m.id}
          ref={(el) => { stickerRefs.current[i] = el; }}
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            fontSize: "1.75rem",
            lineHeight: 1,
            opacity: 0,
            willChange: "transform, opacity",
            pointerEvents: "none",
            filter: "drop-shadow(0 1px 1px rgba(255,255,255,.9)) drop-shadow(0 2px 3px rgba(0,0,0,.3))",
          }}
        >
          {m.sticker}
        </div>
      ))}
    </div>
  );
}

export default GlobeStickers;
