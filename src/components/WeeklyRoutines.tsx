import { useCallback, useEffect, useRef, useState } from "react";
import { Picker } from "@/components/ui/form";
import { Check, ChevronRight, Pencil, Plus, Trash2, X } from "lucide-react";
import { TtpClock } from "@/components/icons/ttp-icons";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { ActionMenu } from "@/components/ui/action-menu";
import { dbInsert, dbUpdate, nextOrder } from "@/lib/db";
import { dbTrash } from "@/lib/trash";
import { useLiveKey } from "@/lib/useLive";
import { myDisplayName } from "@/lib/team";
import { doneThisWeek, weekStart, type Routine } from "@/lib/routines";
import { TONE_SOFT, TONE_TEXT } from "@/lib/statusTone";
import { useStickyState } from "@/lib/useStickyState";

/*
 * To-do « Routines de la semaine » : les tâches qui reviennent toutes les semaines.
 * Un clic sur la case = « Fait » (date + qui, gardés dans l'historique). La
 * semaine suivante (lundi), la tâche redevient à faire toute seule.
 */

const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const fmtDone = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
};
/** « dim. 4 oct. » : jour du dernier « Fait » (l'heure reste dans l'historique). */
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
/** Jour de la semaine d'aujourd'hui : 1 = lundi … 7 = dimanche. */
const todayIndex = () => ((new Date().getDay() + 6) % 7) + 1;

function DaySelect({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <Picker size="sm" ariaLabel="Jour" className="min-w-[170px]" value={value == null ? "" : String(value)} onChange={(v) => onChange(v ? Number(v) : null)}
      options={[{ value: "", label: "N'importe quel jour" }, ...DAYS.map((d, i) => ({ value: String(i + 1), label: d }))]} />
  );
}

