import type { ReactNode } from "react";
import { Check } from "@/components/icons";
import { cn } from "@/lib/utils";

/*
 * Briques communes des deux pages « À faire » (agence : src/views/Todo.tsx, créateur :
 * src/components/CreatorTodos.tsx) : même rond à cocher, même ligne d'info de fiche.
 */

/** Rond à cocher d'une tâche : contour orange si priorité haute, gris sinon ; plein si faite. */
export function DoneCircle({ done, high, onToggle, size = "md", labels = ["Rouvrir la tâche", "Marquer comme faite"] }: { done: boolean; high: boolean; onToggle: () => void; size?: "md" | "lg"; labels?: [string, string] }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-label={done ? labels[0] : labels[1]}
      title={done ? labels[0] : labels[1]}
      className={cn(
        // Zone de toucher agrandie à 44 px (invisible), le rond garde sa taille.
        "group/c relative grid shrink-0 place-items-center rounded-full transition-[transform,background-color,border-color] active:scale-90 before:absolute before:-inset-2.5 before:content-['']",
        size === "lg" ? "h-7 w-7" : "h-6 w-6",
        done ? "bg-primary text-primary-foreground" : cn("border-2 text-muted-foreground hover:bg-rowhover", high ? "border-priority" : "border-faint"),
      )}
    >
      <Check
        className={cn(size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5", !done && "opacity-0 transition-opacity group-hover/c:opacity-60")}
        strokeWidth={3}
      />
    </button>
  );
}

/** Ligne de la carte d'infos de la fiche : libellé à gauche, valeur à droite. */
export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 px-3.5 py-2">
      <dt className="shrink-0 text-[13px] text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-2 text-right text-[13px] text-foreground">{children}</dd>
    </div>
  );
}
