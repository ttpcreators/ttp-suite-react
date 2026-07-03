import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X, Trash2 } from "lucide-react";
import { TextField, SelectField } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/action-menu";
import { cn } from "@/lib/utils";

export type Ev = {
  id: string;
  date: string; // YYYY-MM-DD
  time: string;
  title: string;
  type: string;
  who: string | null;
  /** Catégorie de la puce. Par défaut "event" (vrai rendez-vous, modifiable).
   *  "brief" / "todo" = échéances superposées en LECTURE SEULE (clic = navigation). */
  kind?: "event" | "brief" | "todo";
};

type Kind = "event" | "brief" | "todo";

type View = "month" | "week" | "list";

const TYPE_OPTIONS = [
  { value: "call", label: "Call" },
  { value: "reunion", label: "Réunion" },
  { value: "collab", label: "Collab" },
  { value: "shoot", label: "Shoot" },
  { value: "event", label: "Event" },
  { value: "voyage", label: "Voyage" },
  { value: "deadline", label: "Deadline" },
];

// Couleur (fond de puce) par type — une couleur DISTINCTE par type (code couleur)
const TYPE_BG: Record<string, string> = {
  call: "bg-primary",
  reunion: "bg-cyan",
  collab: "bg-signal",
  shoot: "bg-violet-500",
  event: "bg-pink-500",
  voyage: "bg-amber",
  deadline: "bg-rose-500",
};

const TYPE_TEXT: Record<string, string> = {
  call: "text-primary",
  reunion: "text-cyan",
  collab: "text-signal",
  shoot: "text-violet-500",
  event: "text-pink-500",
  voyage: "text-amber",
  deadline: "text-rose-500",
};

function typeBg(t: string) {
  return TYPE_BG[t] ?? "bg-indigo";
}
function typeText(t: string) {
  return TYPE_TEXT[t] ?? "text-indigo";
}
function typeLabel(t: string) {
  return TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;
}

// ─── Overlays lecture seule (briefs / to-do datés) ───────────────────────────
// Une puce peut être un vrai événement (couleur = son type) OU une échéance
// dérivée d'un brief (ambre) / d'une to-do (indigo), affichée en lecture seule.
function evKind(e: Ev): Kind {
  return e.kind ?? "event";
}
function chipBg(e: Ev) {
  if (e.kind === "brief") return "bg-amber";
  if (e.kind === "todo") return "bg-indigo";
  return typeBg(e.type);
}
function chipText(e: Ev) {
  if (e.kind === "brief") return "text-amber";
  if (e.kind === "todo") return "text-indigo";
  return typeText(e.type);
}
function chipLabel(e: Ev) {
  if (e.kind === "brief") return "Brief";
  if (e.kind === "todo") return "To-do";
  return typeLabel(e.type);
}

const KIND_META: { id: Kind; label: string; dot: string }[] = [
  { id: "event", label: "Événements", dot: "bg-primary" },
  { id: "brief", label: "Briefs", dot: "bg-amber" },
  { id: "todo", label: "To-do", dot: "bg-indigo" },
];

// ─── Helpers de date (locaux, sans dépendance) ───────────────────────────────

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
/** Date -> "YYYY-MM-DD" (local, pas d'UTC pour éviter le décalage). */
function toKey(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function todayKey() {
  return toKey(new Date());
}
/** Lundi (0) → Dimanche (6) pour un Date donné. */
function mondayIndex(d: Date) {
  return (d.getDay() + 6) % 7;
}
function startOfWeek(d: Date) {
  const r = new Date(d);
  r.setDate(d.getDate() - mondayIndex(d));
  r.setHours(0, 0, 0, 0);
  return r;
}
function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(d.getDate() + n);
  return r;
}

const MONTHS_FR = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];
const DAYS_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const DAYS_FR_LONG = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

