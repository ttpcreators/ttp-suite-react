import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Bandeau de chiffres clés, dans le langage de l'Aperçu : UN panneau bordé,
 * quatre cellules séparées par des filets, libellé gris en minuscules au-dessus
 * d'un gros chiffre. (Anciennement une grille « bento » avec tuile bleue ; l'API
 * est restée identique, donc toutes les pages qui l'utilisent ont basculé seules.)
 *
 *   primary → chiffre principal + légende
 *   bars    → chiffre + mini-barres de répartition (monochromes, max en valeur)
 *   small   → chiffre simple
 *   accent  → chiffre avec icône
 *
 * Responsive : 2 colonnes sur mobile, 4 dès lg. Tokens uniquement (clair/sombre).
 */

export type StatsBentoProps = {
  primary: { eyebrow: string; value: string; caption?: string };
  /** Cellule à barres : un intitulé, une valeur en avant, et la série à tracer. */
  bars: { label: string; value: string; series: number[] };
  small: { value: string; label: string };
  accent: { value: string; label: string; icon?: LucideIcon };
  className?: string;
};

const cell = "flex min-w-0 flex-col px-5 py-5";
const label = "truncate text-[13px] text-muted-foreground";
const big = "mt-2 truncate text-[26px] font-semibold leading-none tracking-tight tabular-nums text-foreground";

export function StatsBento({ primary, bars, small, accent, className }: StatsBentoProps) {
  const max = Math.max(1, ...bars.series.filter((n) => Number.isFinite(n)));
  const top = bars.series.indexOf(Math.max(...bars.series));
  const AccentIcon = accent.icon;
  return (
    <section className={cn("grid grid-cols-2 overflow-hidden rounded-2xl border border-border bg-surface lg:grid-cols-4", className)}>
      {/* Chiffre principal */}
      <div className={cell}>
        <span className={label}>{primary.eyebrow}</span>
        <span className={big}>{primary.value}</span>
        {primary.caption && <span className="mt-3 line-clamp-2 text-[12px] leading-snug text-muted-foreground">{primary.caption}</span>}
      </div>

      {/* Répartition (mini-barres) */}
      <div className={cn(cell, "border-l border-border")}>
        <span className={label}>{bars.label}</span>
        <div className="mt-2 flex items-end justify-between gap-3">
          <span className="truncate text-[26px] font-semibold leading-none tracking-tight tabular-nums text-foreground">{bars.value}</span>
          <div className="flex h-8 shrink-0 items-end gap-[3px]" aria-hidden>
            {bars.series.map((h, i) => (
              <span
                key={i}
                className={cn("w-1.5 rounded-full", i === top ? "bg-foreground/70" : "bg-foreground/20")}
                style={{ height: `${Math.max(12, ((Number.isFinite(h) ? h : 0) / max) * 100)}%` }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Chiffre simple */}
      <div className={cn(cell, "border-t border-border lg:border-l lg:border-t-0")}>
        <span className={label}>{small.label}</span>
        <span className={big}>{small.value}</span>
      </div>

      {/* Chiffre avec icône */}
      <div className={cn(cell, "border-l border-t border-border lg:border-t-0")}>
        <span className={cn(label, "flex items-center gap-1.5")}>
          {AccentIcon && <AccentIcon className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate">{accent.label}</span>
        </span>
        <span className={big}>{accent.value}</span>
      </div>
    </section>
  );
}

export default StatsBento;
