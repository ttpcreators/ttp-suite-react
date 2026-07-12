import { cn } from "@/lib/utils";
import { Select, SelectTrigger, SelectContent, SelectItem } from "./select";

export type FilterOpt = { value: string; label: string };

/**
 * Barre de filtres responsive : pastilles horizontales sur desktop, sélecteur
 * compact sur mobile (gagne de la place quand il y a beaucoup d'options).
 */
export function FilterBar({
  options,
  value,
  onChange,
  className,
  placeholder = "Filtrer",
}: {
  options: FilterOpt[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
}) {
  return (
    <>
      {/* Mobile : sélecteur compact */}
      <div className={cn("md:hidden", className)}>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="h-9 w-full rounded-full bg-surface" placeholder={placeholder} />
          <SelectContent>
            {options.map((o, i) => (
              <SelectItem key={o.value} index={i} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {/* Desktop : pastilles */}
      <div className={cn("hidden flex-wrap gap-2 md:flex", className)}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors",
              value === o.value
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-surface text-muted-foreground hover:bg-rowhover hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </>
  );
}
