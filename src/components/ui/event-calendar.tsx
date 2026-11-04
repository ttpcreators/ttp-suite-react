import { CollabField, ObjectCollabLink } from "@/components/collab-links";
import { useStickyState } from "@/lib/useStickyState";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X, Trash2 } from "@/components/icons";
import { AddButton, Field, TextField, TextAreaField, SelectField } from "@/components/ui/form";
import { CreatorPicker } from "@/components/ui/creator-picker";
import { ConfirmDialog } from "@/components/ui/action-menu";
import { cn, titleCase } from "@/lib/utils";
import { fmtDay } from "@/lib/dates";
import { Tabs } from "@/components/ui/animated-tabs";
import { Overlay } from "@/components/mobile/ios-sheet";
import { isPhoneNow, useIsPhone } from "@/lib/iosUi";
import { useLang, useT, type Lang } from "@/lib/i18n";

type T = (fr: string, vars?: Record<string, string | number>) => string;

export type Ev = {
  id: string;
  date: string; // YYYY-MM-DD
  time: string;
  title: string;
  type: string;
  who: string | null;
  description?: string | null;
  /** Création seulement : collab à relier (agence, après le SQL collab_id). Jamais écrit dans `events` tel quel. */
  collabId?: string;
  /** Catégorie de la puce. Par défaut "event" (vrai rendez-vous, modifiable).
   *  "brief" / "todo" / "facture" / "contrat" / "exclu" / "anniv" = échéances superposées en
   *  LECTURE SEULE (clic = navigation). */
  kind?: Kind;
};

type Kind = "event" | "brief" | "todo" | "facture" | "post" | "contrat" | "exclu" | "anniv";
/** Puces superposées : jamais modifiables ici, un clic ouvre leur page. */
export type OverlayKind = Exclude<Kind, "event">;
/** Catégories affichées seulement quand il y en a (agenda agence, pas l'espace créateur). */
const OPTIONAL_KINDS: Kind[] = ["post", "contrat", "exclu", "anniv"];

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

// Couleur du trait de la puce, une par type de rendez-vous (seule légende de couleur).
const TYPE_BG: Record<string, string> = {
  call: "bg-blue-500",
  reunion: "bg-sky-400",
  collab: "bg-emerald-500",
  shoot: "bg-zinc-800 dark:bg-zinc-200",
  event: "bg-violet-500",
  voyage: "bg-amber-500",
  deadline: "bg-red-500",
};
function typeBg(t: string) {
  return TYPE_BG[t] ?? "bg-violet-500";
}
function typeLabel(t: string, tr: T) {
  const label = TYPE_OPTIONS.find((o) => o.value === t)?.label;
  return label ? tr(label) : t;
}

// ─── Overlays lecture seule (briefs / to-do datés) ───────────────────────────
// Une puce peut être un vrai événement (couleur = son type) OU une échéance
// dérivée d'un brief (bleu-vert) / d'une to-do (indigo), affichée en lecture seule.
function evKind(e: Ev): Kind {
  return e.kind ?? "event";
}
/** Trait de couleur d'une puce : le type pour un rendez-vous, gris pour une échéance
 *  (brief, to-do, facture, lecture seule), rose Instagram pour un post. */
function chipBg(e: Ev) {
  if (e.kind === "brief" || e.kind === "todo" || e.kind === "facture" || e.kind === "contrat" || e.kind === "exclu") return "bg-zinc-300 dark:bg-zinc-600";
  if (e.kind === "post") return "bg-pink-500";
  if (e.kind === "anniv") return "bg-yellow-400";
  return typeBg(e.type);
}
/** Libellé de catégorie (vue Semaine et Liste) : discret, la couleur est portée par le trait. */
function chipText(_e: Ev) {
  return "text-muted-foreground";
}
function chipLabel(e: Ev, t: T) {
  if (e.kind === "brief") return t("Brief");
  if (e.kind === "todo") return t("To-do");
  if (e.kind === "facture") return t("Facture");
  if (e.kind === "post") return t("Post Instagram");
  if (e.kind === "contrat") return t("Fin de contrat");
  if (e.kind === "exclu") return t("Fin d'exclu");
  if (e.kind === "anniv") return t("Anniversaire");
  return typeLabel(e.type, t);
}

