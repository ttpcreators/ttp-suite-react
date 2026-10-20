import type { ReactNode } from "react";
import { TONE_DOT, TONE_SOFT, type StatusTone } from "@/lib/statusTone";
import { cn } from "@/lib/utils";

/**
 * Pastille de statut unique de l'app (« Payé », « En attente », « En retard »…).
 * Capsule plate, fond teinté, texte de la couleur du statut : un sens par couleur
 * (voir lib/statusTone.ts). `dot` ajoute un point devant le libellé.
 */
export function StatusPill({
  tone,
  children,
  icon,
  dot,
  size = "sm",
  className,
  title,
}: {
  tone: StatusTone;
  children: ReactNode;
  icon?: ReactNode;
  dot?: boolean;
  size?: "xs" | "sm" | "md";
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-semibold leading-none",
        size === "xs" ? "h-5 px-2 text-[11px]" : size === "md" ? "h-7 px-3 text-[13px]" : "h-6 px-2.5 text-[12px]",
        TONE_SOFT[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[tone])} /> : null}
      {icon}
      {children}
    </span>
  );
}
