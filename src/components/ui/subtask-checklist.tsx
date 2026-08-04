import { useState } from "react";
import { Check, Trash2, Plus, ChevronRight, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Checklist de sous-tâches réutilisable (idées, et potentiellement d'autres
 * objets). Repliable pour garder les cartes compactes. Le composant gère la
 * saisie / le toggle / la suppression en local et remonte le tableau complet
 * via `onChange` — au parent de persister (dbUpdate…).
 */

export type Subtask = { id: string; text: string; done: boolean };

let _sid = 0;
const newId = () => `st${Date.now().toString(36)}${(_sid += 1)}`;

export function SubtaskChecklist({
  value,
  onChange,
  label = "Sous-tâches",
  className,
}: {
  value: Subtask[];
  onChange: (next: Subtask[]) => void;
  label?: string;
  className?: string;
}) {
  const subs = value ?? [];
  const done = subs.filter((s) => s.done).length;
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");

  const add = () => {
    const t = input.trim();
    if (!t) return;
    setInput("");
    onChange([...subs, { id: newId(), text: t, done: false }]);
  };
  const toggle = (id: string) => onChange(subs.map((s) => (s.id === id ? { ...s, done: !s.done } : s)));
  const del = (id: string) => onChange(subs.filter((s) => s.id !== id));

  return (
    <div className={cn("rounded-xl border border-border bg-panel/40", className)}>
      {/* En-tête repliable : compteur + barre de progression */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ListChecks className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">{label}</span>
        {subs.length > 0 && (
          <>
            <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{done}/{subs.length}</span>
            <span className="mx-1 hidden h-1.5 flex-1 overflow-hidden rounded-full bg-panel sm:block">
              <span className="block h-full rounded-full bg-primary transition-all" style={{ width: `${(done / subs.length) * 100}%` }} />
            </span>
          </>
        )}
        <ChevronRight className={cn("ml-auto h-4 w-4 shrink-0 text-faint transition-transform", open && "rotate-90")} />
      </button>

      {open && (
        <div className="flex flex-col gap-1.5 px-3 pb-3">
          {subs.length > 0 && (
            <div className="mb-0.5 h-1.5 w-full overflow-hidden rounded-full bg-panel sm:hidden">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(done / subs.length) * 100}%` }} />
            </div>
          )}
          {subs.map((s) => (
            <div key={s.id} className="group flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5">
              <button
                type="button"
                onClick={() => toggle(s.id)}
                className={cn(
                  "grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors",
                  s.done ? "border-primary bg-primary text-primary-foreground" : "border-faint",
                )}
                aria-label={s.done ? "Décocher" : "Cocher"}
              >
                {s.done && <Check className="h-3 w-3" />}
              </button>
              <span className={cn("min-w-0 flex-1 break-words text-[13px]", s.done ? "text-faint line-through" : "text-foreground")}>{s.text}</span>
              <button type="button" onClick={() => del(s.id)} className="shrink-0 text-faint opacity-0 transition-opacity hover:text-[#E5484D] group-hover:opacity-100" aria-label="Supprimer">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <form onSubmit={(e) => { e.preventDefault(); add(); }} className="mt-1 flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ajouter une sous-tâche…"
              className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] outline-none focus:border-primary"
            />
            <button type="submit" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90" aria-label="Ajouter">
              <Plus className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default SubtaskChecklist;
