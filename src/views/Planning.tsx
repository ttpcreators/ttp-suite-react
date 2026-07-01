import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useSearch, matchQuery } from "@/lib/search";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { dbInsert, dbDelete, nextOrder } from "@/lib/db";
import { toast } from "@/components/ui/toast";
import { AddButton, InlineForm, TextField, SelectField, DeleteButton } from "@/components/ui/form";
import { useCreators } from "@/lib/useCreators";
import { useEffect, useMemo, useState } from "react";
import { Calendar, Clock } from "lucide-react";

type Row = {
  id: string | number;
  day: number;
  date: string;
  time: string;
  title: string;
  type: string;
  who: string;
  sort_order: number;
};

type EventTone = "indigo" | "cyan" | "signal";
type BadgeStatus = "info" | "success" | "neutral";

const EVENT_TYPES: Record<string, { label: string; tone: EventTone }> = {
  call: { label: "Call", tone: "indigo" },
  reunion: { label: "Réunion", tone: "cyan" },
  collab: { label: "Collab", tone: "signal" },
  shoot: { label: "Shoot", tone: "indigo" },
  event: { label: "Event", tone: "signal" },
  voyage: { label: "Voyage", tone: "cyan" },
  deadline: { label: "Deadline", tone: "cyan" },
};

const TYPE_OPTIONS = [
  { value: "call", label: "Call" },
  { value: "reunion", label: "Réunion" },
  { value: "collab", label: "Collab" },
  { value: "shoot", label: "Shoot" },
  { value: "event", label: "Event" },
  { value: "voyage", label: "Voyage" },
  { value: "deadline", label: "Deadline" },
];

const TONE_DOT: Record<EventTone, string> = {
  indigo: "bg-indigo",
  cyan: "bg-cyan",
  signal: "bg-signal",
};

const TONE_STATUS: Record<EventTone, BadgeStatus> = {
  indigo: "info",
  cyan: "neutral",
  signal: "success",
};

