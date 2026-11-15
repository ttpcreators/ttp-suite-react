import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { SPIDER_COLORS as K, SpiderEngine, type Pt, type SpiderPose } from "@/lib/spiderEngine";

/**
 * L'araignée des recherches, dans l'esprit de la vidéo de @everything.bends : pendant que la
 * recherche tourne côté serveur, une araignée-robot (pattes fines, genoux roses) marche sur les
 * lignes de texte, encadre un mot, le fait flotter dans une grande étiquette rose ou violette
 * reliée par un fil, tisse sa toile, et les barres noire, rose et violette défilent en bas.
 *
 * `items` : les textes qu'elle lit (marques, comptes, légendes déjà connus). Sans `items`, des
 * lignes floutées. Purement visuel : le seul chiffre affiché est ce qu'elle a lu à l'écran et le
 * temps écoulé, jamais un faux résultat de recherche.
 */
const H = 300;
const LINE_H = 40;
const VISIBLE = 4; // lignes visibles au-dessus des barres du bas
const TOP = 64; // place pour l'étiquette au-dessus de la première ligne
const STEP_MS = 1150;

const sq = (p: Pt, s: number, fill: string, key: string) => <rect key={key} x={p.x - s / 2} y={p.y - s / 2} width={s} height={s} fill={fill} />;
const clean = (w: string) => w.replace(/[^\p{L}\p{N}#@]/gu, "");
const FILLER = Array.from({ length: 12 }, (_, i) => ["▇▇▇▇", "▇▇▇▇▇▇", "▇▇▇", "▇▇▇▇▇", "▇▇▇▇▇▇▇", "▇▇"].slice(0, 3 + (i % 4)).join(" "));

/** Le mot que l'araignée choisit sur une ligne : le plus long (au moins 3 lettres), sinon le premier. */
function pick(words: string[], salt: number) {
  const ok = words.map((w, i) => ({ i, n: clean(w).length })).filter((x) => x.n >= 3);
  if (!ok.length) return 0;
  ok.sort((a, b) => b.n - a.n);
  return ok[salt % Math.min(2, ok.length)].i;
}

export function SpiderScan({ label, items, className }: { label: string; items?: string[]; className?: string }) {
  const reduce = useReducedMotion() ?? false;
  const box = useRef<HTMLDivElement>(null);
  const wordEls = useRef(new Map<string, HTMLSpanElement>());
  const lines = useMemo(() => {
    const src = (items ?? []).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 40);
    return (src.length >= 3 ? src : FILLER).map((t) => t.split(" ").slice(0, 9));
  }, [items]);
  const blurred = !items || items.filter(Boolean).length < 3;

  const [step, setStep] = useState(0);
  const [secs, setSecs] = useState(0);
  const [pose, setPose] = useState<SpiderPose | null>(null);
  type Box = { x: number; y: number; w: number; h: number };
  const [mark, setMark] = useState<Box | null>(null);
  const [trail, setTrail] = useState<{ key: string; word: string; tone: string }[]>([]);
  const [silk, setSilk] = useState<Pt[]>([]);
  const target = useRef<Pt>({ x: 120, y: 90 });
  const current = useRef("0:0");
  const trailRef = useRef(trail);
  trailRef.current = trail;

  // Le rythme : une nouvelle ligne toutes les 1,15 s, et le chrono.
  useEffect(() => {
    const t0 = performance.now();
    const a = window.setInterval(() => setStep((s) => s + 1), STEP_MS);
    const b = window.setInterval(() => setSecs(Math.floor((performance.now() - t0) / 1000)), 250);
    return () => {
      window.clearInterval(a);
      window.clearInterval(b);
    };
  }, []);

  const line = step % lines.length;
  const offset = Math.max(0, Math.min(line - 1, lines.length - VISIBLE));
  const wi = pick(lines[line], step);
  const tone = step % 3 === 2 ? K.violet : K.joint;

  // Nouveau mot à lire : on le retient (sa position est mesurée en continu, même pendant le défilement).
  useEffect(() => {
    const key = `${line}:${wi}`;
    current.current = key;
    const word = blurred ? "LECTURE" : clean(lines[line][wi]).toUpperCase() || "LECTURE";
    setTrail((t) => [...t.slice(-5), { key, word, tone }]);
  }, [line, wi, lines, blurred, tone]);

  // Boucle d'animation : mesure du mot, puis le moteur des pattes avance vers lui.
  useEffect(() => {
    const measure = (key: string): Box | null => {
      const el = wordEls.current.get(key);
      const root = box.current;
      if (!el || !root) return null;
      const r = el.getBoundingClientRect();
      const o = root.getBoundingClientRect();
      return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
    };
    const follow = () => {
      const m = measure(current.current);
      const root = box.current;
      if (m && root) {
        target.current = { x: Math.min(root.clientWidth - 110, m.x + m.w + 34), y: m.y + m.h / 2 + 6 };
        setMark(m);
      }
      setSilk(
        trailRef.current
          .slice(0, -1)
          .map((t) => measure(t.key))
          .filter((x): x is Box => !!x)
          .map((x) => ({ x: x.x + x.w / 2, y: x.y + x.h / 2 })),
      );
    };
    const sp = new SpiderEngine({ x: target.current.x, y: -80 }, { scale: 0.95, maxSpeed: 600, idle: !reduce });
    if (reduce) {
      const id = window.setInterval(() => {
        follow();
        sp.pos = { ...target.current };
        setPose(sp.pose());
      }, 400);
      return () => window.clearInterval(id);
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      follow();
      sp.update(dt, target.current);
      setPose(sp.pose());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduce]);

  const b = pose?.body;
  const ink = "currentColor";
  const last = trail[trail.length - 1];
  // Ce qu'elle a vraiment fait à l'écran : un mot encadré par ligne lue (aucun faux résultat).
  const marked = step + 1;
  const pad = (n: number) => String(n).padStart(3, "0");

  return (
    <div ref={box} className={cn("relative overflow-hidden rounded-[18px] bg-white text-[#111] ring-1 ring-black/5 dark:bg-[#0E0E10] dark:text-[#F2F2F4] dark:ring-white/10", className)} style={{ height: H }} role="status" aria-live="polite">
      <span className="sr-only">Recherche en cours sur {label}</span>

      {/* Les lignes que l'araignée lit */}
      <div className="absolute inset-x-0 transition-transform duration-300 ease-out" style={{ top: TOP, transform: `translateY(${-offset * LINE_H}px)` }}>
        {lines.map((words, li) => (
          <div key={li} className="flex items-center gap-3 px-4" style={{ height: LINE_H }}>
            <span className="h-6 w-6 shrink-0 rounded-full bg-black/10 blur-[2px] dark:bg-white/15" />
            <span className={cn("min-w-0 truncate text-[15px] leading-none", blurred && "text-black/15 dark:text-white/15")}>
              {words.map((w, j) => (
                <span key={j}>
                  {j ? " " : ""}
                  <span
                    ref={(el) => {
                      if (el) wordEls.current.set(`${li}:${j}`, el);
                    }}
                  >
                    {w}
                  </span>
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>

      {/* Toile, cadre du mot, étiquettes */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
        {b && silk.map((t, i) => <line key={`s${i}`} x1={b.x} y1={b.y} x2={t.x} y2={t.y} stroke={ink} strokeOpacity={0.16} strokeWidth={1} />)}
        {mark && <rect x={mark.x - 3} y={mark.y - 3} width={mark.w + 6} height={mark.h + 6} fill="none" stroke={tone} strokeWidth={1.8} />}
        {mark && <line x1={mark.x + mark.w / 2} y1={mark.y - 3} x2={mark.x + mark.w / 2} y2={Math.max(46, mark.y - 46)} stroke={tone} strokeWidth={1.5} />}
      </svg>
      {mark && last && (
        <div key={trail.length} className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-full flex-col items-center" style={{ left: mark.x + mark.w / 2, top: Math.max(46, mark.y - 46) }}>
          <span className="whitespace-nowrap px-2.5 pb-0.5 font-mono text-[20px] leading-tight text-white" style={{ background: last.tone }}>
            {last.word.slice(0, 16)}
          </span>
          <span className="mt-0.5 flex gap-0.5">
            {[0, 1, 2].map((k) => (
              <span key={k} className="block h-[7px] w-5 border-[1.5px]" style={{ borderColor: last.tone }} />
            ))}
          </span>
        </div>
      )}

      {/* L'araignée */}
      {pose && b && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          {pose.legs.map((l, i) => (
            <g key={i}>
              <polyline points={`${l.hip.x},${l.hip.y} ${l.knee.x},${l.knee.y} ${l.foot.x},${l.foot.y}`} fill="none" stroke={ink} strokeWidth={1.8} />
              {sq(l.knee, 6, K.joint, `k${i}`)}
              {sq(l.foot, l.lifting ? 5.5 : 3.5, l.lifting ? K.joint : ink, `f${i}`)}
            </g>
          ))}
          <rect x={b.x - 4.5} y={b.y - 19} width={9} height={7} fill={ink} />
          <rect x={b.x - 7.5} y={b.y - 11} width={15} height={12} fill={ink} />
          <rect x={b.x - 6} y={b.y + 1} width={12} height={13} fill={ink} />
          {sq({ x: b.x - 2.5, y: b.y - 6 }, 2.5, "#fff", "p1")}
          {sq({ x: b.x + 3, y: b.y + 6 }, 2.5, "#fff", "p2")}
          <g transform={`translate(${b.x + 18},${b.y - 26})`}>
            <rect width={86} height={24} fill={K.cyan} />
            <text x={5} y={10} fontFamily="ui-monospace, Menlo, monospace" fontSize={8.5} fill="#fff">ARAIGNÉE/01</text>
            <text x={5} y={20} fontFamily="ui-monospace, Menlo, monospace" fontSize={8.5} fill="#fff">● {secs} s</text>
          </g>
        </svg>
      )}

      {/* Les barres du bas, comme dans la vidéo */}
      <div className="absolute inset-x-0 bottom-0 font-mono text-[12px] leading-none text-white">
        <div className="inline-block bg-[#111] px-3 py-1.5 dark:bg-white dark:text-[#111]">
          L'ARAIGNÉE FOUILLE {label.toUpperCase()} · LIGNES LUES {step} · {secs} S
        </div>
        <div className="grid grid-cols-2">
          <div className="truncate px-3 py-1.5" style={{ background: K.joint }}>
            MOTS REPÉRÉS {pad(marked)} {last ? last.word.slice(0, 14) : ""}
          </div>
          <div className="truncate px-3 py-1.5" style={{ background: K.violet }}>
            EN COURS {pad(secs)} S · {label.toUpperCase().slice(0, 16)}
          </div>
        </div>
      </div>
    </div>
  );
}
