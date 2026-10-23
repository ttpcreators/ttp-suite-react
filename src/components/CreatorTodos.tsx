import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowUp, Check, Columns3, List, MessageSquarePlus, Paperclip, Pencil, Plus, RotateCcw, Trash2, Upload, X } from "@/components/icons";
import { TtpChecklist, TtpClock, TtpMission, TtpPlanning, TtpProgress } from "@/components/icons/ttp-icons";
import { ActionMenu } from "@/components/ui/action-menu";
import { Tabs } from "@/components/ui/animated-tabs";
import { FilterPanel, type FilterGroup } from "@/components/ui/filter-panel";
import { AddButton } from "@/components/ui/form";
import { IconTile } from "@/components/ui/icon-tile";
import { PageHeaderRow } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { FileCard, fileFormatOf } from "@/components/ui/file-card-collections";
import { SwipeRow } from "@/components/mobile/swipe-row";
import { Overlay } from "@/components/mobile/ios-sheet";
import { DoneCircle, InfoRow } from "@/components/todo-parts";
import { NewDot } from "@/components/ui/new-dot";
import { markActivityRead, useActivityEvents } from "@/lib/useActivityEvents";
import { notifyAgencyChange } from "@/lib/push";
import { useIntent } from "@/lib/openIntent";
import { cn } from "@/lib/utils";
import { EMPTY, fmtDay, toISODate, todayISO } from "@/lib/dates";
import { useLocale, useT } from "@/lib/i18n";
import { TONE_DOT, TONE_TEXT, type StatusTone } from "@/lib/statusTone";
import { agencyAwaits, appendPoint, latestPoint, parsePoints } from "@/lib/todoProgress";
import { clip45, ctGroups, ctKpis, ctLateDays, ctMatchFilter, ctPostpone, ctStatus, type CtFilter, type CtKpi, type CtPriority } from "@/lib/creatorTodos";

/*
 * « À faire » de l'espace créateur, avec le design de la To-do agence (src/views/Todo.tsx) :
 * bouton « Filtres » et Liste / Colonnes dans l'en-tête, tuiles qui filtrent, groupes par
 * priorité, fiche à droite (feuille sur téléphone) avec « Où j'en suis », statut, échéance,
 * « Terminer » et « Reporter ». Les points d'avancement (colonne `todos.progress`) montrent
 * les messages de l'agence ; le créateur y répond. Données et écritures : celles de
 * CreatorSpace (RLS du créateur), passées en props.
 */

type Subtask = { id: string; text: string; done: boolean };
type Attachment = { name: string; size: string; path: string };
export type CreatorTodo = {
  id: string;
  text: string;
  descr: string | null;
  due: string | null;
  priority: string | null;
  done: boolean;
  status?: string | null;
  subtasks?: Subtask[] | null;
  attachments?: Attachment[] | null;
  creator?: string | null;
  creators?: string[] | null;
  created_at?: string | null;
  source?: string | null;
  progress?: string | null;
};

type Props = {
  todos: CreatorTodo[];
  /** La colonne `todos.progress` existe (SQL 2026-10-22) : on peut lire et écrire les points. */
  progressOn: boolean;
  /** « Avec Chloé et Léna » pour une tâche partagée, sinon null. */
  sharedWith: (td: CreatorTodo) => string | null;
  /** Formulaire d'ajout ou de modification (InlineForm de la page), affiché sous les tuiles. */
  form?: ReactNode;
  onAdd: () => void;
  onEdit: (td: CreatorTodo) => void;
  onSetStatus: (td: CreatorTodo, status: string) => void;
  onToggleDone: (td: CreatorTodo) => void;
  onDelete: (td: CreatorTodo) => void;
  onPatch: (id: string, build: (td: CreatorTodo) => Partial<CreatorTodo>) => Promise<boolean>;
  onUpload: (td: CreatorTodo, files: FileList | null) => void;
  uploading: boolean;
  onOpenAttachment: (a: Attachment) => void;
  onRemoveAttachment: (td: CreatorTodo, path: string) => void;
  /** Créateur connecté (prévient l'agence quand il écrit sur une tâche). */
  me?: string;
  /** Vue agence de l'espace : ni repère « nouveau », ni notification. */
  preview?: boolean;
};

