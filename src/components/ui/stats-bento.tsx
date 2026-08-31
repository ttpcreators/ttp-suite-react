import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Grille « bento » de stats (portée native depuis le composant 21st.dev) : une
 * tuile principale mise en avant (fond primary + texture diagonale), une tuile à
 * mini-barres, une petite tuile chiffre, et une tuile accent avec icône.
 *
 * Data-driven & réutilisable — tokens app, dark-mode natif, pas de dépendances.
 * Responsive : empilé sur mobile, grille 6×2 dès md.
 */

export type StatsBentoProps = {
  primary: { eyebrow: string; value: string; caption?: string };
  /** Tuile à barres : un intitulé, une valeur en avant, et la série à tracer. */
  bars: { label: string; value: string; series: number[] };
  small: { value: string; label: string };
  accent: { value: string; label: string; icon?: LucideIcon };
  className?: string;
};

export function StatsBento({ primary, bars, small, accent, className }: StatsBentoProps) {
  const max = Math.max(1, ...bars.series);
  const AccentIcon = accent.icon;
  return (
    <div className={cn("grid grid-cols-1 gap-3 md:grid-cols-6 md:grid-rows-[auto_auto]", className)}>
      {/* Tuile principale */}
      <div className="relative flex min-h-[180px] flex-col justify-between overflow-hidden rounded-3xl bg-primary p-7 md:col-span-3 md:row-span-2">
        <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(45deg,rgba(255,255,255,0.6)_0px_1px,transparent_1px_11px)] opacity-20 [mask-image:radial-gradient(ellipse_80%_60%_at_100%_0%,#000_55%,transparent_110%)]" />
        <div className="relative">
          <span className="inline-block rounded-full bg-primary-foreground/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-primary-foreground/70">
            {primary.eyebrow}
          </span>
          <h3 className="mt-5 text-4xl font-bold tracking-tight text-primary-foreground sm:text-5xl">{primary.value}</h3>
        </div>
        {primary.caption && <p className="relative mt-4 max-w-xs text-sm text-primary-foreground/70">{primary.caption}</p>}
      </div>

      {/* Tuile à barres */}
      <div className="flex items-center justify-between gap-4 rounded-3xl border border-border bg-panel p-6 md:col-span-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{bars.label}</p>
          <p className="mt-1 truncate text-2xl font-bold tracking-tight text-foreground">{bars.value}</p>
        </div>
        <div className="flex h-10 shrink-0 items-end gap-1">
          {bars.series.map((h, i) => (
            <div
              key={i}
              className="w-1.5 rounded-full bg-primary"
              style={{ height: `${Math.max(6, (h / max) * 100)}%` }}
            />
          ))}
        </div>
      </div>

      {/* Petite tuile chiffre */}
      <div className="flex min-h-[88px] flex-col justify-center rounded-3xl border border-border bg-card p-6 text-center md:col-span-1">
        <p className="text-2xl font-bold text-foreground">{small.value}</p>
        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{small.label}</p>
      </div>

      {/* Tuile accent (icône + texte) */}
      <div className="flex min-h-[88px] items-center gap-4 rounded-3xl border border-border bg-panel p-6 md:col-span-2">
        {AccentIcon && (
          <div className="grid size-10 shrink-0 place-items-center rounded-full bg-surface text-foreground shadow-sm">
            <AccentIcon className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{accent.value}</p>
          <p className="mt-0.5 text-[11px] font-semibold text-muted-foreground">{accent.label}</p>
        </div>
      </div>
    </div>
  );
}

export default StatsBento;