function monthTitle(d: Date) {
  return `${MONTHS_FR[d.getMonth()]} ${d.getFullYear()}`;
}
function formatListDay(key: string) {
  const [y, m, dd] = key.split("-").map(Number);
  const d = new Date(y, (m ?? 1) - 1, dd ?? 1);
  return `${DAYS_FR_LONG[mondayIndex(d)]} ${dd} ${MONTHS_FR[(m ?? 1) - 1]} ${y}`;
}

// ─── Composant ───────────────────────────────────────────────────────────────

type Draft = {
  id: string | null;
  date: string;
  time: string;
  title: string;
  type: string;
  who: string;
};

function emptyDraft(date: string): Draft {
  return { id: null, date, time: "", title: "", type: "call", who: "" };
}

export function EventCalendar({
  events,
  onCreate,
  onUpdate,
  onDelete,
  onNavigate,
  creators = [],
}: {
  events: Ev[];
  onCreate: (e: Omit<Ev, "id">) => void;
  onUpdate: (id: string, patch: Partial<Ev>) => void;
  onDelete: (id: string) => void;
  /** Clic sur une échéance brief/to-do (lecture seule) → navigation vers sa page. */
  onNavigate?: (kind: "brief" | "todo") => void;
  creators?: { name: string }[];
}) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [view, setView] = useState<View>("month");
  const [draft, setDraft] = useState<Draft | null>(null);
  // Filtres de catégorie (événements / briefs / to-do) — actifs par défaut.
  const [kinds, setKinds] = useState<Record<Kind, boolean>>({ event: true, brief: true, todo: true });

  const tKey = todayKey();

  // N'affiche que les catégories cochées.
  const visibleEvents = useMemo(() => events.filter((e) => kinds[evKind(e)]), [events, kinds]);

  // Regroupe les events par jour (clé YYYY-MM-DD), triés par heure.
  const byDay = useMemo(() => {
    const m = new Map<string, Ev[]>();
    for (const e of visibleEvents) {
      const arr = m.get(e.date) ?? [];
      arr.push(e);
      m.set(e.date, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.time.localeCompare(b.time));
    return m;
  }, [visibleEvents]);

  const whoOptions = useMemo(() => {
    const names = new Set<string>();
    for (const c of creators) if (c.name) names.add(c.name);
    for (const e of events) if (e.who) names.add(e.who);
    return [{ value: "", label: "—" }, ...[...names].sort().map((n) => ({ value: n, label: n }))];
  }, [creators, events]);

  // Navigation
  function goToday() {
    const d = new Date();
    if (view === "week") {
      d.setHours(0, 0, 0, 0);
      setCursor(startOfWeek(d));
    } else {
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      setCursor(d);
    }
  }
  function shift(delta: number) {
    setCursor((c) => {
      const d = new Date(c);
      if (view === "week") d.setDate(d.getDate() + delta * 7);
      else d.setMonth(d.getMonth() + delta);
      return d;
    });
  }

  // Ouverture des modales
  function openCreate(date: string) {
    setDraft(emptyDraft(date));
  }
  function openEdit(e: Ev) {
    setDraft({ id: e.id, date: e.date, time: e.time, title: e.title, type: e.type, who: e.who ?? "" });
  }
  // Un vrai événement s'édite ; une échéance brief/to-do renvoie vers sa page.
  function handleEventClick(e: Ev) {
    if (e.kind === "brief" || e.kind === "todo") {
      onNavigate?.(e.kind);
      return;
    }
    openEdit(e);
  }
  function closeModal() {
    setDraft(null);
  }
  function submit() {
    if (!draft) return;
    const payload = {
      date: draft.date,
      time: draft.time,
      title: draft.title.trim(),
      type: draft.type,
      who: draft.who ? draft.who : null,
    };
    if (draft.id) onUpdate(draft.id, payload);
    else onCreate(payload);
    setDraft(null);
  }
  function remove() {
    if (draft?.id) onDelete(draft.id);
    setDraft(null);
  }

  const headerTitle = view === "week" ? weekRangeTitle(cursor) : monthTitle(cursor);

  return (
    <div className="flex flex-col gap-4">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => shift(-1)}
            className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-surface text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
            aria-label="Précédent"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-surface text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
            aria-label="Suivant"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
          >
            Aujourd'hui
          </button>
          <div className="ml-1 text-base font-semibold capitalize text-foreground">{headerTitle}</div>
        </div>

        {/* ViewToggle */}
        <div className="flex items-center gap-1 rounded-xl border border-border bg-panel p-1">
          {(
            [
              ["month", "Mois"],
              ["week", "Semaine"],
              ["list", "Liste"],
            ] as [View, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                if (v === "week") setCursor((c) => startOfWeek(c));
                setView(v);
              }}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors",
                view === v
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-rowhover hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Filtres de catégorie (cliquables) + légende des types d'événement */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border bg-surface px-3 py-2 shadow-sm">
        {KIND_META.map((k) => {
          const on = kinds[k.id];
          const count = events.filter((e) => evKind(e) === k.id).length;
          return (
            <button
              key={k.id}
              type="button"
              onClick={() => setKinds((s) => ({ ...s, [k.id]: !s[k.id] }))}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold transition-colors hover:bg-rowhover",
                on ? "text-foreground" : "text-faint",
              )}
              title={on ? `Masquer : ${k.label}` : `Afficher : ${k.label}`}
            >
              <span className={cn("size-2.5 shrink-0 rounded-full transition-opacity", k.dot, !on && "opacity-25")} />
              {k.label}
              <span className="tabular-nums opacity-50">{count}</span>
            </button>
          );
        })}
        <span className="mx-0.5 h-3.5 w-px shrink-0 bg-border" />
        {TYPE_OPTIONS.map((t) => (
          <span key={t.value} className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <span className={cn("size-2.5 shrink-0 rounded-full", typeBg(t.value))} />
            {t.label}
          </span>
        ))}
      </div>

      {view === "month" && (
        <MonthView cursor={cursor} byDay={byDay} tKey={tKey} onCellClick={openCreate} onEventClick={handleEventClick} />
      )}
      {view === "week" && (
        <WeekView cursor={cursor} byDay={byDay} tKey={tKey} onCellClick={openCreate} onEventClick={handleEventClick} />
      )}
      {view === "list" && <ListView events={visibleEvents} onEventClick={handleEventClick} />}

      {draft && (
        <EventModal
          draft={draft}
          setDraft={setDraft}
          whoOptions={whoOptions}
          onSubmit={submit}
          onDelete={remove}
          onClose={closeModal}
        />
      )}
    </div>
  );
}

