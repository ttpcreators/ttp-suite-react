import { Check, ExternalLink, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { MK_THEMES, mkTheme, type MkThemeId } from "@/lib/mediakitThemes";

/**
 * Choix du thème de couleurs d'un media kit public : 5 vignettes (bandeau, feuille,
 * accent) + lien d'aperçu (?theme=…) pour voir le rendu AVANT d'enregistrer.
 */
export function MediakitThemePicker({
  value,
  onChange,
  previewBase,
}: {
  value: string | null | undefined;
  onChange: (id: MkThemeId) => void;
  /** URL publique du media kit (sans paramètre) ; absente = pas de lien d'aperçu. */
  previewBase?: string | null;
}) {
  const cur = mkTheme(value);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
            <Palette className="h-4 w-4 shrink-0 text-muted-foreground" /> Couleurs du media kit
          </h3>
          <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-muted-foreground">
            S'applique à la page web et au PDF (régénéré dans l'heure). Choisis, vérifie avec l'aperçu, puis clique « Enregistrer ».
          </p>
        </div>
        {previewBase && (
          <a
            href={`${previewBase}?theme=${cur}`}
            target="_blank"
            rel="noreferrer"
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Aperçu en {MK_THEMES.find((t) => t.id === cur)?.label}
          </a>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {MK_THEMES.map((t) => {
          const on = t.id === cur;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange(t.id)}
              aria-pressed={on}
              className={cn(
                "flex flex-col overflow-hidden rounded-xl border text-left transition-colors",
                on ? "border-foreground" : "border-border hover:border-foreground/30",
              )}
            >
              {/* Vignette : bandeau foncé + feuille + trait d'accent */}
              <span className="relative block h-14" style={{ background: t.paper }}>
                <span className="absolute inset-x-0 top-0 h-6" style={{ background: t.deep }} />
                <span className="absolute bottom-3 left-3 h-1 w-8 rounded-full" style={{ background: t.accent }} />
                <span className="absolute bottom-3 left-12 h-1 w-10 rounded-full opacity-40" style={{ background: t.id === "minuit" ? "#fafafa" : t.deep }} />
                {on && (
                  <span className="absolute right-2 top-1.5 grid h-4 w-4 place-items-center rounded-full bg-white text-black">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                )}
              </span>
              <span className="border-t border-border px-3 py-2">
                <span className="block text-[13px] font-medium text-foreground">{t.label}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{t.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
