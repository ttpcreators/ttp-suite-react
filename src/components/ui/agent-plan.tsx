import { useState, type ReactNode } from "react";
import { CheckCircle2, Circle, CircleDotDashed, ChevronRight, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Liste de tâches « plan » (inspirée d'agent-plan) : chaque tâche a une icône de
 * statut qui cycle au clic (À faire → En cours → Fait), se déplie sur ses
 * sous-tâches en ligne (trait de liaison pointillé), chaque sous-tâche se coche.
 * App-native (motion/react via le parent, tokens), réutilisable agence + créateur.
 */

export type PlanSubtask = { id: string; text: string; done: boolean };
export type PlanTask = {
  id: string;
  title: string;
  status: string; // "À faire" | "En cours" | "Fait"
  done?: boolean; // barré si vrai (dérivé de "Fait")
  accent?: string; // classe de couleur de la barre d'accent (priorité)
  meta?: ReactNode; // ligne méta sous le titre
  right?: ReactNode; // zone droite (pilule priorité + menu)
  footer?: ReactNode; // bloc sous la carte (ex : commentaire d'avancement agence)
  subtasks: PlanSubtask[];
};

function StatusIcon({ status, className }: { status: string; className?: string }) {
  if (status === "Fait") return <CheckCircle2 className={cn("text-emerald-500", className)} />;
  if (status === "En cours") return <CircleDotDashed className={cn("text-primary", className)} />;
  return <Circle className={cn("text-faint", className)} />;
}

export function AgentPlan({
  tasks,
  onCycleStatus,
  onToggleSubtask,
  onAddSubtask,
  onDelSubtask,
  onOpenTask,
  defaultExpandedId,
}: {
  tasks: PlanTask[];
  onCycleStatus: (id: string) => void;
  onToggleSubtask: (taskId: string, subId: string) => void;
  onAddSubtask: (taskId: string, text: string) => void;
  onDelSubtask: (taskId: string, subId: string) => void;
  /** Clic sur le titre → ouvre la fiche détail (description, pièces jointes…). */
  onOpenTask?: (id: string) => void;
  defaultExpandedId?: string;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(defaultExpandedId ? { [defaultExpandedId]: true } : {});
  const [input, setInput] = useState<Record<string, string>>({});

  return (
    <ul className="flex flex-col gap-2.5">
      {tasks.map((task) => {
        const open = !!expanded[task.id];
        const subs = task.subtasks ?? [];
        const subDone = subs.filter((s) => s.done).length;
        return (
          <li key={task.id} className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-sm transition-shadow hover:shadow-md">
            {task.accent && <span className={cn("absolute left-0 top-0 h-full w-1", task.accent)} />}

            {/* Ligne tâche */}
            <div className="flex items-start gap-2.5 py-3 pl-4 pr-3">
              {/* Icône de statut (cycle au clic) */}
              <button
                type="button"
                onClick={() => onCycleStatus(task.id)}
                title={`Statut : ${task.status} — cliquer pour changer`}
                className="mt-0.5 shrink-0 rounded-full transition-transform hover:scale-110 active:scale-95"
              >
                <StatusIcon status={task.status} className="h-[18px] w-[18px]" />
              </button>

              {/* Titre + méta (clic titre = fiche ; clic zone = déplier) */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => (onOpenTask ? onOpenTask(task.id) : setExpanded((e) => ({ ...e, [task.id]: !e[task.id] })))}
                    className={cn("min-w-0 flex-1 truncate text-left text-sm font-semibold text-foreground", task.done && "text-muted-foreground line-through")}
                  >
                    {task.title}
                  </button>
                </div>
                {task.meta && <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-faint">{task.meta}</div>}
              </div>

              {/* Chevron déplier sous-tâches */}
              <button
                type="button"
                onClick={() => setExpanded((e) => ({ ...e, [task.id]: !e[task.id] }))}
                aria-label={open ? "Replier" : "Déplier"}
                aria-expanded={open}
                className="mt-0.5 flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-faint transition-colors hover:bg-rowhover hover:text-foreground"
              >
                {subs.length > 0 && <span className="text-[10px] font-semibold tabular-nums">{subDone}/{subs.length}</span>}
                <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} strokeWidth={2} />
              </button>

              {/* Zone droite (pilule priorité + menu) */}
              {task.right && <div className="mt-0.5 flex shrink-0 items-center gap-1.5">{task.right}</div>}
            </div>

            {/* Sous-tâches en ligne (trait de liaison pointillé) */}
            <div className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-in-out", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
              <div className="min-h-0 overflow-hidden">
                <div className="relative ml-[26px] mb-2.5 mr-3 mt-0.5 border-l-2 border-dashed border-border pl-3">
                  <div className="flex flex-col gap-1">
                    {subs.map((s) => (
                      <div key={s.id} className="group flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-rowhover/60">
                        <button type="button" onClick={() => onToggleSubtask(task.id, s.id)} className="shrink-0 rounded-full transition-transform hover:scale-110" aria-label={s.done ? "Décocher" : "Cocher"}>
                          {s.done ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Circle className="h-4 w-4 text-faint" />}
                        </button>
                        <span className={cn("min-w-0 flex-1 break-words text-[13px]", s.done ? "text-faint line-through" : "text-foreground")}>{s.text}</span>
                        <button type="button" onClick={() => onDelSubtask(task.id, s.id)} className="shrink-0 text-faint opacity-0 transition-opacity hover:text-[#E5484D] group-hover:opacity-100" aria-label="Supprimer">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const t = (input[task.id] ?? "").trim();
                        if (!t) return;
                        onAddSubtask(task.id, t);
                        setInput((v) => ({ ...v, [task.id]: "" }));
                      }}
                      className="mt-1 flex items-center gap-2"
                    >
                      <input
                        value={input[task.id] ?? ""}
                        onChange={(e) => setInput((v) => ({ ...v, [task.id]: e.target.value }))}
                        placeholder="Ajouter une sous-tâche…"
                        className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] outline-none focus:border-primary"
                      />
                      <button type="submit" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90" aria-label="Ajouter">
                        <Plus className="h-4 w-4" />
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            </div>

            {task.footer}
          </li>
        );
      })}
    </ul>
  );
}

export default AgentPlan;
