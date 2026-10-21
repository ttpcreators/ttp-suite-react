import { Search, X } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * Recherche de la page, en pilule (même hauteur que les filtres « Trier : … »).
 * Échap efface. Filtrage : `matchWords` (src/lib/search.ts).
 */
export function PillSearch({ value, onChange, placeholder, className, size = "sm" }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string; size?: "sm" | "md" }) {
  return (
    <div className={cn("relative min-w-[180px] flex-1 sm:max-w-[280px]", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") onChange(""); }}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(
          size === "md" ? "h-10 w-full rounded-xl border bg-surface pl-8 pr-8 text-[13px] font-medium" : "h-8 w-full rounded-full border bg-surface pl-8 pr-8 text-[12px] font-medium",
          "text-foreground outline-none placeholder:font-normal placeholder:text-faint focus:border-primary [&::-webkit-search-cancel-button]:hidden",
          value ? "border-primary/40" : "border-border",
        )}
      />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Effacer la recherche" className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-faint hover:bg-rowhover hover:text-foreground">
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
