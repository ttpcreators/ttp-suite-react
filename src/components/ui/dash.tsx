import { useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUp, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Panneau bordé de l'Aperçu (plat ; en Minuit il se fond dans le fond). */
export function DashPanel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("overflow-hidden rounded-2xl border border-border bg-surface", className)}>{children}</section>;
}

/** Titre de section de l'Aperçu : icône grise + intitulé, action optionnelle à droite. */
export function DashSectionTitle({ icon: Icon, children, right }: { icon: LucideIcon; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <h2 className="text-[14px] font-semibold text-foreground">{children}</h2>
      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}

/** Bouton plein largeur « Voir … → » de l'Aperçu. */
export function DashWideLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover"
    >
      {label} <ArrowRight className="h-3.5 w-3.5" />
    </button>
  );
}

/**
 * Briques du tableau de bord « Minuit » (inspirées du dashboard Efferd, refaites
 * à la main avec les tokens de l'app : rien de codé en dur, clair et sombre).
 *   • Delta      : variation ▲▼ en pastille ronde + pourcentage + comparaison
 *   • RadialTicks: jauge radiale en traits (270°), remplie à `pct`
 *   • TickMeter  : jauge horizontale en fins traits verticaux + repère %
 *   • SegmentBar : barre segmentée (parts d'un total) + libellés % + légende
 */

const pctFr = (n: number, digits = 1) => `${Math.abs(n).toFixed(digits).replace(".", ",")} %`;

/** Variation vs période précédente. `null` = pas de comparaison honnête possible. */
export function Delta({ value, suffix = "vs période préc." }: { value: number | null; suffix?: string }) {
  if (value == null || !Number.isFinite(value)) {
    return <span className="text-[12px] text-faint">Pas encore de comparaison</span>;
  }
  const up = value >= 0;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[12px]">
      <span
        className={cn(
          "grid size-[15px] shrink-0 place-items-center rounded-full text-white dark:text-black",
          up ? "bg-emerald-500" : "bg-rose-500",
        )}
        aria-hidden
      >
        {up ? <ArrowUp className="size-2.5" strokeWidth={3} /> : <ArrowDown className="size-2.5" strokeWidth={3} />}
      </span>
      <span className={cn("font-medium tabular-nums", up ? "text-emerald-500" : "text-rose-500")}>
        <span className="sr-only">{up ? "Hausse de " : "Baisse de "}</span>
        {pctFr(value)}
      </span>
      <span className="text-muted-foreground">{suffix}</span>
    </span>
  );
}

/** Déclenche l'animation d'entrée après le premier rendu (respecte reduced-motion via CSS). */
function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setM(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return m;
}

/** Jauge radiale en traits : arc de 270° ouvert en bas, `pct` entre 0 et 1. */
export function RadialTicks({
  pct,
  ticks = 56,
  children,
  label,
}: {
  pct: number;
  ticks?: number;
  children?: ReactNode;
  /** Texte accessible décrivant la valeur. */
  label: string;
}) {
  const mounted = useMounted();
  const p = Math.max(0, Math.min(1, Number.isFinite(pct) ? pct : 0));
  const filled = Math.round(p * (ticks - 1));
  const C = 120;
  const R1 = 108; // extrémité extérieure
  const R0 = 86; // extrémité intérieure
  const start = 135; // degrés (bas gauche) → sens horaire jusqu'à 405 (bas droite)
  const sweep = 270;
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[240px]" role="img" aria-label={label}>
      <svg viewBox="0 0 240 240" className="h-full w-full">
        {Array.from({ length: ticks }, (_, i) => {
          const a = ((start + (i * sweep) / (ticks - 1)) * Math.PI) / 180;
          const on = i <= filled && p > 0;
          // Les traits remplis s'estompent légèrement vers la fin de l'arc (relief).
          const op = on ? 0.95 - (i / Math.max(1, filled)) * 0.45 : 0.16;
          return (
            <line
              key={i}
              x1={C + R0 * Math.cos(a)}
              y1={C + R0 * Math.sin(a)}
              x2={C + R1 * Math.cos(a)}
              y2={C + R1 * Math.sin(a)}
              stroke="var(--foreground)"
              strokeWidth={4.2}
              strokeLinecap="round"
              strokeOpacity={mounted ? op : 0.16}
              className="transition-[stroke-opacity] duration-500 motion-reduce:transition-none"
              style={{ transitionDelay: `${i * 9}ms` }}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

/** Jauge horizontale en fins traits verticaux, repère « XX % » au-dessus de la limite. */
export function TickMeter({ pct, bars = 64, label }: { pct: number; bars?: number; label: string }) {
  const mounted = useMounted();
  const p = Math.max(0, Math.min(1, Number.isFinite(pct) ? pct : 0));
  const filled = Math.round(p * bars);
  return (
    <div className="relative pt-6" role="img" aria-label={label}>
      <span
        className="absolute top-0 -translate-x-1/2 text-[11px] font-medium tabular-nums text-foreground"
        style={{ left: `${Math.min(94, Math.max(6, p * 100))}%` }}
      >
        {Math.round(p * 100)} %
      </span>
      <div className="flex h-10 items-end justify-between border-l-2 border-foreground/80 pl-1">
        {Array.from({ length: bars }, (_, i) => (
          <span
            key={i}
            className={cn(
              "w-[2px] rounded-full transition-colors duration-500 motion-reduce:transition-none",
              mounted && i < filled ? "bg-foreground/75" : "bg-foreground/15",
            )}
            style={{ height: i < filled ? "100%" : "78%", transitionDelay: `${i * 6}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

export type Segment = { label: string; value: number; className: string };

/** Barre segmentée : chaque part avec son % au-dessus (filet de repère) + légende. */
export function SegmentBar({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0);
  const shown = segments.filter((s) => s.value > 0);
  if (total <= 0 || shown.length === 0) {
    return <div className="rounded-full bg-foreground/10 py-1.5 text-center text-[11px] text-faint">Rien à répartir pour le moment</div>;
  }
  return (
    <div>
      <div className="flex gap-1.5">
        {shown.map((s) => {
          const w = (s.value / total) * 100;
          return (
            <div key={s.label} className="min-w-[28px]" style={{ flexBasis: `${w}%`, flexGrow: 0, flexShrink: 1 }}>
              <div className="text-[12px] tabular-nums text-muted-foreground">{Math.round(w)} %</div>
              <div className="ml-px mt-1 h-3 w-px bg-border" />
              <div className={cn("mt-1 h-3 rounded-full", s.className)} title={`${s.label} : ${Math.round(w)} %`} />
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <span className={cn("size-2 rounded-full", s.className)} /> {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
