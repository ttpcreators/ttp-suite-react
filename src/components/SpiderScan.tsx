import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { SPIDER_COLORS as K, SpiderEngine, type Pt, type SpiderPose } from "@/lib/spiderEngine";

/**
 * L'araignée des recherches (radars, hashtag, analyse d'un créateur) : pendant que la recherche
 * tourne côté serveur, une araignée-robot parcourt des lignes de résultats en attente, comme dans
 * la vidéo de @everything.bends (pattes fines aux genoux roses, étiquette rose, barre noire en bas).
 * Purement visuel : aucun faux chiffre, seulement le temps écoulé. Même moteur que les vidéos TTP
 * et la page de crawl (`src/lib/spiderEngine.ts`).
 */
const H = 190;
const ROWS = 4;
const ROW_H = 34;
const TOP = 22;

const sq = (p: Pt, s: number, fill: string, key: string) => <rect key={key} x={p.x - s / 2} y={p.y - s / 2} width={s} height={s} fill={fill} />;

export function SpiderScan({ label, className }: { label: string; className?: string }) {
  const reduce = useReducedMotion() ?? false;
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [pose, setPose] = useState<SpiderPose | null>(null);
  const [stop, setStop] = useState<{ x: number; row: number }>({ x: 120, row: 0 });
  const [secs, setSecs] = useState(0);

  // Largeur du cadre, pour que l'araignée reste dedans.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 600));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Une nouvelle ligne à lire toutes les 1,2 s, et le chrono.
  useEffect(() => {
    const t0 = performance.now();
    let n = 0;
    const id = window.setInterval(() => {
      n++;
      setSecs(Math.floor((performance.now() - t0) / 1000));
      if (n % 6 === 0) setStop((s) => ({ row: (s.row + 1 + (n % 2)) % ROWS, x: 0.18 + ((n * 0.37) % 0.64) }));
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  // Boucle d'animation : le moteur avance vers la ligne en cours.
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    const target = (): Pt => ({ x: Math.max(70, Math.min(w - 120, stopRef.current.x * w)), y: TOP + stopRef.current.row * ROW_H + ROW_H / 2 + 6 });
    const sp = new SpiderEngine({ x: target().x, y: -60 }, { scale: 0.62, maxSpeed: 520, idle: !reduce });
    if (reduce) {
      sp.pos = target();
      setPose(sp.pose());
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      sp.update(dt, target());
      setPose(sp.pose());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [w, reduce]);

  const ink = "currentColor";
  const b = pose?.body;
  const reading = pose && !pose.moving;
  return (
    <div ref={box} className={cn("relative overflow-hidden rounded-[18px] bg-panel/50 text-foreground", className)} style={{ height: H }} role="status" aria-live="polite">
      <span className="sr-only">Recherche en cours sur {label}</span>
      {/* Lignes de résultats en attente */}
      {Array.from({ length: ROWS }, (_, i) => (
        <div key={i} className="absolute left-4 right-4 flex items-center gap-3" style={{ top: TOP + i * ROW_H, height: ROW_H }}>
          <div className="h-5 w-5 shrink-0 rounded-full bg-border" />
          <div className={cn("h-2.5 rounded-sm bg-border transition-colors", stop.row === i && reading && "bg-[#F23DD3]/30")} style={{ width: `${46 + ((i * 17) % 34)}%` }} />
          <div className="ml-auto h-2.5 w-10 rounded-sm bg-border" />
        </div>
      ))}
      {/* Étiquette rose au-dessus de la ligne lue */}
      {reading && b && (
        <div className="pointer-events-none absolute flex -translate-x-1/2 flex-col items-center" style={{ left: b.x - 40, top: TOP + stop.row * ROW_H - 30 }}>
          <span className="whitespace-nowrap px-2 pb-0.5 font-mono text-[13px] leading-tight text-white" style={{ background: K.joint }}>EN LECTURE</span>
          <span className="mt-0.5 flex gap-0.5">
            {[0, 1, 2].map((k) => (
              <span key={k} className="block h-1.5 w-4 border" style={{ borderColor: K.joint }} />
            ))}
          </span>
        </div>
      )}
      {pose && b && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          {pose.legs.map((l, i) => (
            <g key={i}>
              <polyline points={`${l.hip.x},${l.hip.y} ${l.knee.x},${l.knee.y} ${l.foot.x},${l.foot.y}`} fill="none" stroke={ink} strokeWidth={1.6} />
              {sq(l.knee, 5, K.joint, `k${i}`)}
              {sq(l.foot, l.lifting ? 4.5 : 3, l.lifting ? K.joint : ink, `f${i}`)}
            </g>
          ))}
          <rect x={b.x - 3.5} y={b.y - 15} width={7} height={5.5} fill={ink} />
          <rect x={b.x - 6} y={b.y - 9} width={12} height={10} fill={ink} />
          <rect x={b.x - 5} y={b.y + 1} width={10} height={10} fill={ink} />
          <g transform={`translate(${b.x + 16},${b.y - 22})`}>
            <rect width={78} height={22} fill={K.cyan} />
            <text x={4} y={9.5} fontFamily="ui-monospace, Menlo, monospace" fontSize={8} fill="#fff">ARAIGNÉE/01</text>
            <text x={4} y={18.5} fontFamily="ui-monospace, Menlo, monospace" fontSize={8} fill="#fff">● {secs} s</text>
          </g>
        </svg>
      )}
      {/* Barres du bas : noire (ce qui se passe), rose et violette (indéterminées, pas de faux chiffre) */}
      <div className="absolute inset-x-0 bottom-0 font-mono text-[12px] text-white">
        <div className="inline-block bg-[#111] px-3 py-1 dark:bg-white dark:text-[#111]">L'ARAIGNÉE FOUILLE {label.toUpperCase()} · {secs} s</div>
        <div className="grid h-1.5 grid-cols-2">
          <div style={{ background: K.joint }} />
          <div style={{ background: K.violet }} />
        </div>
      </div>
    </div>
  );
}
