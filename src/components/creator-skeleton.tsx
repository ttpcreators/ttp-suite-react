import { cn } from "@/lib/utils";

/*
 * Squelettes gris à la forme du contenu (espace créateur) : jamais d'écran blanc ni de
 * roue seule pendant le premier chargement. Pulsation douce, coupée si l'appareil
 * demande moins d'animations.
 */
const bar = "rounded-full bg-field motion-safe:animate-pulse";

/** Une carte : titre, deux lignes, et un bouton si `action`. */
export function SkeletonCard({ action = false, className }: { action?: boolean; className?: string }) {
  return (
    <div aria-hidden className={cn("flex flex-col gap-3 rounded-[20px] bg-surface p-4 shadow-sm", className)}>
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 shrink-0 rounded-[12px] bg-field motion-safe:animate-pulse" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className={cn(bar, "h-3.5 w-2/5")} />
          <div className={cn(bar, "h-3 w-3/5")} />
        </div>
      </div>
      {action && <div className={cn(bar, "h-11 w-full")} />}
    </div>
  );
}

/** Plusieurs cartes, avec un texte lisible par les lecteurs d'écran. */
export function SkeletonList({ count = 3, action = false, label }: { count?: number; action?: boolean; label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} action={action} />
      ))}
    </div>
  );
}

/** Le grand chiffre d'une page (Gains) avec sa ligne de détail. */
export function SkeletonFigure({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3 rounded-[22px] bg-surface p-5 shadow-sm">
      <div className={cn(bar, "h-3.5 w-24")} />
      <div className={cn(bar, "h-10 w-40")} />
      <div className={cn(bar, "h-3 w-52")} />
    </div>
  );
}