const WEEKDAYS_SHORT = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
const WEEKDAYS_HEAD = ["LUN", "MAR", "MER", "JEU", "VEN", "SAM", "DIM"];
const MONTHS = [
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

function eventMeta(type: string) {
  return EVENT_TYPES[type] ?? EVENT_TYPES.call;
}

function weekdayAbbr(date: string): string {
  const d = new Date(date + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "";
  return (WEEKDAYS_SHORT[d.getDay()] ?? "").toUpperCase();
}

export function Planning() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<boolean>(false);
  const { query } = useSearch();
  const creators = useCreators();

  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [type, setType] = useState("call");
  const [who, setWho] = useState("");

  useEffect(() => {
    let active = true;
    const today = new Date().toISOString().slice(0, 10);

    supabase
      .from("events")
      .select("id, day, date, time, title, type, who, sort_order")
      .order("sort_order")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setError(true);
          setRows([]);
          return;
        }
        const list = ((data as Row[] | null) ?? [])
          .filter((r) => r.date >= today)
          .sort((a, b) => a.date.localeCompare(b.date));
        setRows(list);
      });

    return () => {
      active = false;
    };
  }, []);

  const submit = async () => {
    if (!title.trim()) {
      toast("Renseigne le titre");
      return;
    }
    const row = {
      day: Number((date || "").split("-")[2]) || 1,
      date: date || null,
      time: time || "—",
      title: title.trim(),
      type,
      who: who || null,
      sort_order: nextOrder(rows ?? []),
    };
    const created = await dbInsert("events", row);
    if (!created) {
      toast("Erreur — réessaie");
      return;
    }
    const next = [created as unknown as Row, ...(rows ?? [])].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    setRows(next);
    toast("Événement ajouté ✓");
    setFormOpen(false);
    setTitle("");
    setDate("");
    setTime("");
    setType("call");
    setWho("");
  };

  const filtered = (rows ?? []).filter((row) =>
    matchQuery(query, row.title, row.who, row.type),
  );

  // Build a simple month grid for the current month, with event dots.
  const calendar = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const todayStr = now.toISOString().slice(0, 10);

    const byDate = new Map<string, EventTone[]>();
    for (const r of rows ?? []) {
      if (!r.date.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`))
        continue;
      const tones = byDate.get(r.date) ?? [];
      tones.push(eventMeta(r.type).tone);
      byDate.set(r.date, tones);
    }

    const first = new Date(year, month, 1);
    // Monday-first offset (getDay: 0=Sun..6=Sat)
    const lead = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: {
      key: string;
      day: number | null;
      date: string;
      isToday: boolean;
      tones: EventTone[];
    }[] = [];

    for (let i = 0; i < lead; i++)
      cells.push({ key: `pad-${i}`, day: null, date: "", isToday: false, tones: [] });

    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({
        key: date,
        day: d,
        date,
        isToday: date === todayStr,
        tones: byDate.get(date) ?? [],
      });
    }

    return { label: `${MONTHS[month]} ${year}`, cells };
  }, [rows]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header bar */}
      <div className="mb-0 flex items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {rows === null
            ? "Chargement…"
            : `${rows.length} événement${rows.length > 1 ? "s" : ""} à venir`}
        </div>
        <AddButton label="Événement" onClick={() => setFormOpen(true)} />
      </div>

      <InlineForm
        open={formOpen}
        title="Nouvel événement"
        onClose={() => setFormOpen(false)}
        onSubmit={submit}
      >
        <TextField label="Titre" value={title} onChange={setTitle} placeholder="Titre" />
        <TextField label="Date" value={date} onChange={setDate} placeholder="AAAA-MM-JJ" />
        <TextField label="Heure" value={time} onChange={setTime} placeholder="14:30" />
        <SelectField label="Type" value={type} onChange={setType} options={TYPE_OPTIONS} />
        <SelectField
          label="Avec qui"
          value={who}
          onChange={setWho}
          options={[
            { value: "", label: "—" },
            ...creators.map((c) => ({ value: c.name, label: c.name })),
          ]}
        />
      </InlineForm>

      {/* Calendar grid */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold capitalize text-foreground">
            {calendar.label}
          </span>
        </div>

        <div className="mb-2 grid grid-cols-7 gap-1.5">
          {WEEKDAYS_HEAD.map((w) => (
            <div
              key={w}
              className="py-1 text-center text-[9px] font-semibold tracking-wider text-faint"
            >
              {w}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {calendar.cells.map((c) => (
            <div
              key={c.key}
              className={cn(
                "flex min-h-[52px] flex-col rounded-xl p-1.5 sm:min-h-[72px] sm:p-2",
                c.day === null
                  ? "bg-transparent"
                  : c.isToday
                    ? "border border-signal bg-signal/10"
                    : "bg-surface",
              )}
            >
              {c.day !== null && (
                <>
                  <span
                    className={cn(
                      "text-[11px] font-semibold sm:text-xs",
                      c.isToday ? "text-signaltext" : "text-foreground",
                    )}
                  >
                    {c.day}
                  </span>
                  {c.tones.length > 0 && (
                    <div className="mt-auto flex flex-wrap gap-1 pt-1">
                      {c.tones.slice(0, 4).map((tone, i) => (
                        <span
                          key={i}
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            TONE_DOT[tone],
                          )}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Prochains jours */}
      <div className="rounded-2xl border border-border bg-card px-4 shadow-sm sm:px-5">
        <div className="px-1 pb-1 pt-4 text-sm font-semibold text-foreground">
          Prochains jours
        </div>

        {rows === null ? (
          <div className="px-1 py-3 pb-4">
            <AnimatedBadge status="loading" size="sm">
              Chargement…
            </AnimatedBadge>
          </div>
        ) : error ? (
          <div className="px-1 py-3 pb-4 text-sm text-muted-foreground">
            Impossible de charger le planning.
          </div>
        ) : rows.length === 0 ? (
          <div className="px-1 py-3 pb-4 text-sm text-muted-foreground">
            Aucun événement à venir
          </div>
        ) : query.trim() && filtered.length === 0 ? (
          <div className="px-1 py-8 pb-8 text-center text-sm text-muted-foreground">
            Aucun résultat pour « {query} »
          </div>
        ) : (
          <ul className="pb-3">
            {filtered.map((row, index) => {
              const meta = eventMeta(row.type);
              return (
                <li
                  key={row.id}
                  className={cn(
                    "flex items-center gap-3 px-1 py-3 sm:gap-4",
                    index > 0 && "border-t border-border",
                  )}
                >
                  {/* Day box */}
                  <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-rowhover text-center">
                    <span className="text-[15px] font-bold leading-none text-foreground">
                      {row.day}
                    </span>
                    <span className="mt-0.5 text-[8px] font-semibold text-muted-foreground/70">
                      {weekdayAbbr(row.date)}
                    </span>
                  </div>

                  {/* Time */}
                  <div className="hidden w-12 shrink-0 items-center gap-1 text-xs font-semibold text-muted-foreground sm:flex">
                    <Clock className="h-3 w-3" />
                    {row.time}
                  </div>

                  {/* Type dot */}
                  <span
                    className={cn(
                      "hidden h-1.5 w-1.5 shrink-0 rounded-full sm:block",
                      TONE_DOT[meta.tone],
                    )}
                  />

                  {/* Title + who */}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-foreground">
                      {row.title}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-faint sm:hidden">
                      <span>{row.time}</span>
                      {row.who && (
                        <>
                          <span>·</span>
                          <span className="truncate">{row.who}</span>
                        </>
                      )}
                    </div>
                    {row.who && (
                      <div className="mt-0.5 hidden truncate text-[10px] text-faint sm:block">
                        {row.who}
                      </div>
                    )}
                  </div>

                  {/* Type tag */}
                  <AnimatedBadge status={TONE_STATUS[meta.tone]} size="sm">
                    {meta.label}
                  </AnimatedBadge>

                  {/* Delete */}
                  <DeleteButton
                    onClick={async () => {
                      if (await dbDelete("events", String(row.id))) {
                        setRows((rows ?? []).filter((r) => r.id !== row.id));
                        toast("Supprimé");
                      }
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
