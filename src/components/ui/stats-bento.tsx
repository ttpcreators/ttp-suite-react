import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIosPhone } from "@/components/mobile/ios-sheet";

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

const cell = "flex min-w-0 flex-col px-4 py-4 sm:px-5 sm:py-5";
// Libellé : 2 lignes réservées tant que la grille est sur 2 colonnes → les chiffres
// d'une même rangée restent alignés même si un seul libellé passe à la ligne.
const label = "line-clamp-2 min-h-[2lh] text-[12px] leading-snug text-muted-foreground sm:text-[13px] lg:min-h-0";
const big = "mt-2 line-clamp-2 break-words text-[20px] font-semibold leading-tight tracking-tight sm:truncate sm:leading-none tabular-nums text-foreground sm:text-[26px]";

export function StatsBento({ primary, bars, small, accent, className }: StatsBentoProps) {
  const finite = bars.series.filter((n) => Number.isFinite(n));
  const max = Math.max(1, ...finite);
  // Série toute à 0 : aucune barre mise en avant (sinon une barre pleine contredit le « 0 »).
  const empty = !finite.some((n) => n > 0);
  const top = empty ? -1 : bars.series.indexOf(Math.max(...finite));
  const AccentIcon = accent.icon;
  const ios = useIosPhone();
  // Mode iPhone : bandeau compact qu'on fait défiler du doigt (la liste reste visible tout de suite).
  if (ios) {
    const chips: { label: string; value: string; icon?: LucideIcon }[] = [
      { label: primary.eyebrow, value: primary.value },
      { label: bars.label, value: bars.value },
      { label: small.label, value: small.value },
      { label: accent.label, value: accent.value, icon: AccentIcon },
    ];
    return (
      <section className={cn("flex snap-x snap-mandatory gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}>
        {chips.map((c, i) => (
          <div key={i} className="min-w-[128px] max-w-[70%] shrink-0 snap-start rounded-xl border border-border bg-surface px-3.5 py-2.5">
            <div className="flex items-center gap-1 truncate text-[12px] text-muted-foreground">
              {c.icon && <c.icon className="h-3 w-3 shrink-0" />}
              <span className="truncate">{c.label}</span>
            </div>
            <div className="mt-0.5 truncate text-[19px] font-semibold tabular-nums tracking-tight text-foreground">{c.value}</div>
          </div>
        ))}
      </section>
    );
  }
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
        {/* Mobile : barres SOUS le chiffre (sinon il est tronqué dans une case étroite). */}
        <div className="mt-2 flex flex-col items-start gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
          <span className="line-clamp-2 max-w-full break-words text-[20px] font-semibold leading-tight tracking-tight tabular-nums text-foreground sm:truncate sm:text-[26px] sm:leading-none">{bars.value}</span>
          <div className="flex h-6 shrink-0 items-end gap-[3px] sm:h-8" aria-hidden>
            {bars.series.map((h, i) => (
              <span
                key={i}
                className={cn("w-1.5 rounded-full", i === top ? "bg-foreground/70" : h > 0 ? "bg-foreground/20" : "bg-foreground/10")}
                style={{ height: h > 0 && Number.isFinite(h) ? `${Math.max(12, (h / max) * 100)}%` : "3px" }}
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
        <span className={cn(label, "flex items-start gap-1.5")}>
          {AccentIcon && <AccentIcon className="mt-px h-3.5 w-3.5 shrink-0" />}
          <span className="line-clamp-2">{accent.label}</span>
        </span>
        <span className={big}>{accent.value}</span>
      </div>
    </section>
  );
}

export default StatsBento;
