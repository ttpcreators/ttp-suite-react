import { useMemo, useRef, useState, type CSSProperties } from "react";
import { motion, useReducedMotion } from "motion/react";

/**
 * TargetFan — graphe de PROJECTION générique et réutilisable.
 *
 * Un historique réel marche jusqu'à « aujourd'hui », puis N projections partent
 * en éventail vers des objectifs (ex : prudent / attendu / optimiste). Scrub sur
 * l'historique ou survol d'un objectif → une carte s'affiche à côté du point
 * (valeur en gros, contexte discret — comme les tuiles KPI de l'app).
 *
 * 100 % piloté par props (aucune donnée en dur) ; thème clair/sombre via les
 * variables CSS du design system. Adapté du composant « Price Target Fan ».
 *
 * @example
 * <TargetFan
 *   title="Abonnés · projection 6 mois"
 *   history={[4200, 4500, 4800, 5100, 5300]}
 *   targets={[
 *     { key: "Optimiste", value: 8000, sub: "rythme +8 %/mois" },
 *     { key: "Attendu",   value: 6500, sub: "tendance actuelle" },
 *     { key: "Prudent",   value: 5800, sub: "rythme ralenti" },
 *   ]}
 * />
 */

const GREEN = "var(--chart-2, #4dbe95)";
const BLUE = "var(--chart-1, #489ffa)";
const AMBER = "var(--chart-amber, #e8b45a)";
const EASE = [0.16, 1, 0.3, 1] as const;
const HAIRLINE = "var(--border)";
const SURFACE = "var(--card)";
const SURFACE_RAISED = "var(--popover, var(--card))";
const TEXT = "var(--foreground)";
const TEXT_MUTED = "var(--muted-foreground)";
const AUTO_COLORS = [GREEN, BLUE, AMBER, "var(--chart-3, #a78bfa)", "var(--chart-4, #f472b6)"];

export type FanTarget = { key: string; value: number; sub?: string; color?: string };

export type TargetFanProps = {
  /** Série chronologique réelle, du plus ANCIEN au plus RÉCENT. */
  history: number[];
  /** Valeur « maintenant » (défaut : dernier point de l'historique). */
  current?: number;
  /** Objectifs projetés (idéalement du plus haut au plus bas). */
  targets: FanTarget[];
  /** Formatage des valeurs (défaut : compact FR — 5,3 K / 1,2 M). */
  format?: (n: number) => string;
  /** Eyebrow au-dessus du gros chiffre (ex : « Abonnés · 6 mois »). */
  title?: string;
  /** Gros chiffre d'en-tête (défaut : objectif « médian » formaté). */
  headline?: string;
  /** Petit delta coloré à côté de l'en-tête (ex : « +48 % »). */
  headlineDelta?: string;
  /** Libellés d'axe X : [début, milieu, maintenant, horizon]. */
  xLabels?: [string, string, string, string];
  /** Libellés optionnels des points d'historique (contexte au scrub). */
  historyLabels?: string[];
  /** Bornes de l'axe Y (défaut : auto depuis les données, avec marge). */
  axisMin?: number;
  axisMax?: number;
  width?: number;
  height?: number;
  className?: string;
  style?: CSSProperties;
};

const fmtCompact = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(".", ",").replace(",0", "") + " M";
  if (abs >= 1e3) return (n / 1e3).toFixed(1).replace(".", ",").replace(",0", "") + " K";
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
};
const niceStep = (span: number) => {
  const raw = span / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const norm = raw / mag;
  const step = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
  return step * mag;
};

