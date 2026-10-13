import type { ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Petit « ? » qui ouvre une explication au clic (et pas au survol : marche aussi
 * sur téléphone). Pour expliquer un outil, un filtre ou une différence en 2 lignes.
 */
export function HelpTip({ title, children, className, align = "start" }: {
  title: string;
  children: ReactNode;
  className?: string;
  align?: "start" | "center" | "end";
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Aide : ${title}`}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "inline-grid h-4 w-4 shrink-0 place-items-center rounded-full border border-border bg-surface text-[10px] font-semibold leading-none text-muted-foreground transition-colors hover:border-primary hover:text-primary",
            className,
          )}
        >
          ?
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[min(18rem,calc(100vw-2rem))] p-3.5 text-[12px] leading-relaxed">
        <div className="mb-1 text-[13px] font-semibold text-foreground">{title}</div>
        <div className="flex flex-col gap-1.5 text-muted-foreground">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
