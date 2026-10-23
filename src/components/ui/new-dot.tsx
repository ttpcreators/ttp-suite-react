import { cn } from "@/lib/utils";

/**
 * Repère « nouveau » (src/lib/useActivityEvents.ts) : point bleu devant le titre d'une
 * tâche, d'une idée ou d'un fil qui a reçu du nouveau de l'autre côté. Disparaît à
 * l'ouverture de l'objet.
 */
export function NewDot({ label = "Nouveau", className }: { label?: string; className?: string }) {
  return <span role="img" aria-label={label} title={label} className={cn("inline-block h-2 w-2 shrink-0 rounded-full bg-primary", className)} />;
}
