import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Touche de clavier (raccourcis : ⌘ K, J, Échap…). */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-grid h-6 min-w-6 place-items-center rounded-[6px] bg-field px-1.5 font-sans text-[11px] font-semibold leading-none text-foreground/80",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
