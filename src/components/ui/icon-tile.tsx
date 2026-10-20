import type { ReactNode } from "react";
import type { StatusTone } from "@/lib/statusTone";
import { cn } from "@/lib/utils";

/**
 * Tuile d'icône en tête de ligne (facture, appel, tâche, mails…) : carré arrondi gris,
 * icône grise. Direction « sobre » : la couleur ne sert qu'à signaler ce qui demande un
 * geste, orange pour « à relancer / en retard », rouge pour l'argent en retard.
 */
export function IconTile({ tone, children, size = "md", className }: { tone?: StatusTone; children: ReactNode; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center",
        size === "sm" ? "h-8 w-8 rounded-[10px] [&_svg]:h-4 [&_svg]:w-4" : size === "lg" ? "h-14 w-14 rounded-[16px] text-[22px] font-bold [&_svg]:h-6 [&_svg]:w-6" : "h-11 w-11 rounded-[12px] [&_svg]:h-5 [&_svg]:w-5",
        "bg-field",
        tone === "late" ? "text-late" : tone === "wait" ? "text-wait" : "text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
