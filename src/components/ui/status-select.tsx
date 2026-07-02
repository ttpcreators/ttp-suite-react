import { useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatusOption = { value: string; label: string; dot: string };

/**
 * Sélecteur de statut compact avec pastille colorée (visible dans le bouton ET
 * dans le menu). Contrôlé, sans dépendance externe.
 */
export function StatusSelect({
  value,
  options,
  onChange,
  className,
}: {
  value: string;
  options: StatusOption[];
  onChange: (v: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.value === value) ?? options[0];

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] text-foreground outline-none transition-colors hover:bg-rowhover focus:border-primary"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("size-1.5 shrink-0 rounded-full", cur?.dot)} />
          <span className="truncate">{cur?.label ?? "—"}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 rounded-lg border border-border bg-surface p-1 shadow-xl">
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(o.value);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-rowhover"
              >
                <span className={cn("size-1.5 shrink-0 rounded-full", o.dot)} />
                <span className="truncate">{o.label}</span>
                {o.value === value && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
