import { Check, ExternalLink, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { CREATOR_THEMES, mkCreatorTheme, type MkThemeId } from "@/lib/mediakitThemes";

/**
 * Choix du thème de couleurs d'un media kit public (kits créateurs ET deck agence, direction
 * « Éditorial ») : 5 vignettes « page » (papier, nom en serif dans la couleur du thème) + lien
 * d'aperçu (?theme=…) pour voir le rendu AVANT d'enregistrer.
 */
export function MediakitThemePicker({ value, onChange, previewBase }: { value: string | null | undefined; onChange: (id: MkThemeId) => void; previewBase?: string | null }) {
  const cur = mkCreatorTheme(value);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
            <Palette className="h-4 w-4 shrink-0 text-muted-foreground" /> Couleurs du media kit
          </h3>
          <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-muted-foreground">
            Mise en page « Éditorial » (page blanche, grand serif). Le thème change la couleur du nom et des grands chiffres, ou le papier. Site et PDF (régénéré dans l'heure).
          </p>
        </div>
        {previewBase && (
          <a
            href={`${previewBase}?theme=${cur}`}
            target="_blank"
            rel="noreferrer"
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Aperçu en {CREATOR_THEMES.find((t) => t.id === cur)?.label}
          </a>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {CREATOR_THEMES.map((t) => {
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
              {/* Vignette : une page avec le nom en serif (couleur du thème) et deux lignes d'encre */}
              <span className="relative flex h-14 items-center gap-2.5 px-3" style={{ background: t.paper }}>
                <span className="font-serif text-[24px] italic leading-none" style={{ color: t.accent, fontFamily: "'Instrument Serif', Georgia, serif" }}>Aa</span>
                <span className="flex flex-1 flex-col gap-1">
                  <span className="h-[3px] w-4/5 rounded-full opacity-70" style={{ background: t.ink }} />
                  <span className="h-[3px] w-3/5 rounded-full opacity-35" style={{ background: t.ink }} />
                </span>
                {on && (
                  <span className="absolute right-2 top-1.5 grid h-4 w-4 place-items-center rounded-full bg-foreground text-background">
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