const STATUS: { value: string; label: string; dot: string }[] = [
  { value: "À faire", label: "À faire", dot: TONE_DOT.wait },
  { value: "En cours", label: "En cours", dot: TONE_DOT.progress },
  { value: "Fait", label: "Fait", dot: TONE_DOT.ok },
];
const PRIO_LABEL: Record<string, string> = { haute: "Haute", moyenne: "Moyenne", basse: "Basse" };
const GROUP_LABEL: Record<CtPriority | "autre", string> = { haute: "Priorité haute", moyenne: "Priorité moyenne", basse: "Priorité basse", autre: "Autre priorité" };
const FILTERS: { id: CtFilter; label: string }[] = [
  { id: "encours", label: "Pas terminées" },
  { id: "retard", label: "En retard" },
  { id: "terminees", label: "Terminées" },
  { id: "toutes", label: "Toutes" },
];

const lgMq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(min-width: 1024px)") : null;
function useIsLg(): boolean {
  return useSyncExternalStore(
    (fn) => {
      lgMq?.addEventListener("change", fn);
      return () => lgMq?.removeEventListener("change", fn);
    },
    () => lgMq?.matches ?? false,
    () => false,
  );
}

function readView(): "liste" | "colonnes" {
  try {
    return globalThis.localStorage?.getItem("ttp:cs-todo-view") === "colonnes" ? "colonnes" : "liste";
  } catch {
    return "liste";
  }
}