export function TargetFan({
  history,
  current,
  targets,
  format = fmtCompact,
  title = "Projection",
  headline,
  headlineDelta,
  xLabels = ["Début", "", "Maintenant", "Objectif"],
  historyLabels,
  axisMin,
  axisMax,
  width = 520,
  height = 236,
  className = "",
  style,
}: TargetFanProps) {
  const reduced = useReducedMotion();
  const svgRef = useRef<SVGSVGElement>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [hotT, setHotT] = useState<number | null>(null);

  const W = width;
  const H = height;
  const PAD = { l: 34, r: 108, t: 16, b: 28 };
  const HIST = history.length ? history : [0, 0];
  const NOW = current ?? HIST[HIST.length - 1];

  // Bornes Y auto (données + objectifs + maintenant) avec ~8 % de marge.
  const [Y_MIN, Y_MAX] = useMemo(() => {
    if (axisMin != null && axisMax != null) return [axisMin, axisMax];
    const all = [...HIST, NOW, ...targets.map((t) => t.value)];
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    if (lo === hi) { lo -= 1; hi += 1; }
    const m = (hi - lo) * 0.08;
    return [axisMin ?? lo - m, axisMax ?? hi + m];
  }, [HIST, NOW, targets, axisMin, axisMax]);

  const y = (v: number) => PAD.t + (1 - (v - Y_MIN) / (Y_MAX - Y_MIN)) * (H - PAD.t - PAD.b);
  const pct = (p: number) => (NOW ? ((p - NOW) / NOW) * 100 : 0);

  const geo = useMemo(() => {
    const histW = (W - PAD.l - PAD.r) * 0.56;
    const hx = (i: number) => PAD.l + (HIST.length <= 1 ? 0 : (i / (HIST.length - 1)) * histW);
    const nowX = hx(HIST.length - 1);
    const nowY = y(NOW);
    const endX = W - PAD.r;
    const line = HIST.map((v, i) => `${i === 0 ? "M" : "L"}${hx(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const proj = targets.map((t, i) => {
      const ty = y(t.value);
      const cx = nowX + (endX - nowX) * 0.5;
      const cy = nowY + (ty - nowY) * 0.15;
      return { ...t, color: t.color ?? AUTO_COLORS[i % AUTO_COLORS.length], ty, d: `M${nowX},${nowY} Q${cx},${cy} ${endX},${ty}`, cx, cy };
    });
    // Bande = enveloppe entre le 1er et le dernier objectif (haut ↔ bas).
    let band = "";
    if (proj.length >= 2) {
      const a = proj[0];
      const b = proj[proj.length - 1];
      band = `M${nowX},${nowY} Q${a.cx},${a.cy} ${endX},${a.ty} L${endX},${b.ty} Q${b.cx},${b.cy} ${nowX},${nowY} Z`;
    }
    return { hx, nowX, nowY, endX, line, proj, band };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [HIST, NOW, targets, Y_MIN, Y_MAX, W, H]);

  // Graduations Y « propres ».
  const yTicks = useMemo(() => {
    const step = niceStep(Y_MAX - Y_MIN);
    const out: number[] = [];
    for (let v = Math.ceil(Y_MIN / step) * step; v <= Y_MAX; v += step) out.push(v);
    return out;
  }, [Y_MIN, Y_MAX]);

  const onMove = (e: React.PointerEvent) => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    if (px > geo.nowX + 6) { setScrub(null); return; }
    const histW = geo.nowX - PAD.l;
    if (histW <= 0) return;
    setScrub(Math.max(0, Math.min(HIST.length - 1, Math.round(((px - PAD.l) / histW) * (HIST.length - 1)))));
  };

  const CARD_W = 132;
  const overlay = (() => {
    if (hotT !== null && geo.proj[hotT]) {
      const p = geo.proj[hotT];
      const up = p.value >= NOW;
      return {
        px: geo.endX,
        py: p.ty,
        value: format(p.value),
        context: `${p.key} · ${up ? "+" : ""}${pct(p.value).toFixed(1)} %${p.sub ? ` · ${p.sub}` : ""}`,
        color: p.color as string | undefined,
      };
    }
    if (scrub !== null) {
      const ago = HIST.length - 1 - scrub;
      return {
        px: geo.hx(scrub),
        py: y(HIST[scrub]),
        value: format(HIST[scrub]),
        context: historyLabels?.[scrub] ?? (ago === 0 ? "maintenant" : ""),
        color: undefined as string | undefined,
      };
    }
    return null;
  })();

  const meanTarget = targets.length ? targets[Math.floor(targets.length / 2)] : undefined;
  const autoHeadline = headline ?? (meanTarget ? format(meanTarget.value) : format(NOW));
  const autoDelta = headlineDelta ?? (meanTarget ? `${meanTarget.value >= NOW ? "+" : ""}${pct(meanTarget.value).toFixed(1)} %` : undefined);

  return (
    <div className={className} style={{ maxWidth: W, ...style }}>
      {/* En-tête — objectif médian + potentiel (lecture KPI) */}
      <div className="mb-1 flex items-end justify-between px-1">
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-foreground/35">{title}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-[22px] font-semibold tabular-nums tracking-[-0.02em] text-foreground/90">{autoHeadline}</span>
            {autoDelta && <span className="text-[12px] font-medium tabular-nums" style={{ color: (meanTarget?.value ?? NOW) >= NOW ? GREEN : AMBER }}>{autoDelta}</span>}
          </div>
        </div>
        <div className="text-right text-[11px] tabular-nums" style={{ color: TEXT_MUTED }}>Auj. {format(NOW)}</div>
      </div>

      <div className="relative w-full overflow-x-auto" style={{ maxWidth: W }}>
        <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block cursor-crosshair" onPointerMove={onMove} onPointerLeave={() => setScrub(null)}>
          {/* Grille + axe Y */}
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={PAD.l} y1={y(v)} x2={geo.endX} y2={y(v)} stroke="color-mix(in srgb, var(--foreground) 4%, transparent)" strokeDasharray="2 5" />
              <text x={PAD.l - 7} y={y(v) + 3} textAnchor="end" fontSize={8.5} fill="color-mix(in srgb, var(--foreground) 32%, transparent)" className="tabular-nums">
                {fmtCompact(v)}
              </text>
            </g>
          ))}

          {/* Axe X : début → maintenant → horizon */}
          {[
            { x: geo.hx(0), t: xLabels[0], a: "start" as const },
            { x: geo.hx(Math.floor((HIST.length - 1) / 2)), t: xLabels[1], a: "middle" as const },
            { x: geo.nowX, t: xLabels[2], a: "middle" as const },
            { x: geo.endX, t: xLabels[3], a: "middle" as const },
          ].map((d, i) => (
            d.t ? (
              <text key={i} x={d.x} y={H - 8} textAnchor={d.a} fontSize={8.5} fill="color-mix(in srgb, var(--foreground) 30%, transparent)">
                {d.t}
              </text>
            ) : null
          ))}

          {/* Bande de projection */}
          {geo.band && (
            <motion.path
              d={geo.band}
              fill={`color-mix(in srgb, ${BLUE} 6%, transparent)`}
              initial={{ opacity: reduced ? 1 : 0 }}
              animate={{ opacity: hotT === null ? 1 : 0.22 }}
              transition={reduced ? { duration: 0 } : { duration: 0.5, ease: EASE, delay: 0.9 }}
            />
          )}

          {/* Repère « maintenant » */}
          <line x1={geo.nowX} y1={PAD.t} x2={geo.nowX} y2={H - PAD.b} stroke="color-mix(in srgb, var(--foreground) 12%, transparent)" strokeWidth={1} strokeDasharray="3 3" />

          {/* Historique */}
          <motion.path
            d={geo.line}
            fill="none"
            stroke="color-mix(in srgb, var(--foreground) 78%, transparent)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            initial={{ pathLength: reduced ? 1 : 0 }}
            animate={{ pathLength: 1 }}
            transition={reduced ? { duration: 0 } : { duration: 0.9, ease: EASE }}
          />

          {/* Projections + labels d'objectif */}
          {geo.proj.map((p, i) => {
            const on = hotT === i;
            const dim = hotT !== null && !on;
            return (
              <motion.g
                key={p.key}
                initial={{ opacity: reduced ? 1 : 0 }}
                animate={{ opacity: dim ? 0.26 : 1 }}
                transition={reduced ? { duration: 0 } : { duration: 0.5, ease: EASE, delay: 0.9 + i * 0.12 }}
                onMouseEnter={() => setHotT(i)}
                onMouseLeave={() => setHotT(null)}
                style={{ cursor: "default" }}
              >
                <path d={p.d} fill="none" stroke="transparent" strokeWidth={16} />
                <path d={p.d} fill="none" stroke={p.color} strokeWidth={on ? 2.2 : 1.4} strokeOpacity={on ? 1 : 0.7} strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
                <circle cx={geo.endX} cy={p.ty} r={on ? 4 : 3.2} fill={SURFACE} stroke={p.color} strokeWidth={1.6} />
                <text x={geo.endX + 10} y={p.ty - 2.5} fontSize={8} fill="color-mix(in srgb, var(--foreground) 40%, transparent)">{p.key}</text>
                <text x={geo.endX + 10} y={p.ty + 8} fontSize={10.5} fontWeight={600} fill={p.color} className="tabular-nums">{format(p.value)}</text>
              </motion.g>
            );
          })}

          {/* Point « maintenant » */}
          <motion.circle cx={geo.nowX} cy={geo.nowY} r={3.2} fill="var(--foreground)" initial={{ opacity: reduced ? 1 : 0 }} animate={{ opacity: 1 }} transition={reduced ? { duration: 0 } : { delay: 0.85 }} />

          {/* Crosshair de scrub */}
          {scrub !== null && (
            <g pointerEvents="none">
              <line x1={geo.hx(scrub)} y1={PAD.t} x2={geo.hx(scrub)} y2={H - PAD.b} stroke="color-mix(in srgb, var(--foreground) 22%, transparent)" strokeWidth={1} />
              <circle cx={geo.hx(scrub)} cy={y(HIST[scrub])} r={3.2} fill="var(--foreground)" stroke={SURFACE} strokeWidth={1.5} />
            </g>
          )}
        </svg>

        {/* Carte flottante — valeur en gros, contexte discret */}
        {overlay && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border px-2.5 py-1.5 shadow-sm"
            style={{
              width: CARD_W,
              left: overlay.px < W / 2 ? Math.min(W - CARD_W - 4, overlay.px + 14) : Math.max(4, overlay.px - CARD_W - 14),
              top: Math.max(2, Math.min(H - 44, overlay.py - 18)),
              background: SURFACE_RAISED,
              borderColor: HAIRLINE,
            }}
          >
            <div className="text-[13px] font-semibold tabular-nums" style={{ color: overlay.color ?? TEXT }}>{overlay.value}</div>
            {overlay.context && <div className="mt-0.5 text-[10px]" style={{ color: TEXT_MUTED }}>{overlay.context}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Aperçu autonome (données d'exemple : projection d'abonnés). */
export function Demo() {
  const history = [4200, 4350, 4280, 4500, 4620, 4580, 4810, 5050, 5180, 5300];
  return (
    <div className="flex min-h-[280px] w-full items-center justify-center p-6">
      <TargetFan
        title="Abonnés · projection 6 mois"
        history={history}
        targets={[
          { key: "Optimiste", value: 8200, sub: "rythme soutenu" },
          { key: "Attendu", value: 6800, sub: "tendance actuelle" },
          { key: "Prudent", value: 5900, sub: "rythme ralenti" },
        ]}
        xLabels={["Il y a 9 mois", "", "Auj.", "+6 mois"]}
      />
    </div>
  );
}

export { TargetFan as Component };
export default TargetFan;
