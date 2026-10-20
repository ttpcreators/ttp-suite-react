import { useEffect, useRef } from "react";
import { SIG_INK, type SignatureData } from "@/lib/agencySignature";

/**
 * Zone où l'on gribouille sa signature (souris, doigt, stylet). Chaque trait devient un
 * tracé SVG lissé ; la valeur (tracés + taille) est celle enregistrée dans les réglages.
 */
const W = 360;
const H = 130;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Points d'un trait → tracé lissé (courbes passant par les milieux). */
function strokeToPath(pts: [number, number][]): string {
  if (pts.length === 1) return `M${r1(pts[0][0])} ${r1(pts[0][1])} L${r1(pts[0][0] + 0.5)} ${r1(pts[0][1] + 0.5)}`;
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${r1(pts[i][0])} ${r1(pts[i][1])} ${r1(mx)} ${r1(my)}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${r1(last[0])} ${r1(last[1])}`;
}

export function SignaturePad({ value, onChange }: { value: SignatureData | null; onChange: (v: SignatureData | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<[number, number][] | null>(null);
  const paths = useRef<string[]>([]);

  // Dessine la valeur courante (tracés SVG) dans la zone, à la bonne échelle.
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = W * dpr;
    c.height = H * dpr;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    paths.current = value?.paths ?? [];
    if (!value) return;
    const k = Math.min(W / value.w, H / value.h);
    ctx.save();
    ctx.translate((W - value.w * k) / 2, (H - value.h * k) / 2);
    ctx.scale(k, k);
    ctx.strokeStyle = SIG_INK;
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const d of value.paths) ctx.stroke(new Path2D(d));
    ctx.restore();
  }, [value]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };

  return (
    <canvas
      ref={ref}
      aria-label="Zone de signature : dessine ta signature"
      className="h-[130px] w-full max-w-[360px] cursor-crosshair touch-none rounded-xl border border-dashed border-border bg-white"
      style={{ aspectRatio: `${W} / ${H}` }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        // Une signature gribouillée par l'app a sa propre échelle : on repart d'une zone vide.
        if (value && (value.w !== W || value.h !== H)) {
          paths.current = [];
          const ctx = ref.current?.getContext("2d");
          ctx?.clearRect(0, 0, W, H);
        }
        drawing.current = [point(e)];
      }}
      onPointerMove={(e) => {
        const pts = drawing.current;
        const ctx = ref.current?.getContext("2d");
        if (!pts || !ctx) return;
        const p = point(e);
        const prev = pts[pts.length - 1];
        if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) < 1.2) return;
        pts.push(p);
        ctx.strokeStyle = SIG_INK;
        ctx.lineWidth = 2.4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(prev[0], prev[1]);
        ctx.lineTo(p[0], p[1]);
        ctx.stroke();
      }}
      onPointerUp={() => {
        const pts = drawing.current;
        drawing.current = null;
        if (!pts) return;
        const next = [...paths.current, strokeToPath(pts)];
        paths.current = next;
        onChange({ paths: next, w: W, h: H, on: value?.on !== false });
      }}
    />
  );
}