const KIND_META: { id: Kind; label: string; dot: string }[] = [
  { id: "event", label: "Événements", dot: "bg-primary" },
  { id: "brief", label: "Briefs", dot: "bg-info" },
  { id: "todo", label: "To-do", dot: "bg-indigo" },
  { id: "facture", label: "Factures", dot: "bg-signal" },
  { id: "post", label: "Posts Instagram", dot: "bg-pink-500" },
  { id: "contrat", label: "Contrats", dot: "bg-zinc-400" },
  { id: "exclu", label: "Exclusivités", dot: "bg-zinc-400" },
  { id: "anniv", label: "Anniversaires", dot: "bg-yellow-400" },
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
// Espace créateur en anglais (LangProvider) : mêmes tableaux, en anglais.
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const monthsOf = (lang: Lang) => (lang === "en" ? MONTHS_EN : MONTHS_FR);
const daysOf = (lang: Lang) => (lang === "en" ? DAYS_EN : DAYS_FR);

function monthTitle(d: Date, lang: Lang) {
  return `${monthsOf(lang)[d.getMonth()]} ${d.getFullYear()}`;
}
/** Séparateur de jour de la liste : « Mer. 4 nov. » (format commun des dates + jour de semaine). */
function formatListDay(key: string, lang: Lang) {
  const [y, m, dd] = key.split("-").map(Number);
  const d = new Date(y, (m ?? 1) - 1, dd ?? 1);
  const locale = lang === "en" ? "en-GB" : "fr-FR";
  const wd = d.toLocaleDateString(locale, { weekday: "short" });
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${fmtDay(d, locale)}`;
}

// ─── Composant ───────────────────────────────────────────────────────────────

type Draft = {
  id: string | null;
  date: string;
  time: string;
  title: string;
  type: string;
  who: string;
  description: string;
  /** Nouvel événement : collab à relier (Planning agence). */
  collabId?: string;
  /** Lecture seule (ex. évènement partagé que l'utilisateur ne peut pas modifier). */
  readOnly?: boolean;
};

function emptyDraft(date: string): Draft {
  return { id: null, date, time: "", title: "", type: "call", who: "", description: "" };
}

/** Résultat d'un callback : false = échec (la modale reste ouverte), sinon succès. */
type CbResult = void | boolean | Promise<void | boolean>;

export function EventCalendar({
  events,
  onCreate,
  onUpdate,
  onDelete,
  onNavigate,
  creators = [],
  isReadOnly,
  fixedWho,
  navAdd = false,
  collabLinks = false,
}: {
  events: Ev[];
  /** Peuvent renvoyer false (ou Promise<false>) en cas d'échec : la modale reste ouverte. */
  onCreate: (e: Omit<Ev, "id">) => CbResult;
  onUpdate: (id: string, patch: Partial<Ev>) => CbResult;
  onDelete: (id: string) => CbResult;
  /** Évènement ouvert en lecture seule (pas d'enregistrement ni de suppression). */
  isReadOnly?: (e: Ev) => boolean;
  /** « Avec qui » imposé (champ masqué, jamais vidé) : ex. espace créateur. */
  fixedWho?: string;
  /** Clic sur une échéance brief/to-do/facture (lecture seule) → navigation vers sa page. */
  onNavigate?: (kind: OverlayKind, ev: Ev) => void;
  creators?: { name: string; photo_url?: string | null }[];
  /** Téléphone : « + » dans la barre de titre pour créer un événement (Planning agence). */
  navAdd?: boolean;
  /** Champ « Collab » (Planning agence seulement, jamais l'espace créateur). */
  collabLinks?: boolean;
}) {
  const t = useT();
  const phone = useIsPhone();
  const lang = useLang();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  // Téléphone : l'agenda en liste se lit mieux qu'une grille de mois.
  const [view, setView] = useStickyState<View>("agenda:vue", ["month", "week", "list"], () => (isPhoneNow() ? "list" : "month"));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false); // enregistrement / suppression en cours
  // Filtres de catégorie (événements / briefs / to-do) — actifs par défaut.
  const [kinds, setKinds] = useState<Record<Kind, boolean>>({ event: true, brief: true, todo: true, facture: true, post: true, contrat: true, exclu: true, anniv: true });

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

  // « Avec qui » : le roster (photos), plus les noms déjà utilisés qui n'y sont plus.
  const whoExtra = useMemo(() => {
    const names = new Set<string>();
    for (const e of events) if (e.who && e.who !== "—") names.add(e.who);
    return [...names].sort();
  }, [events]);

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
      else {
        // Normalise au 1er du mois AVANT de décaler : avec un jour ≥ 29 (curseur
        // hérité de la vue semaine), setMonth déborderait et sauterait un mois.
        d.setDate(1);
        d.setMonth(d.getMonth() + delta);
      }
      return d;
    });
  }

  // Ouverture des modales
  function openCreate(date: string) {
    setDraft(emptyDraft(date));
  }
  function openEdit(e: Ev) {
    setDraft({ id: e.id, date: e.date, time: e.time, title: e.title, type: e.type, who: e.who ?? "", description: e.description ?? "", readOnly: isReadOnly?.(e) ?? false });
  }
  // Un vrai événement s'édite ; une échéance brief/to-do renvoie vers sa page.
  function handleEventClick(e: Ev) {
    if (e.kind && e.kind !== "event") {
      onNavigate?.(e.kind, e);
      return;
    }
    openEdit(e);
  }
  function closeModal() {
    setDraft(null);
  }
  // La modale ne se ferme qu'après succès (undefined = succès, compat anciens appels).
  async function submit() {
    if (!draft || draft.readOnly || busy) return;
    const who = fixedWho ?? (draft.who ? draft.who : null);
    const payload = {
      date: draft.date,
      time: draft.time,
      title: draft.title.trim(),
      type: draft.type,
      who,
      description: draft.description.trim() ? draft.description.trim() : null,
    };
    setBusy(true);
    try {
      const ok = draft.id ? await onUpdate(draft.id, payload) : await onCreate(collabLinks && draft.collabId ? { ...payload, collabId: draft.collabId } : payload);
      if (ok !== false) setDraft(null);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!draft?.id || draft.readOnly || busy) return;
    setBusy(true);
    try {
      const ok = await onDelete(draft.id);
      if (ok !== false) setDraft(null);
    } finally {
      setBusy(false);
    }
  }

  const headerTitle = view === "week" ? weekRangeTitle(cursor, lang) : monthTitle(cursor, lang);

  return (
    <div className="flex flex-col gap-4">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Vue Liste : pas de navigation par mois (la liste a son propre filtre À venir / Passés / Tous). */}
        {view !== "list" ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => shift(-1)}
            className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-surface text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
            aria-label={t("Précédent")}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-surface text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
            aria-label={t("Suivant")}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="h-8 rounded-lg border border-border bg-surface px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-rowhover"
          >
            {t("Aujourd'hui")}
          </button>
          <div className="ml-2 text-[18px] font-semibold capitalize text-foreground">{headerTitle}</div>
        </div>
        ) : <div />}

        {/* ViewToggle */}
        <Tabs
          size="md"
          label={t("Vue du calendrier")}
          value={view}
          onValueChange={(next) => {
            const v = next as View;
            if (v === "week") setCursor((c) => startOfWeek(c));
            // Mois : recale au 1er du mois du curseur (cohérent + pas d'overflow).
            if (v === "month") setCursor((c) => new Date(c.getFullYear(), c.getMonth(), 1));
            setView(v);
          }}
          items={[
            { value: "month", label: t("Mois") },
            { value: "week", label: t("Semaine") },
            { value: "list", label: t("Liste") },
          ]}
        />
      </div>

      {/* Filtres de catégorie (cliquables), puis la légende des types de rendez-vous. */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
        {KIND_META.map((k) => {
          const on = kinds[k.id];
          const count = events.filter((e) => evKind(e) === k.id).length;
          // Posts Instagram : seulement là où il y en a (agenda agence), pas dans l'espace créateur.
          if (OPTIONAL_KINDS.includes(k.id) && !count) return null;
          return (
            <button
              key={k.id}
              type="button"
              aria-pressed={on}
              onClick={() => setKinds((s) => ({ ...s, [k.id]: !s[k.id] }))}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition-colors",
                on ? "border-border bg-surface text-foreground" : "border-transparent text-faint line-through decoration-faint/60 hover:text-muted-foreground",
              )}
              title={on ? t("Masquer : {label}", { label: t(k.label) }) : t("Afficher : {label}", { label: t(k.label) })}
            >
              {t(k.label)}
              <span className="tabular-nums text-faint no-underline">{count}</span>
            </button>
          );
        })}
        <span className="mx-2 h-4 w-px shrink-0 bg-border max-sm:hidden" />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {TYPE_OPTIONS.map((o) => (
            <span key={o.value} className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <span className={cn("h-3 w-[3px] shrink-0 rounded-full", typeBg(o.value))} />
              {t(o.label)}
            </span>
          ))}
        </div>
      </div>

      {navAdd && phone && <AddButton navBar label={t("Événement")} onClick={() => openCreate(tKey)} />}
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
          creators={creators}
          whoExtra={whoExtra}
          hideWho={fixedWho !== undefined}
          collabLinks={collabLinks}
          busy={busy}
          onSubmit={submit}
          onDelete={remove}
          onClose={closeModal}
        />
      )}
    </div>
  );
}

function weekRangeTitle(cursor: Date, lang: Lang) {
  const start = startOfWeek(cursor);
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  const MONTHS = monthsOf(lang);
  if (sameMonth) return `${start.getDate()}–${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
  return `${start.getDate()} ${MONTHS[start.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
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
  const lang = useLang();
  const t = useT();

  return (
    <div className="overflow-x-auto overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="grid min-w-[320px] grid-cols-7 border-b border-border bg-panel sm:min-w-0">
        {daysOf(lang).map((d) => (
          <div key={d} className="px-2 py-2 text-center text-[12px] font-medium text-muted-foreground">
            {d}
          </div>
        ))}
      </div>
      <div className="grid min-w-[320px] grid-cols-7 sm:min-w-0">
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
                "group relative flex min-h-[92px] flex-col gap-1 border-b border-r border-border p-1.5 text-left transition-colors hover:bg-rowhover md:min-h-[112px]",
                i % 7 === 6 && "border-r-0",
                i >= 35 && "border-b-0",
                (!inMonth || i % 7 >= 5) && "bg-panel/50",
                isToday && "bg-primary/[0.05]",
              )}
            >
              <span
                className={cn(
                  "grid h-6 min-w-6 place-items-center self-start rounded-full px-1 text-[12px] font-medium tabular-nums",
                  inMonth ? "text-foreground" : "text-faint",
                  isToday && "bg-primary text-primary-foreground",
                )}
              >
                {d.getDate()}
              </span>
              {/* Mobile (< sm) : cellules trop étroites pour du texte → pastilles colorées (max 3 + « +n »), un tap ouvre l'événement. */}
              {shown.length > 0 && (
                <div className="flex flex-wrap items-center justify-center sm:hidden">
                  {shown.map((e) => (
                    <span
                      key={e.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${e.time ? e.time + " · " : ""}${e.title}`}
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
                      className="grid place-items-center p-1"
                      title={`${e.time ? e.time + " · " : ""}${e.title}`}
                    >
                      <span className={cn("block h-2 w-2 rounded-full", chipBg(e))} />
                    </span>
                  ))}
                  {extra > 0 && <span className="text-[9px] font-medium leading-none text-muted-foreground">+{extra}</span>}
                </div>
              )}
              <div className="hidden flex-col gap-1 sm:flex">
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
                    className="relative flex items-center gap-1.5 truncate rounded-md bg-surface py-0.5 pl-2.5 pr-1.5 text-[11.5px] text-foreground ring-1 ring-border/70 transition-colors hover:bg-rowhover"
                    title={`${e.time ? e.time + " · " : ""}${e.kind && e.kind !== "event" ? `${chipLabel(e, t)} · ` : ""}${e.title}`}
                  >
                    <span aria-hidden className={cn("absolute inset-y-1 left-1 w-[3px] rounded-full", chipBg(e))} />
                    {e.time && e.time !== "—" && <span className="shrink-0 tabular-nums text-muted-foreground">{e.time}</span>}
                    {e.kind && e.kind !== "event" && !e.title.toLowerCase().startsWith(chipLabel(e, t).toLowerCase()) && (
                      <span className="shrink-0 text-muted-foreground">{chipLabel(e, t)}</span>
                    )}
                    <span className="truncate">{e.title}</span>
                  </span>
                ))}
                {extra > 0 && (
                  <span className="px-1 text-[11px] font-medium text-muted-foreground">{extra} de plus</span>
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
  const t = useT();
  const lang = useLang();

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
              <span className="text-[12px] font-medium text-muted-foreground">{daysOf(lang)[i]}</span>
              <span className={cn("text-sm font-semibold tabular-nums", isToday ? "text-primary" : "text-foreground")}>
                {d.getDate()}
              </span>
            </button>
            <div className="flex flex-1 flex-col gap-1.5 p-2">
              {dayEvents.length === 0 && (
                <span className="px-1 py-2 text-[11px] text-faint">{t("Aucun événement")}</span>
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
                      <span className={chipText(e)}>{chipLabel(e, t)}</span>
                      {e.who && ` · ${titleCase(e.who)}`}
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
  const t = useT();
  const lang = useLang();
  const [filter, setFilter] = useStickyState("agenda:liste", ["avenir", "passe", "tous"] as const, "avenir");
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
    { id: "avenir", label: t("À venir") },
    { id: "passe", label: t("Passés") },
    { id: "tous", label: t("Tous") },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        size="sm"
        label={t("Filtrer les événements")}
        value={filter}
        onValueChange={(v) => setFilter(v as "avenir" | "passe" | "tous")}
        items={FILTERS.map((f) => ({ value: f.id, label: f.label }))}
      />
      {groups.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground shadow-sm">
          {filter === "passe" ? t("Aucun événement passé.") : filter === "avenir" ? t("Aucun événement à venir.") : t("Aucun événement .")}
        </div>
      ) : (
        groups.map(([date, evs]) => (
        <div key={date} className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          <div className="border-b border-border bg-panel px-4 py-2 text-[12px] font-medium text-muted-foreground">
            {formatListDay(date, lang)}
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
                    <span className={chipText(e)}>{chipLabel(e, t)}</span>
                    {e.who && ` · ${titleCase(e.who)}`}
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
  creators,
  whoExtra,
  hideWho = false,
  collabLinks = false,
  busy = false,
  onSubmit,
  onDelete,
  onClose,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  creators: { name: string; photo_url?: string | null }[];
  whoExtra: string[];
  hideWho?: boolean;
  collabLinks?: boolean;
  busy?: boolean;
  onSubmit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const isEdit = draft.id !== null;
  const ro = !!draft.readOnly;
  const canSave = !ro && !busy && draft.title.trim().length > 0 && draft.date.length > 0;
  const [showConfirm, setShowConfirm] = useState(false);
  const t = useT();
  const typeOptions = TYPE_OPTIONS.map((o) => ({ value: o.value, label: t(o.label) }));

  return (
    <Overlay className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClose={onClose}>
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
            {ro ? t("Détail de l'événement") : isEdit ? t("Modifier l'événement") : t("Nouvel événement")}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-full text-faint transition-colors hover:bg-rowhover hover:text-foreground"
            aria-label={t("Fermer")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {ro && (
          <div className="mb-3 rounded-lg bg-panel px-3 py-2 text-[12px] text-muted-foreground">
            {t("Événement partagé avec plusieurs personnes : seule l'agence peut le modifier.")}
          </div>
        )}
        {/* fieldset désactivé = champs non modifiables en lecture seule */}
        <fieldset disabled={ro} className={cn("flex min-w-0 flex-col gap-3", ro && "pointer-events-none")}>
          <TextField
            label={t("Titre")}
            value={draft.title}
            onChange={(v) => setDraft({ ...draft, title: v })}
            placeholder={t("Intitulé de l'événement")}
            mentions={hideWho ? undefined : creators}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField
              label={t("Date")}
              type="date"
              value={draft.date}
              onChange={(v) => setDraft({ ...draft, date: v })}
            />
            <TextField
              label={t("Heure")}
              type="time"
              value={draft.time === "—" ? "" : draft.time}
              onChange={(v) => setDraft({ ...draft, time: v })}
            />
          </div>
          <div className={cn("grid grid-cols-1 gap-3", !hideWho && "sm:grid-cols-2")}>
            <SelectField
              label={t("Type")}
              value={draft.type}
              onChange={(v) => setDraft({ ...draft, type: v })}
              options={typeOptions}
            />
            {!hideWho && (
              <Field label={t("Avec qui")}>
                <CreatorPicker
                  ariaLabel={t("Avec qui")}
                  value={draft.who === "—" ? "" : draft.who}
                  onChange={(v) => setDraft({ ...draft, who: v })}
                  creators={creators}
                  extraNames={whoExtra}
                />
              </Field>
            )}
            {collabLinks && !draft.readOnly && (
              draft.id ? (
                <ObjectCollabLink table="events" id={draft.id} creator={(draft.who ?? "").split(",")[0]?.trim() || null} withLabel />
              ) : (
                <CollabField value={draft.collabId ?? ""} onChange={(v) => setDraft({ ...draft, collabId: v || undefined })} creator={(draft.who ?? "").split(",")[0]?.trim() || null} />
              )
            )}
          </div>
          <TextAreaField
            label={t("Description / commentaire")}
            value={draft.description}
            onChange={(v) => setDraft({ ...draft, description: v })}
            mentions={hideWho ? undefined : creators}
            placeholder={t("Notes, ordre du jour, lien visio… (synchronisé avec Google Agenda)")}
          />
        </fieldset>

        <div className="mt-5 flex items-center justify-between gap-2">
          {isEdit && !ro ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowConfirm(true)}
              className="flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-[12px] font-medium text-destructive transition-colors hover:bg-rowhover"
            >
              <Trash2 className="h-3.5 w-3.5" /> {t("Supprimer")}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-border bg-surface px-4 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
            >
              {ro ? t("Fermer") : t("Annuler")}
            </button>
            {!ro && (
              <button
                type="submit"
                disabled={!canSave}
                className="rounded-full bg-primary px-5 py-2 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {busy ? t("Enregistrement…") : t("Enregistrer")}
              </button>
            )}
          </div>
        </div>
        {showConfirm && (
          <ConfirmDialog
            title={t("Supprimer l'événement")}
            message={t("Cette action est irréversible.")}
            confirmLabel={t("Supprimer définitivement")}
            danger
            onCancel={() => setShowConfirm(false)}
            onConfirm={() => {
              setShowConfirm(false);
              onDelete();
            }}
          />
        )}
      </form>
    </Overlay>
  );
}
