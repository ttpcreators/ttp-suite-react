import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Circle, Clock, Pencil, Plus, Repeat, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { DashPanel } from "@/components/ui/dash";
import { ActionMenu } from "@/components/ui/action-menu";
import { dbInsert, dbUpdate, nextOrder } from "@/lib/db";
import { dbTrash } from "@/lib/trash";
import { useLiveKey } from "@/lib/useLive";
import { myDisplayName } from "@/lib/team";
import { doneThisWeek, weekStart, type Routine } from "@/lib/routines";

/*
 * To-do « Chaque semaine » : les tâches qui reviennent toutes les semaines.
 * Un clic sur le rond = « Fait » (date + qui, gardés dans l'historique). La
 * semaine suivante (lundi), la tâche redevient à faire toute seule.
 */

const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const fmtDone = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
};
/** Jour de la semaine d'aujourd'hui : 1 = lundi … 7 = dimanche. */
const todayIndex = () => ((new Date().getDay() + 6) % 7) + 1;

function DaySelect({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className="h-9 rounded-lg border border-border bg-surface px-2.5 text-[13px] text-foreground outline-none focus:border-primary"
      aria-label="Jour"
    >
      <option value="">N'importe quel jour</option>
      {DAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
    </select>
  );
}

export function WeeklyRoutines({ addSignal = 0 }: { addSignal?: number }) {
  const live = useLiveKey();
  const [rows, setRows] = useState<Routine[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [day, setDay] = useState<number | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editDay, setEditDay] = useState<number | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("todo_routines").select("*").order("sort_order");
    if (error) {
      setMissing(true);
      setRows([]);
      return;
    }
    setMissing(false);
    setRows((data ?? []) as Routine[]);
  }, []);
  useEffect(() => {
    void load();
  }, [load, live]);

  // « + Tâche → Chaque semaine » : ouvre l'ajout et amène la section à l'écran.
  useEffect(() => {
    if (!addSignal) return;
    setOpen(true);
    setAdding(true);
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [addSignal]);

  const add = async () => {
    const t = text.trim();
    if (!t) return;
    const created = await dbInsert("todo_routines", { text: t, weekday: day, sort_order: nextOrder(rows ?? []) });
    if (!created) return toast("Non enregistré : lance d'abord le SQL « équipe, activité, routines ».");
    setRows((l) => [...(l ?? []), created as unknown as Routine]);
    setText("");
    setDay(null);
    toast("Tâche hebdomadaire ajoutée ✓");
  };

  /** Rond cliqué : « Fait » cette semaine (avec date et prénom), ou annulation. */
  const toggle = async (r: Routine) => {
    if (busy) return;
    setBusy(r.id);
    const log = Array.isArray(r.done_log) ? r.done_log : [];
    const undo = doneThisWeek(r);
    const next = undo ? log.slice(0, -1) : [...log, { at: new Date().toISOString(), by: await myDisplayName() }].slice(-100);
    const ok = await dbUpdate("todo_routines", r.id, { done_log: next });
    setBusy(null);
    if (!ok) return toast("Non enregistré, réessaie");
    setRows((l) => (l ?? []).map((x) => (x.id === r.id ? { ...x, done_log: next } : x)));
    toast(undo ? "Remise à faire pour cette semaine" : "Fait ✓ C'est noté avec la date");
  };

  const saveEdit = async (r: Routine) => {
    const t = editText.trim();
    if (!t) return;
    if (!(await dbUpdate("todo_routines", r.id, { text: t, weekday: editDay }))) return toast("Non enregistré, réessaie");
    setRows((l) => (l ?? []).map((x) => (x.id === r.id ? { ...x, text: t, weekday: editDay } : x)));
    setEditId(null);
  };

  const remove = async (r: Routine) => {
    if (await dbTrash("todo_routines", r.id, r.text)) {
      setRows((l) => (l ?? []).filter((x) => x.id !== r.id));
      toast("Déplacée dans la corbeille");
    } else toast("Erreur, réessaie");
  };

  if (rows === null) return null;
  const list = rows;
  const doneCount = list.filter((r) => doneThisWeek(r)).length;
  const today = todayIndex();
  const since = weekStart();

  return (
    <div ref={ref} className="mb-4 scroll-mt-4">
      <DashPanel className="overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
          <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open}>
            <Repeat className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="shrink-0 text-[14px] font-semibold text-foreground">Chaque semaine</span>
            {!missing && list.length > 0 && (
              <span className={cn("min-w-0 truncate text-[12px]", doneCount === list.length ? "text-signaltext" : "text-muted-foreground")}>
                · {doneCount} / {list.length} faite{doneCount > 1 ? "s" : ""} cette semaine
              </span>
            )}
            <ChevronDown className={cn("h-4 w-4 shrink-0 text-faint transition-transform", open && "rotate-180")} />
          </button>
          {!missing && (
            <button type="button" onClick={() => { setOpen(true); setAdding((v) => !v); }}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[12px] font-semibold text-foreground transition-colors hover:bg-rowhover">
              <Plus className="h-3.5 w-3.5" /> <span className="max-sm:hidden">Ajouter</span>
            </button>
          )}
        </div>

        {open && (
          <div className="border-t border-border">
            {missing ? (
              <p className="px-4 py-4 text-[12px] text-muted-foreground sm:px-5">
                Les tâches qui reviennent chaque semaine arrivent ici dès que le SQL « équipe, activité, routines » est lancé dans Supabase.
              </p>
            ) : (
              <>
                {adding && (
                  <div className="flex flex-col gap-2 border-b border-border bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                    <input
                      autoFocus
                      value={text}
                      onChange={(e) => setText(e.target.value.slice(0, 300))}
                      onKeyDown={(e) => e.key === "Enter" && void add()}
                      placeholder="Ex. Mettre à jour les stats des créatrices"
                      className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-[13px] text-foreground outline-none placeholder:text-faint focus:border-primary"
                    />
                    <div className="flex gap-2">
                      <DaySelect value={day} onChange={setDay} />
                      <button type="button" onClick={() => void add()} disabled={!text.trim()}
                        className="h-9 shrink-0 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
                        Ajouter
                      </button>
                    </div>
                  </div>
                )}
                {list.length === 0 && !adding ? (
                  <p className="px-4 py-4 text-[12px] text-muted-foreground sm:px-5">
                    Ajoute ici ce que tu refais chaque semaine : plus besoin de le réécrire, ça revient tout seul chaque lundi.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {list.map((r) => {
                      const log = Array.isArray(r.done_log) ? r.done_log : [];
                      const done = doneThisWeek(r);
                      const last = log[log.length - 1];
                      const late = !done && r.weekday != null && r.weekday < today;
                      const isToday = !done && r.weekday === today;
                      if (editId === r.id) {
                        return (
                          <li key={r.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                            <input value={editText} onChange={(e) => setEditText(e.target.value.slice(0, 300))} onKeyDown={(e) => e.key === "Enter" && void saveEdit(r)}
                              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-[13px] text-foreground outline-none focus:border-primary" />
                            <div className="flex gap-2">
                              <DaySelect value={editDay} onChange={setEditDay} />
                              <button type="button" onClick={() => void saveEdit(r)} className="h-9 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground">Enregistrer</button>
                              <button type="button" onClick={() => setEditId(null)} aria-label="Annuler" className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-rowhover"><X className="h-4 w-4" /></button>
                            </div>
                          </li>
                        );
                      }
                      return (
                        <li key={r.id} className="px-4 py-3 sm:px-5">
                          <div className="flex items-start gap-3">
                            <button type="button" onClick={() => void toggle(r)} disabled={busy === r.id}
                              aria-label={done ? "Annuler le « Fait » de cette semaine" : "Marquer fait cette semaine"}
                              className="mt-0.5 shrink-0 transition-transform active:scale-90 disabled:opacity-50">
                              {done ? <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-500 text-white"><Check className="h-3.5 w-3.5" /></span>
                                : <Circle className="h-5 w-5 text-faint hover:text-foreground" />}
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className={cn("text-[13px] font-medium [overflow-wrap:anywhere]", done ? "text-muted-foreground line-through decoration-faint" : "text-foreground")}>{r.text}</span>
                                {r.weekday != null && (
                                  <span className={cn("rounded-full px-2 py-px text-[11px] font-medium",
                                    late ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : isToday ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                                    {isToday ? "Aujourd'hui" : DAYS[r.weekday - 1]}{late ? " · en retard" : ""}
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 text-[12px] text-muted-foreground">
                                {done && last ? <span className="text-signaltext">Fait {fmtDone(last.at)}{last.by ? ` · ${last.by}` : ""}</span>
                                  : last ? <>À faire cette semaine · dernière fois {fmtDone(last.at)}{last.by ? ` · ${last.by}` : ""}</>
                                  : "À faire cette semaine · jamais fait pour l'instant"}
                              </p>
                              {history === r.id && (
                                <ol className="mt-2 flex flex-col gap-1 border-l border-border pl-3">
                                  {[...log].reverse().slice(0, 12).map((e) => (
                                    <li key={e.at} className={cn("text-[12px]", new Date(e.at) >= since ? "text-foreground" : "text-muted-foreground")}>
                                      {fmtDone(e.at)}{e.by ? ` · ${e.by}` : ""}
                                    </li>
                                  ))}
                                  {log.length === 0 && <li className="text-[12px] text-faint">Pas encore d'historique.</li>}
                                </ol>
                              )}
                            </div>
                            <button type="button" onClick={() => setHistory((h) => (h === r.id ? null : r.id))}
                              className={cn("inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors hover:bg-rowhover", history === r.id ? "text-foreground" : "text-muted-foreground")}
                              title="Historique des « Fait »">
                              <Clock className="h-3.5 w-3.5" /> <span className="max-sm:hidden">Historique</span> {log.length > 0 && <span className="tabular-nums text-faint">{log.length}</span>}
                            </button>
                            <ActionMenu
                              items={[
                                { key: "edit", label: "Modifier", icon: Pencil, onClick: () => { setEditId(r.id); setEditText(r.text); setEditDay(r.weekday ?? null); } },
                                { key: "delete", label: "Supprimer", icon: Trash2, danger: true, onClick: () => void remove(r), confirm: { title: "Supprimer la tâche hebdomadaire", message: `Supprimer « ${r.text} » ? Tu pourras la restaurer depuis la corbeille.` } },
                              ]}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
      </DashPanel>
    </div>
  );
}