export function WeeklyRoutines({ addSignal = 0 }: { addSignal?: number }) {
  const live = useLiveKey();
  const [rows, setRows] = useState<Routine[] | null>(null);
  const [missing, setMissing] = useState(false);
  // Bloc déplié ou replié : retenu sur l'appareil.
  const [openState, setOpenState] = useStickyState("todo:routines", ["ouvert", "replie"] as const, "ouvert");
  const open = openState === "ouvert";
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
    setOpenState("ouvert");
    setAdding(true);
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [addSignal, setOpenState]);

  const add = async () => {
    const t = text.trim();
    if (!t) return;
    const created = await dbInsert("todo_routines", { text: t, weekday: day, sort_order: nextOrder(rows ?? []) });
    if (!created) return toast("Les tâches hebdomadaires ne sont pas encore activées.");
    setRows((l) => [...(l ?? []), created as unknown as Routine]);
    setText("");
    setDay(null);
    toast("Tâche hebdomadaire ajoutée ✓");
  };

  /** Case cochée : « Fait » cette semaine (avec date et prénom), ou annulation. */
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
  const allDone = list.length > 0 && doneCount === list.length;
  const today = todayIndex();
  const since = weekStart();

  return (
    <div ref={ref} className="mb-5 scroll-mt-4">
      <section className="overflow-hidden rounded-[20px] bg-surface">
        <div className="flex items-center gap-2 py-1.5 pl-4 pr-2 sm:pl-5">
          <button type="button" onClick={() => setOpenState(open ? "replie" : "ouvert")} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={open}>
            {/* Petit rond : vide tant qu'il reste des routines, coché quand tout est fait */}
            {allDone ? (
              <span aria-hidden className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            ) : (
              <span aria-hidden className="h-[18px] w-[18px] shrink-0 rounded-full border-2 border-faint" />
            )}
            <span className="min-w-0 flex-1 truncate">
              <span className="text-[15px] font-semibold text-foreground">Routines de la semaine</span>
              {!missing && list.length > 0 && (
                <span className="ml-2 text-[13px] text-muted-foreground max-sm:block max-sm:ml-0 max-sm:text-[12px]">
                  {doneCount} sur {list.length} · repart à zéro lundi
                </span>
              )}
            </span>
            <ChevronRight className={cn("h-4 w-4 shrink-0 text-faint transition-transform", open && "rotate-90")} />
          </button>
          {!missing && (
            <button
              type="button"
              onClick={() => {
                setOpenState("ouvert");
                setAdding((v) => !v);
              }}
              aria-label="Ajouter une routine"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-field px-2.5 text-[12px] font-semibold text-foreground transition-colors hover:bg-rowhover"
            >
              <Plus className="h-3.5 w-3.5" /> <span className="max-sm:hidden">Ajouter</span>
            </button>
          )}
        </div>

        {open && (
          <div className="px-3 pb-3 sm:px-4 sm:pb-4">
            {missing ? (
              <p className="px-1 pb-1 text-[12px] text-muted-foreground">Les tâches hebdomadaires ne sont pas encore activées.</p>
            ) : (
              <>
                {adding && (
                  <div className="mb-2 flex flex-col gap-2 rounded-[14px] bg-panel p-3 sm:flex-row sm:items-center">
                    <input
                      autoFocus
                      value={text}
                      onChange={(e) => setText(e.target.value.slice(0, 300))}
                      onKeyDown={(e) => e.key === "Enter" && void add()}
                      placeholder="Ex. Mettre à jour les stats des créateurs"
                      className="h-9 min-w-0 flex-1 rounded-full border border-border bg-surface px-3.5 text-[13px] text-foreground outline-none placeholder:text-faint focus:border-primary"
                    />
                    <div className="flex gap-2">
                      <DaySelect value={day} onChange={setDay} />
                      <button
                        type="button"
                        onClick={() => void add()}
                        disabled={!text.trim()}
                        className="h-9 shrink-0 rounded-full bg-primary px-3.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                      >
                        Ajouter
                      </button>
                    </div>
                  </div>
                )}
                {list.length === 0 && !adding ? (
                  <p className="px-1 pb-1 text-[12px] text-muted-foreground">
                    Ajoute ici ce que tu refais chaque semaine, sans avoir à le réécrire. Chaque tâche revient toute seule chaque semaine, le jour choisi.
                  </p>
                ) : (
                  <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {list.map((r) => {
                      const log = Array.isArray(r.done_log) ? r.done_log : [];
                      const done = doneThisWeek(r);
                      const last = log[log.length - 1];
                      const late = !done && r.weekday != null && r.weekday < today;
                      const isToday = !done && r.weekday === today;
                      if (editId === r.id) {
                        return (
                          <li key={r.id} className="flex flex-col gap-2 rounded-[14px] bg-panel p-3 sm:flex-row sm:items-center md:col-span-2">
                            <input
                              value={editText}
                              onChange={(e) => setEditText(e.target.value.slice(0, 300))}
                              onKeyDown={(e) => e.key === "Enter" && void saveEdit(r)}
                              className="h-9 min-w-0 flex-1 rounded-full border border-border bg-surface px-3.5 text-[13px] text-foreground outline-none focus:border-primary"
                            />
                            <div className="flex gap-2">
                              <DaySelect value={editDay} onChange={setEditDay} />
                              <button type="button" onClick={() => void saveEdit(r)} className="h-9 rounded-full bg-primary px-3 text-[13px] font-medium text-primary-foreground">
                                Enregistrer
                              </button>
                              <button type="button" onClick={() => setEditId(null)} aria-label="Annuler" className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-rowhover">
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          </li>
                        );
                      }
                      return (
                        <li key={r.id} className={cn("min-w-0 rounded-[14px] bg-panel py-2.5 pl-3 pr-1.5", history === r.id && "md:col-span-2")}>
                          <div className="flex items-start gap-3">
                            {/* Case carrée : « Fait » cette semaine (date + prénom), ou annulation */}
                            <button
                              type="button"
                              onClick={() => void toggle(r)}
                              disabled={busy === r.id}
                              aria-label={done ? "Annuler le « Fait » de cette semaine" : "Marquer fait cette semaine"}
                              className={cn(
                                "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-[6px] transition-[transform,background-color,border-color] active:scale-90 disabled:opacity-50",
                                done ? "bg-primary text-primary-foreground" : "border-2 border-faint hover:border-foreground/60",
                              )}
                            >
                              {done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className={cn("text-[14px] font-medium [overflow-wrap:anywhere]", done ? "text-muted-foreground line-through decoration-faint" : "text-foreground")}>{r.text}</span>
                                {r.weekday != null && (
                                  <span className={cn("rounded-full px-2 py-px text-[11px] font-medium", late ? TONE_SOFT.wait : isToday ? "bg-primary/10 text-primary" : "bg-field text-muted-foreground")}>
                                    {isToday ? "Aujourd'hui" : DAYS[r.weekday - 1]}
                                    {late ? " · en retard" : ""}
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 text-[12px] text-muted-foreground">
                                {done && last ? (
                                  <span className={TONE_TEXT.ok}>
                                    Faite {fmtDay(last.at)}
                                    {last.by ? ` · ${last.by}` : ""}
                                  </span>
                                ) : last ? (
                                  <>
                                    Dernière fois {fmtDay(last.at)}
                                    {last.by ? ` · ${last.by}` : ""}
                                  </>
                                ) : (
                                  "Jamais faite pour l'instant"
                                )}
                              </p>
                              {history === r.id && (
                                <ol className="mt-2 flex flex-col gap-1 border-l border-border pl-3">
                                  {[...log].reverse().slice(0, 12).map((e) => (
                                    <li key={e.at} className={cn("text-[12px]", new Date(e.at) >= since ? "text-foreground" : "text-muted-foreground")}>
                                      {fmtDone(e.at)}
                                      {e.by ? ` · ${e.by}` : ""}
                                    </li>
                                  ))}
                                  {log.length === 0 && <li className="text-[12px] text-faint">Pas encore d'historique.</li>}
                                </ol>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => setHistory((h) => (h === r.id ? null : r.id))}
                              className={cn(
                                "inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium transition-colors hover:bg-rowhover",
                                history === r.id ? "text-foreground" : "text-muted-foreground",
                              )}
                              title="Historique des « Fait »"
                              aria-label="Historique des « Fait »"
                            >
                              <TtpClock className="h-3.5 w-3.5" /> {log.length > 0 && <span className="tabular-nums text-faint">{log.length}</span>}
                            </button>
                            <ActionMenu
                              buttonClassName="h-8 w-8"
                              items={[
                                { key: "edit", label: "Modifier", icon: Pencil, onClick: () => { setEditId(r.id); setEditText(r.text); setEditDay(r.weekday ?? null); } },
                                { key: "delete", label: "Mettre à la corbeille", icon: Trash2, danger: true, onClick: () => void remove(r), confirm: { title: "Mettre à la corbeille", message: `Déplacer « ${r.text} » vers la corbeille ? Tu pourras la restaurer.`, confirmLabel: "Mettre à la corbeille" } },
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
      </section>
    </div>
  );
}