function weekRangeTitle(cursor: Date) {
  const start = startOfWeek(cursor);
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  if (sameMonth) return `${start.getDate()}–${end.getDate()} ${MONTHS_FR[end.getMonth()]} ${end.getFullYear()}`;
  return `${start.getDate()} ${MONTHS_FR[start.getMonth()]} – ${end.getDate()} ${MONTHS_FR[end.getMonth()]} ${end.getFullYear()}`;
}

// ─── Vue Mois ────────────────────────────────────────────────────────────────

function MonthView({
  cursor,
  byDay,
  tKey,
  onCellClick,
  onEventClick,
}: {
  cursor: Date;
  byDay: Map<string, Ev[]>;
  tKey: string;
  onCellClick: (date: string) => void;
  onEventClick: (e: Ev) => void;
}) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const curMonth = cursor.getMonth();

  return (
    <div className="overflow-x-auto overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="grid min-w-[480px] grid-cols-7 border-b border-border bg-panel sm:min-w-0">
        {DAYS_FR.map((d) => (
          <div key={d} className="px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-faint">
            {d}
          </div>
        ))}
      </div>
      <div className="grid min-w-[480px] grid-cols-7 sm:min-w-0">
        {cells.map((d, i) => {
          const key = toKey(d);
          const inMonth = d.getMonth() === curMonth;
          const isToday = key === tKey;
          const dayEvents = byDay.get(key) ?? [];
          const shown = dayEvents.slice(0, 3);
          const extra = dayEvents.length - shown.length;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onCellClick(key)}
              className={cn(
                "group relative flex min-h-[92px] flex-col gap-1 border-b border-r border-border p-1.5 text-left transition-colors hover:bg-rowhover md:min-h-[110px]",
                i % 7 === 6 && "border-r-0",
                i >= 35 && "border-b-0",
                !inMonth && "bg-panel/40",
              )}
            >
              <span
                className={cn(
                  "grid h-6 w-6 place-items-center self-end rounded-full text-[11px] font-medium tabular-nums",
                  inMonth ? "text-foreground" : "text-faint",
                  isToday && "border border-primary bg-primary/10 text-primary",
                )}
              >
                {d.getDate()}
              </span>
              <div className="flex flex-col gap-1">
                {shown.map((e) => (
                  <span
                    key={e.id}
                    role="button"
                    tabIndex={0}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onEventClick(e);
                    }}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        ev.stopPropagation();
                        onEventClick(e);
                      }
                    }}
                    className={cn(
                      "flex items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[10px] font-medium text-onsignal transition-opacity hover:opacity-90",
                      chipBg(e),
                    )}
                    title={`${e.time ? e.time + " · " : ""}${e.title}`}
                  >
                    {e.time && <span className="shrink-0 tabular-nums opacity-80">{e.time}</span>}
                    <span className="truncate">{e.title}</span>
                  </span>
                ))}
                {extra > 0 && (
                  <span className="px-1 text-[10px] font-medium text-muted-foreground">+{extra}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Vue Semaine ─────────────────────────────────────────────────────────────

function WeekView({
  cursor,
  byDay,
  tKey,
  onCellClick,
  onEventClick,
}: {
  cursor: Date;
  byDay: Map<string, Ev[]>;
  tKey: string;
  onCellClick: (date: string) => void;
  onEventClick: (e: Ev) => void;
}) {
  const start = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
      {days.map((d, i) => {
        const key = toKey(d);
        const isToday = key === tKey;
        const dayEvents = byDay.get(key) ?? [];
        return (
          <div
            key={key}
            className={cn(
              "flex flex-col rounded-2xl border bg-surface shadow-sm",
              isToday ? "border-primary" : "border-border",
            )}
          >
            <button
              type="button"
              onClick={() => onCellClick(key)}
              className={cn(
                "flex items-center justify-between rounded-t-2xl border-b border-border px-3 py-2 text-left transition-colors hover:bg-rowhover",
                isToday && "bg-primary/10",
              )}
            >
              <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">{DAYS_FR[i]}</span>
              <span className={cn("text-sm font-semibold tabular-nums", isToday ? "text-primary" : "text-foreground")}>
                {d.getDate()}
              </span>
            </button>
            <div className="flex flex-1 flex-col gap-1.5 p-2">
              {dayEvents.length === 0 && (
                <span className="px-1 py-2 text-[11px] text-faint">Aucun événement</span>
              )}
              {dayEvents.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onEventClick(e)}
                  className="flex items-start gap-2 rounded-lg border border-border bg-panel px-2 py-1.5 text-left transition-colors hover:bg-rowhover"
                >
                  <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", chipBg(e))} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-foreground">{e.title}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {e.time && <span className="tabular-nums">{e.time}</span>}
                      {e.time && " · "}
                      <span className={chipText(e)}>{chipLabel(e)}</span>
                      {e.who && ` · ${e.who}`}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Vue Liste ───────────────────────────────────────────────────────────────

function ListView({ events, onEventClick }: { events: Ev[]; onEventClick: (e: Ev) => void }) {
  const [filter, setFilter] = useState<"avenir" | "passe" | "tous">("avenir");
  const today = todayKey();
  const groups = useMemo(() => {
    const shown = events.filter((e) =>
      filter === "tous" ? true : filter === "avenir" ? e.date >= today : e.date < today,
    );
    const sorted = [...shown].sort((a, b) => {
      if (a.date !== b.date)
        return filter === "passe" ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
      return a.time.localeCompare(b.time);
    });
    const m = new Map<string, Ev[]>();
    for (const e of sorted) {
      const arr = m.get(e.date) ?? [];
      arr.push(e);
      m.set(e.date, arr);
    }
    return [...m.entries()];
  }, [events, filter, today]);

  const FILTERS: { id: "avenir" | "passe" | "tous"; label: string }[] = [
    { id: "avenir", label: "À venir" },
    { id: "passe", label: "Passés" },
    { id: "tous", label: "Tous" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex w-fit gap-1 rounded-xl bg-panel p-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              "rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors",
              filter === f.id ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      {groups.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground shadow-sm">
          Aucun événement {filter === "passe" ? "passé" : filter === "avenir" ? "à venir" : ""}.
        </div>
      ) : (
        groups.map(([date, evs]) => (
        <div key={date} className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          <div className="border-b border-border bg-panel px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
            {formatListDay(date)}
          </div>
          <div>
            {evs.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => onEventClick(e)}
                className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-rowhover"
              >
                <span className="w-12 shrink-0 text-[12px] font-medium tabular-nums text-muted-foreground">
                  {e.time || "—"}
                </span>
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", chipBg(e))} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{e.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    <span className={chipText(e)}>{chipLabel(e)}</span>
                    {e.who && ` · ${e.who}`}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
        ))
      )}
    </div>
  );
}

// ─── Modale (création / édition) ─────────────────────────────────────────────

function EventModal({
  draft,
  setDraft,
  whoOptions,
  onSubmit,
  onDelete,
  onClose,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  whoOptions: { value: string; label: string }[];
  onSubmit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const isEdit = draft.id !== null;
  const canSave = draft.title.trim().length > 0 && draft.date.length > 0;
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) onSubmit();
        }}
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-sm"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm font-semibold text-foreground">
            {isEdit ? "Modifier l'événement" : "Nouvel événement"}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <TextField
            label="Titre"
            value={draft.title}
            onChange={(v) => setDraft({ ...draft, title: v })}
            placeholder="Intitulé de l'événement"
          />
          <div className="flex flex-wrap gap-3">
            <TextField
              label="Date"
              type="date"
              value={draft.date}
              onChange={(v) => setDraft({ ...draft, date: v })}
            />
            <TextField
              label="Heure"
              type="time"
              value={draft.time === "—" ? "" : draft.time}
              onChange={(v) => setDraft({ ...draft, time: v })}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <SelectField
              label="Type"
              value={draft.type}
              onChange={(v) => setDraft({ ...draft, type: v })}
              options={TYPE_OPTIONS}
            />
            <SelectField
              label="Avec qui"
              value={draft.who}
              onChange={(v) => setDraft({ ...draft, who: v })}
              options={whoOptions}
            />
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          {isEdit ? (
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[#E5484D] transition-colors hover:bg-rowhover"
            >
              <Trash2 className="h-3.5 w-3.5" /> Supprimer
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border bg-surface px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={!canSave}
              className="rounded-lg bg-primary px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Enregistrer
            </button>
          </div>
        </div>
        {showConfirm && (
          <ConfirmDialog
            title="Supprimer l'événement"
            message="Cette action est irréversible."
            confirmLabel="Supprimer"
            danger
            onCancel={() => setShowConfirm(false)}
            onConfirm={() => {
              setShowConfirm(false);
              onDelete();
            }}
          />
        )}
      </form>
    </div>
  );
}
