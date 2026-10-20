import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { TrendBar } from "@/lib/objectivesTrend";

/**
 * « Réussite mois par mois » : une barre arrondie par mois (accent = var(--primary)),
 * la valeur au-dessus, le mois dessous, une ligne pointillée à 100 % (« Objectif
 * atteint ») et un axe 0 / 50 / 100 %. Le mois courant sans objectif est une barre
 * vide en pointillés « À définir ». Pur HTML/CSS (plus de recharts ici) : léger,
 * lisible en clair comme en sombre (jetons uniquement).
 * Mobile : seules les 6 dernières barres, pour ne jamais déborder à 390 px.
 */

/** Bandeau du haut (légende + valeurs des barres pleines), zone des barres, bandeau des mois. */
const TOP = 54;
const PLOT = 150;
const BOTTOM = 26;
const MOBILE_BARS = 6;

export type ChartBar = TrendBar & { label: string; title: string };

export default function ObjectivesTrend({
  bars,
  selected,
  onSelect,
}: {
  bars: ChartBar[];
  selected?: string;
  onSelect?: (month: string) => void;
}) {
  // Les barres montent depuis 0 à l'affichage (instantané si « moins d'animations »).
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const yTicks = [100, 50, 0];
  const yOf = (pct: number) => TOP + PLOT - (PLOT * pct) / 100;

  return (
    <div className="mt-4 flex gap-2" style={{ height: TOP + PLOT + BOTTOM }}>
      {/* Axe Y : 0 / 50 / 100 % */}
      <div className="relative w-9 shrink-0" aria-hidden>
        {yTicks.map((t) => (
          <span
            key={t}
            className="absolute right-0 -translate-y-1/2 whitespace-nowrap text-[11px] tabular-nums"
            style={{ top: yOf(t), color: "var(--faint)" }}
          >
            {t}&nbsp;%
          </span>
        ))}
      </div>

      <div className="relative min-w-0 flex-1">
        {/* Légende de la ligne 100 % */}
        <div
          className="absolute right-0 top-0 flex items-center gap-1.5 text-[11px]"
          style={{ color: "var(--faint)" }}
          aria-hidden
        >
          <span className="inline-block w-4 border-t-2 border-dashed border-faint/70" />
          Objectif atteint
        </div>
        {/* Grille : 100 % pointillé, 50 % léger, ligne de base */}
        <div className="absolute inset-x-0 border-t-2 border-dashed border-faint/50" style={{ top: yOf(100) }} aria-hidden />
        <div className="absolute inset-x-0 border-t border-border/60" style={{ top: yOf(50) }} aria-hidden />
        <div className="absolute inset-x-0 border-t border-border" style={{ top: yOf(0) }} aria-hidden />

        {/* Barres */}
        <ul className="absolute inset-0 flex gap-1.5 sm:gap-3">
          {bars.map((b, i) => {
            const isSel = b.month === selected;
            const h = b.empty ? PLOT : grown ? Math.max(3, (PLOT * b.pct) / 100) : 3;
            const valueText = b.empty ? "À définir" : `${b.pct} %`;
            return (
              <li
                key={b.month}
                className={cn("relative min-w-0 flex-1", i < bars.length - MOBILE_BARS && "hidden sm:block")}
              >
                <button
                  type="button"
                  onClick={() => onSelect?.(b.month)}
                  aria-label={`${b.title} : ${b.empty ? "à définir" : `${b.pct} % atteint en moyenne`}`}
                  aria-pressed={isSel}
                  className="group absolute inset-0 rounded-[12px] transition-colors hover:bg-rowhover/60 focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {/* Valeur au-dessus de la barre */}
                  <span
                    className={cn(
                      "absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold tabular-nums transition-[bottom] duration-500 ease-out sm:text-[12px]",
                      b.empty ? "text-faint" : "text-foreground",
                    )}
                    style={{ bottom: BOTTOM + h + 6 }}
                  >
                    {valueText}
                  </span>
                  {/* La barre */}
                  <span
                    className={cn(
                      "absolute left-1/2 w-[72%] max-w-[44px] -translate-x-1/2 rounded-[10px] transition-[height] duration-500 ease-out",
                      b.empty ? "border-2 border-dashed border-faint/50 bg-transparent" : "bg-primary",
                    )}
                    style={{ bottom: BOTTOM, height: h }}
                  />
                  {/* Mois dessous */}
                  <span
                    className={cn(
                      "absolute inset-x-0 bottom-0 flex items-end justify-center truncate pb-0.5 text-[11px] sm:text-[12px]",
                      isSel ? "font-semibold text-foreground" : "text-faint",
                    )}
                    style={{ height: BOTTOM }}
                  >
                    {b.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