export function CreatorTodos(p: Props) {
  const t = useT();
  const locale = useLocale();
  const isLg = useIsLg();
  const today = todayISO();
  const [view, setViewState] = useState<"liste" | "colonnes">(readView);
  const setView = (v: "liste" | "colonnes") => {
    setViewState(v);
    try {
      globalThis.localStorage?.setItem("ttp:cs-todo-view", v);
    } catch {
      /* stockage indisponible */
    }
  };
  const [filter, setFilter] = useState<CtFilter>("encours");
  const [prio, setPrio] = useState<CtPriority | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [postponeOpen, setPostponeOpen] = useState(false);
  const [subInput, setSubInput] = useState("");
  const [pointInput, setPointInput] = useState("");
  const pointRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const rows = p.todos;
  const kpis = ctKpis(rows, today);
  const filtered = rows.filter((r) => (view === "colonnes" || ctMatchFilter(filter, r, today)) && (!prio || r.priority === prio));
  const groups = ctGroups(filtered);
  const ordered = groups.flatMap((g) => g.rows);
  const showInspector = isLg && view === "liste" && rows.length > 0;
  const inspected = ordered.find((r) => r.id === selId) ?? ordered[0] ?? null;
  const sheetRow = sheetOpen && (!isLg || view === "colonnes") ? rows.find((r) => r.id === selId) ?? null : null;

  useEffect(() => {
    setPostponeOpen(false);
    setSubInput("");
    setPointInput("");
  }, [selId]);

  // Repères « nouveau » : tâches sur lesquelles l'agence a écrit (activity_events).
  const activity = useActivityEvents("creator", !p.preview);
  const pick = (id: string) => {
    setSelId(id);
    if (!isLg || view === "colonnes") setSheetOpen(true);
    if (!p.preview) void markActivityRead("todo", id);
  };
  // Notification « du nouveau sur une tâche » : ouvre la fiche de la tâche.
  const pickRef = useRef(pick);
  pickRef.current = pick;
  useIntent("cs-todo:open", (id) => {
    if (id) pickRef.current(id);
  });
  /** Prévient l'agence (push, 1 fois par tâche et par changement toutes les 10 min). */
  const tellAgency = (td: CreatorTodo, what: "progress" | "subtask") => {
    if (!p.preview && p.me) notifyAgencyChange("todo", p.me, what, td.text, td.id);
  };
  const closeSheet = () => setSheetOpen(false);

  const activeKpi: CtKpi | null =
    view !== "liste" ? null
    : prio === "haute" && filter === "encours" ? "prioritaires"
    : prio ? null
    : filter === "encours" || filter === "retard" || filter === "terminees" ? filter
    : null;
  const pickKpi = (id: CtKpi) => {
    setView("liste");
    const target = activeKpi === id ? "encours" : id;
    setFilter(target === "prioritaires" ? "encours" : target);
    setPrio(target === "prioritaires" ? "haute" : null);
  };
  const KPIS: { id: CtKpi; label: string; tone: StatusTone; icon: ReactNode }[] = [
    { id: "encours", label: t("En cours"), tone: "progress", icon: <TtpProgress /> },
    { id: "retard", label: t("En retard"), tone: "wait", icon: <TtpClock /> },
    { id: "prioritaires", label: t("Prioritaires"), tone: "wait", icon: <TtpMission /> },
    { id: "terminees", label: t("Terminées"), tone: "ok", icon: <TtpChecklist /> },
  ];

  const prioLabel = (v: string | null) => t(PRIO_LABEL[v ?? "moyenne"] ?? "Moyenne");
  const dueText = (td: CreatorTodo) => {
    const iso = toISODate(td.due);
    if (iso) return fmtDay(iso, locale);
    const free = (td.due ?? "").trim();
    return free && free !== "—" ? free : null;
  };

  const addPoint = async (td: CreatorTodo) => {
    const text = pointInput.trim();
    if (!text) return;
    if (await p.onPatch(td.id, (x) => ({ progress: appendPoint(x.progress, text, new Date(), "Créateur") }))) {
      setPointInput("");
      tellAgency(td, "progress");
    }
  };
  const addSubtask = (td: CreatorTodo) => {
    const text = subInput.trim();
    if (!text) return;
    setSubInput("");
    void p.onPatch(td.id, (x) => ({ subtasks: [...(x.subtasks ?? []), { id: `st${Date.now().toString(36)}`, text, done: false }] })).then(
      (ok) => ok && tellAgency(td, "subtask"),
    );
  };
  const toggleSubtask = (td: CreatorTodo, sid: string) =>
    void p.onPatch(td.id, (x) => ({ subtasks: (x.subtasks ?? []).map((s) => (s.id === sid ? { ...s, done: !s.done } : s)) }));
  const delSubtask = (td: CreatorTodo, sid: string) =>
    void p.onPatch(td.id, (x) => ({ subtasks: (x.subtasks ?? []).filter((s) => s.id !== sid) }));
  const postpone = async (td: CreatorTodo, iso: string) => {
    if (await p.onPatch(td.id, () => ({ due: iso }))) setPostponeOpen(false);
  };
  const doneLabels: [string, string] = [t("Rouvrir"), t("Terminer")];

  // ── Ligne de la liste ──
  const renderRow = (td: CreatorTodo) => {
    const late = ctLateDays(td, today);
    const on = showInspector && inspected?.id === td.id;
    const subs = td.subtasks ?? [];
    const subDone = subs.filter((s) => s.done).length;
    const status = ctStatus(td);
    const shared = p.sharedWith(td);
    const due = dueText(td);
    const awaits = p.progressOn && agencyAwaits(td.progress);
    // Trois infos au plus : avec qui (ou « demandée par l'agence »), l'échéance, un message de l'agence.
    const meta = [
      shared ?? (td.source === "agency" ? t("Demandée par l'agence") : null),
      due && !td.done ? t("Échéance {date}", { date: due }) : null,
    ].filter(Boolean) as string[];
    return (
      <li key={td.id}>
        <SwipeRow
          actions={[
            td.done
              ? { key: "reopen", label: t("Rouvrir"), icon: RotateCcw, tone: "gray", onClick: () => p.onToggleDone(td) }
              : { key: "done", label: t("Fait"), icon: Check, tone: "green", onClick: () => p.onToggleDone(td) },
            { key: "delete", label: t("Supprimer"), icon: Trash2, tone: "red", onClick: () => p.onDelete(td) },
          ]}
        >
          <div
            role="button"
            tabIndex={0}
            aria-current={on ? "true" : undefined}
            onClick={() => pick(td.id)}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                pick(td.id);
              }
            }}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-[14px] px-2.5 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 sm:px-3",
              on ? "bg-primary/[0.06] ring-[1.5px] ring-inset ring-primary" : "hover:bg-rowhover",
            )}
          >
            <DoneCircle done={td.done} high={td.priority === "haute"} onToggle={() => p.onToggleDone(td)} labels={doneLabels} />
            <div className="min-w-0 flex-1">
              <div
                className={cn("truncate text-[15px] font-semibold leading-snug text-foreground", td.done && "text-muted-foreground line-through decoration-faint")}
                title={td.text.length > 45 ? td.text : undefined}
              >
                {activity.keys.has(`todo:${td.id}`) && <NewDot label={t("Du nouveau de ton agence")} className="mr-1.5 align-middle" />}
                {clip45(td.text)}
              </div>
              {(meta.length > 0 || awaits) && (
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
                  {meta.length > 0 && <span className="min-w-0 truncate">{meta.join(" · ")}</span>}
                  {awaits && (
                    <span className="inline-flex shrink-0 items-center gap-1 font-medium text-primary">
                      {meta.length > 0 && <span className="text-muted-foreground">·</span>}
                      <MessageSquarePlus className="h-3 w-3" /> {t("Message de l'agence")}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {subs.length > 0 && (
                <span className="inline-flex h-6 items-center rounded-full bg-field px-2 text-[12px] font-semibold tabular-nums text-muted-foreground" title={t("Sous-tâches faites")}>
                  {subDone} / {subs.length}
                </span>
              )}
              {late > 0 ? (
                <StatusPill tone="wait">
                  <span className="sm:hidden">{t("{n} j", { n: late })}</span>
                  <span className="max-sm:hidden">{t("{n} j de retard", { n: late })}</span>
                </StatusPill>
              ) : td.done ? (
                <StatusPill tone="ok" className="max-sm:hidden">{t("Faite")}</StatusPill>
              ) : status === "En cours" ? (
                <StatusPill tone="progress">{t("En cours")}</StatusPill>
              ) : null}
            </div>
          </div>
        </SwipeRow>
      </li>
    );
  };

  // ── Fiche (à droite, ou feuille) ──
  const renderInspector = (td: CreatorTodo, inSheet: boolean) => {
    const late = ctLateDays(td, today);
    const subs = td.subtasks ?? [];
    const subDone = subs.filter((s) => s.done).length;
    const atts = td.attachments ?? [];
    const due = dueText(td);
    const created = td.created_at ? fmtDay(td.created_at, locale) : "";
    const points = parsePoints(td.progress);
    const last = latestPoint(td.progress);
    const awaits = p.progressOn && agencyAwaits(td.progress);
    const shared = p.sharedWith(td);
    const whoLabel = (w?: string | null) => (w === "Agence" ? t("L'agence") : w === "Créateur" ? t("Toi") : null);
    return (
      <>
        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-1 pb-4 [&>*]:shrink-0">
          <div className="flex items-start gap-3">
            <DoneCircle done={td.done} high={td.priority === "haute"} onToggle={() => p.onToggleDone(td)} size="lg" labels={doneLabels} />
            <h2
              className={cn(
                "min-w-0 flex-1 pt-px text-[22px] font-bold leading-tight tracking-[-0.02em] text-foreground [overflow-wrap:anywhere]",
                td.done && "text-muted-foreground line-through decoration-faint",
              )}
            >
              {td.text}
            </h2>
            <div className="-mr-1.5 -mt-1 flex shrink-0 items-center">
              <ActionMenu
                items={[
                  { key: "edit", label: t("Modifier"), icon: Pencil, onClick: () => { closeSheet(); p.onEdit(td); } },
                  { key: "file", label: t("Ajouter un fichier"), icon: Upload, onClick: () => fileRef.current?.click() },
                  { key: "delete", label: t("Supprimer"), icon: Trash2, danger: true, onClick: () => { closeSheet(); p.onDelete(td); } },
                ]}
              />
              {inSheet && (
                <button
                  type="button"
                  onClick={closeSheet}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground"
                  aria-label={t("Fermer")}
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>

          {td.descr && <p className="-mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-muted-foreground">{td.descr}</p>}

          {/* Où j'en suis : le dernier point ; un message de l'agence ressort en bleu. */}
          {p.progressOn && (
            <button
              type="button"
              onClick={() => {
                pointRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
                pointRef.current?.focus({ preventScroll: true });
              }}
              className={cn(
                "flex w-full flex-col gap-1 rounded-[14px] px-3.5 py-3 text-left transition-colors",
                awaits ? "bg-primary/[0.07] hover:bg-primary/[0.11]" : "bg-panel hover:bg-rowhover",
              )}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className={cn("text-[12px] font-semibold", awaits ? "text-primary" : "text-muted-foreground")}>
                  {awaits ? t("Message de l'agence") : t("Où j'en suis")}
                </span>
                {last?.date && <span className="text-[11px] tabular-nums text-faint">{last.date}</span>}
              </span>
              {last ? (
                <span className="line-clamp-3 whitespace-pre-wrap text-[13px] leading-snug text-foreground [overflow-wrap:anywhere]">{last.text}</span>
              ) : (
                <span className="text-[13px] leading-snug text-muted-foreground">{t("Aucun point pour l'instant.")}</span>
              )}
            </button>
          )}

          <dl className="divide-y divide-border overflow-hidden rounded-[14px] bg-panel">
            {shared && <InfoRow label={t("Avec")}><span className="min-w-0 truncate font-medium">{shared}</span></InfoRow>}
            <InfoRow label={t("Statut")}>
              <Tabs
                size="sm"
                label={t("Statut")}
                items={STATUS.map((o) => ({ value: o.value, label: t(o.label) }))}
                value={ctStatus(td)}
                onValueChange={(s) => {
                  if (s !== ctStatus(td)) p.onSetStatus(td, s);
                }}
              />
            </InfoRow>
            <InfoRow label={t("Priorité")}>
              <StatusPill tone={td.priority === "haute" ? "wait" : "closed"} className={td.priority === "haute" ? "text-priority" : undefined}>{prioLabel(td.priority)}</StatusPill>
            </InfoRow>
            <InfoRow label={t("Échéance")}>
              <span className={cn("font-medium", late > 0 ? TONE_TEXT.wait : !due && "text-muted-foreground")}>
                {due ?? EMPTY}
                {late > 0 ? ` · ${t("{n} j de retard", { n: late })}` : ""}
              </span>
            </InfoRow>
            {created && <InfoRow label={t("Créée le")}>{created}</InfoRow>}
            <InfoRow label={t("Demandée par")}>{td.source === "agency" ? t("L'agence") : t("Toi")}</InfoRow>
          </dl>

          {/* Sous-tâches */}
          <section className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-[14px] font-semibold text-foreground">{t("Sous-tâches")}</h3>
              <span className="text-[12px] tabular-nums text-muted-foreground">{subs.length ? t("{done} sur {total}", { done: subDone, total: subs.length }) : t("Aucune")}</span>
            </div>
            {subs.length > 0 && (
              <div className="h-1 w-full overflow-hidden rounded-full bg-field">
                <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${(subDone / subs.length) * 100}%` }} />
              </div>
            )}
            {subs.map((s) => (
              <div key={s.id} className="group flex items-center gap-2.5 rounded-[12px] bg-panel px-3 py-2">
                <button
                  type="button"
                  onClick={() => toggleSubtask(td, s.id)}
                  aria-label={s.done ? t("Décocher") : t("Cocher")}
                  className={cn(
                    "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] transition-colors",
                    s.done ? "bg-primary text-primary-foreground" : "border-2 border-faint hover:border-foreground/60",
                  )}
                >
                  {s.done && <Check className="h-3 w-3" strokeWidth={3} />}
                </button>
                <span className={cn("min-w-0 flex-1 break-words text-[13px]", s.done ? "text-faint line-through" : "text-foreground")}>{s.text}</span>
                <button
                  type="button"
                  onClick={() => delSubtask(td, s.id)}
                  aria-label={t("Supprimer la sous-tâche")}
                  className="shrink-0 text-faint transition-opacity hover:text-destructive pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addSubtask(td);
              }}
              className="flex h-10 items-center gap-2 rounded-full bg-field pl-3.5 pr-1"
            >
              <input
                value={subInput}
                onChange={(e) => setSubInput(e.target.value)}
                placeholder={t("Ajouter une sous-tâche…")}
                aria-label={t("Nouvelle sous-tâche")}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-faint"
              />
              <button type="submit" disabled={!subInput.trim()} aria-label={t("Ajouter")} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
                <Plus className="h-4 w-4" />
              </button>
            </form>
          </section>

          {/* Pièces jointes */}
          <section className="flex flex-col gap-2">
            <h3 className="text-[14px] font-semibold text-foreground">
              {t("Pièces jointes")}{atts.length ? <span className="font-normal text-muted-foreground"> · {atts.length}</span> : null}
            </h3>
            {atts.map((a) => (
              <div key={a.path} className="group flex items-center gap-3 rounded-[12px] bg-panel p-2.5">
                <button type="button" onClick={() => p.onOpenAttachment(a)} className="shrink-0" title={t("Ouvrir")}><FileCard formatFile={fileFormatOf(a.name)} /></button>
                <button type="button" onClick={() => p.onOpenAttachment(a)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-[13px] font-medium text-foreground hover:underline">{a.name}</div>
                  <div className="text-[11px] text-faint">{a.size}</div>
                </button>
                <button type="button" onClick={() => p.onRemoveAttachment(td, a.path)} className="shrink-0 text-faint transition-opacity hover:text-destructive pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100" title={t("Retirer")} aria-label={t("Retirer")}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => p.onUpload(td, e.target.files)} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={p.uploading}
              className="flex items-center justify-center gap-2 rounded-full border-2 border-dashed border-border px-3 py-2 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50"
            >
              <Paperclip className="h-4 w-4" /> {p.uploading ? t("Envoi…") : t("Ajouter un fichier")}
            </button>
          </section>

          {/* Échanges avec l'agence : points d'avancement, questions, réponses */}
          {p.progressOn && (
            <section className="flex flex-col gap-2">
              <h3 className="text-[14px] font-semibold text-foreground">{t("Échanges avec l'agence")}</h3>
              {points.length ? (
                <ol className="flex flex-col gap-1.5 rounded-[14px] bg-panel px-3.5 py-2.5">
                  {points.map((pt, i) => (
                    <li key={i} className="flex flex-col">
                      {(pt.date || pt.who) && (
                        <span className={cn("text-[11px] tabular-nums", pt.who === "Agence" ? "font-semibold text-primary" : "text-faint")}>
                          {[whoLabel(pt.who), pt.date].filter(Boolean).join(" · ")}
                        </span>
                      )}
                      <span className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground [overflow-wrap:anywhere]">{pt.text}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-[13px] leading-snug text-muted-foreground">{t("Aucun échange pour l'instant.")}</p>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void addPoint(td);
                }}
                className="flex h-11 items-center gap-2 rounded-full bg-field pl-4 pr-1.5"
              >
                <input
                  ref={pointRef}
                  value={pointInput}
                  onChange={(e) => setPointInput(e.target.value)}
                  placeholder={awaits ? t("Réponds à l'agence…") : t("Où en es-tu ?")}
                  aria-label={t("Nouveau point d'avancement")}
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-faint"
                />
                <button
                  type="submit"
                  disabled={!pointInput.trim()}
                  aria-label={t("Envoyer")}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-30"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </form>
            </section>
          )}
        </div>

        {/* Actions, hors de la zone qui défile */}
        <div className="mt-3 flex shrink-0 flex-col gap-2 border-t border-border pt-4">
          {postponeOpen && (
            <div className="flex flex-col gap-2 rounded-[14px] bg-panel p-3">
              <span className="text-[12px] font-medium text-muted-foreground">{t("Nouvelle échéance")}</span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: t("+ 1 jour"), n: 1 },
                  { label: t("+ 1 semaine"), n: 7 },
                ].map((o) => (
                  <button
                    key={o.n}
                    type="button"
                    onClick={() => void postpone(td, ctPostpone(td, o.n, today))}
                    className="h-8 rounded-full bg-surface px-3 text-[12px] font-semibold text-foreground transition-colors hover:bg-rowhover"
                  >
                    {o.label}
                  </button>
                ))}
                <input
                  type="date"
                  aria-label={t("Autre date")}
                  defaultValue={toISODate(td.due)}
                  onChange={(e) => {
                    if (e.target.value) void postpone(td, e.target.value);
                  }}
                  className="h-8 min-w-0 flex-1 rounded-full border border-border bg-surface px-3 text-[12px] text-foreground outline-none focus:border-primary"
                />
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => p.onToggleDone(td)}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-4 text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            {td.done ? <RotateCcw className="h-4 w-4" /> : <Check className="h-4 w-4" strokeWidth={2.5} />}
            {td.done ? t("Rouvrir") : t("Terminer")}
          </button>
          {!td.done && (
            <button
              type="button"
              onClick={() => setPostponeOpen((v) => !v)}
              aria-expanded={postponeOpen}
              className={cn(
                "flex h-10 items-center justify-center gap-1.5 rounded-full bg-field px-3 text-[13px] font-semibold text-foreground transition-colors hover:bg-rowhover",
                postponeOpen && "ring-[1.5px] ring-inset ring-primary",
              )}
            >
              <TtpPlanning className="h-4 w-4" /> {t("Reporter")}
            </button>
          )}
        </div>
      </>
    );
  };

  // ── Colonnes (par statut) ──
  const renderColumns = () => (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {STATUS.map((col) => {
        const colRows = filtered.filter((r) => ctStatus(r) === col.value);
        return (
          <div key={col.value} className="flex flex-col gap-2 rounded-[20px] bg-surface p-2.5">
            <div className="flex items-center justify-between px-1.5 pt-1">
              <div className="flex items-center gap-2">
                <span className={cn("h-2 w-2 rounded-full", col.dot)} />
                <span className="text-[13px] font-semibold text-foreground">{t(col.label)}</span>
              </div>
              <span className="text-[12px] font-semibold tabular-nums text-muted-foreground">{colRows.length}</span>
            </div>
            {colRows.length === 0 ? (
              <div className="px-2 py-8 text-center text-[12px] text-faint">{t("Aucune tâche")}</div>
            ) : (
              colRows.map((td) => {
                const late = ctLateDays(td, today);
                const due = dueText(td);
                return (
                  <button
                    key={td.id}
                    type="button"
                    onClick={() => pick(td.id)}
                    className="flex flex-col gap-1.5 rounded-[14px] bg-panel p-3 text-left transition-colors hover:bg-rowhover"
                  >
                    <span className="flex items-start gap-2">
                      {td.priority === "haute" && <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-priority" />}
                      <span className={cn("line-clamp-2 text-[13px] font-semibold leading-snug text-foreground [overflow-wrap:anywhere]", td.done && "text-muted-foreground line-through")}>{td.text}</span>
                    </span>
                    {(due || late > 0) && (
                      <span className={cn("text-[12px]", late > 0 ? TONE_TEXT.wait : "text-muted-foreground")}>
                        {late > 0 ? t("{n} j de retard", { n: late }) : due}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        );
      })}
    </div>
  );

  // ── Contenu ──
  let content: ReactNode;
  if (rows.length === 0) {
    content = <div className="rounded-[20px] bg-surface px-4 py-3 text-sm text-muted-foreground">{t("Aucune tâche.")}</div>;
  } else if (view === "colonnes") {
    content = renderColumns();
  } else if (groups.length === 0) {
    content = <div className="rounded-[20px] bg-surface px-4 py-8 text-center text-sm text-muted-foreground">{filter === "terminees" ? t("Aucune tâche faite.") : t("Aucune tâche pour ces filtres.")}</div>;
  } else {
    content = (
      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <section key={g.key}>
            <div className="flex items-center gap-2 px-1 pb-2">
              <span aria-hidden className={cn("h-2 w-2 rounded-full", g.key === "haute" ? "bg-priority" : "bg-faint")} />
              <h3 className="text-[13px] font-semibold text-foreground">{t(GROUP_LABEL[g.key])}</h3>
              <span className="ml-auto text-[12px] font-semibold tabular-nums text-muted-foreground">{g.rows.length}</span>
            </div>
            <ul className="flex flex-col gap-0.5 rounded-[20px] bg-surface p-1.5">{g.rows.map(renderRow)}</ul>
          </section>
        ))}
      </div>
    );
  }

  const filterGroups: FilterGroup[] = [
    ...(view === "liste"
      ? [{
          id: "statut",
          label: t("Statut"),
          value: filter,
          onChange: (v: string) => setFilter(v as CtFilter),
          options: FILTERS.map((f) => ({ value: f.id, label: t(f.label), count: rows.filter((r) => ctMatchFilter(f.id, r, today)).length })),
        }]
      : []),
    {
      id: "priorite",
      label: t("Priorité"),
      value: prio ?? "__all__",
      onChange: (v: string) => setPrio(v === "__all__" ? null : (v as CtPriority)),
      options: [
        { value: "__all__", label: t("Toutes") },
        { value: "haute", label: t("Haute") },
        { value: "moyenne", label: t("Moyenne") },
        { value: "basse", label: t("Basse") },
      ],
    },
  ];
  const activeCount = (prio ? 1 : 0) + (view === "liste" && filter !== "encours" ? 1 : 0);

  return (
    <div>
      <PageHeaderRow>
        {rows.length > 0 && (
          <FilterPanel
            title={t("Filtres")}
            activeCount={activeCount}
            groups={filterGroups}
            onClear={() => {
              setFilter("encours");
              setPrio(null);
            }}
          />
        )}
        <Tabs
          size="sm"
          label={t("Affichage")}
          items={[
            { value: "liste", label: t("Liste"), icon: <List className="h-3.5 w-3.5" />, hideLabel: "mobile" },
            { value: "colonnes", label: t("Colonnes"), icon: <Columns3 className="h-3.5 w-3.5" />, hideLabel: "mobile" },
          ]}
          value={view}
          onValueChange={(v) => setView(v as "liste" | "colonnes")}
        />
        <AddButton navBar label={t("Tâche")} onClick={p.onAdd} />
      </PageHeaderRow>

      <div className={cn(showInspector && "grid grid-cols-[minmax(0,1fr)_340px] items-start gap-5")}>
        <div className="min-w-0">
          {rows.length > 0 && (
            <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              {KPIS.map((k) => {
                const on = activeKpi === k.id;
                return (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => pickKpi(k.id)}
                    aria-pressed={on}
                    className={cn(
                      "flex min-w-0 flex-col gap-3 rounded-[16px] p-4 text-left transition-colors",
                      on ? "bg-primary/[0.06] ring-[1.5px] ring-inset ring-primary" : "bg-surface hover:bg-rowhover",
                    )}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <IconTile size="sm" tone={k.tone} className="rounded-full">{k.icon}</IconTile>
                      <span className="text-[26px] font-bold leading-none tracking-[-0.02em] text-foreground tabular-nums">{kpis[k.id]}</span>
                    </span>
                    <span className="truncate text-[13px] font-medium text-muted-foreground">{k.label}</span>
                  </button>
                );
              })}
            </div>
          )}
          {p.form}
          {content}
        </div>

        {showInspector && (
          <aside aria-label={t("Fiche de la tâche")} className="sticky top-5 flex max-h-[calc(100dvh-2.5rem)] flex-col rounded-[22px] bg-surface p-5">
            {inspected ? renderInspector(inspected, false) : <p className="m-auto text-center text-[13px] text-muted-foreground">{t("Aucune tâche à afficher.")}</p>}
          </aside>
        )}
      </div>

      {sheetRow && (
        <Overlay className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" label={sheetRow.text} onClose={closeSheet}>
          <div className="flex max-h-[88dvh] w-full max-w-md flex-col rounded-[22px] bg-surface p-5 shadow-sm" onClick={(e) => e.stopPropagation()}>
            {renderInspector(sheetRow, true)}
          </div>
        </Overlay>
      )}
    </div>
  );
}
