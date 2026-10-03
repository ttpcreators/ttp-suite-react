import { cn } from "@/lib/utils";
import { Select, SelectTrigger, SelectContent, SelectItem } from "./select";
import { Tabs } from "./animated-tabs";

export type FilterOpt = { value: string; label: string };

/**
 * Barre de filtres responsive : onglets segmentés sur desktop, sélecteur
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
      {/* Desktop : onglets segmentés */}
      <Tabs
        className={cn("hidden md:block", className)}
        size="md"
        label={placeholder}
        wrap
        value={value}
        onValueChange={onChange}
        items={options.map((o) => ({ value: o.value, label: o.label }))}
      />
    </>
  );
}
