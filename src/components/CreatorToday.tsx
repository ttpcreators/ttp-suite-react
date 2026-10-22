import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BarChart3, CalendarDays, Camera, Check, ChevronRight, FileText, ListChecks, PenLine, Phone, Receipt, X, type LucideIcon } from "@/components/icons";
import { IconTile } from "@/components/ui/icon-tile";
import { Kbd } from "@/components/ui/kbd";
import { ProgressRing } from "@/components/ui/progress-ring";
import { Overlay } from "@/components/mobile/ios-sheet";
import { cn } from "@/lib/utils";
import { EMPTY, fmtAgoDays, fmtDay } from "@/lib/dates";
import { useLang, useLocale, useT } from "@/lib/i18n";
import { TONE_TEXT, type StatusTone } from "@/lib/statusTone";
import { addDaysISO, handledToday, localISO, markHandled, parseHandled, parseSnooze, snooze, unmarkHandled, type HandledMap, type SnoozeMap } from "@/lib/aujourdhui";
import type { NextStep, NextStepInput } from "@/lib/creatorNextStep";
import { CT_HANDLED_KEY, CT_SNOOZE_KEY, creatorKindLabel, creatorTodayItems, creatorTodaySections, creatorVerb, type CtItem } from "@/lib/creatorToday";

/*
 * Page « Aujourd'hui » de l'espace créateur, dans l'esprit de la page agence :
 * carte d'état (anneau, « Tout est traité »), actions rangées par moment, panneau
 * détail à droite (feuille du bas sur téléphone), raccourcis J / K / E sur ordinateur.
 * Données : celles que l'espace lit déjà (RLS du créateur), logique dans src/lib/creatorToday.ts.
 */

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

function readKey(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function writeKey(key: string, v: unknown) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(v));
  } catch {
    /* stockage indisponible : l'état reste pour la session */
  }
}

const ICON: Record<NextStep["kind"], LucideIcon> = {
  deliverable: Camera, validate: FileText, script: PenLine, event: CalendarDays, todo: ListChecks, stats: BarChart3, invoice: Receipt,
};
const iconOf = (s: CtItem): LucideIcon => (s.kind === "event" && /call|appel/i.test(s.vars.text ?? "") ? Phone : ICON[s.kind]);
// Teinte de la tuile : jamais de rouge (réservé à l'argent en retard côté agence).
const toneOf = (s: CtItem): StatusTone | undefined =>
  s.section === "late" ? "wait"
  : s.kind === "validate" || s.kind === "script" || s.kind === "stats" ? "info"
  : s.kind === "deliverable" || s.kind === "event" ? "progress"
  : s.kind === "invoice" ? "wait"
  : undefined;

type Props = {
  /** Ce que l'espace a déjà chargé (briefs, collabs, tâches, planning, factures, stats du mois). */
  data: Omit<NextStepInput, "now">;
  /** Ouvre l'action là où elle se traite (fiche mission, planning, envoi des stats, dépôt de facture). */
  onOpen: (s: NextStep) => void;
  /** Coche une tâche (true si c'est enregistré). */
  onDoneTodo: (todoId: string) => Promise<boolean>;
  /** Prioritaire dans le titre : la priorité haute des tâches (point rouge). */
  isHigh?: (todoId: string) => boolean;
};

export function CreatorToday({ data, onOpen, onDoneTodo, isHigh }: Props) {
  const t = useT();
  const lang = useLang();
  const locale = useLocale();
  const plural = (n: number, one: string, many: string) => t((lang === "en" ? n === 1 : n <= 1) ? one : many, { n });
  const isLg = useIsLg();

  const [snoozed, setSnoozed] = useState<SnoozeMap>(() => parseSnooze(readKey(CT_SNOOZE_KEY)));
  const [handled, setHandled] = useState<HandledMap>(() => parseHandled(readKey(CT_HANDLED_KEY)));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Jour de référence : fixé à l'ouverture de la page (le changement de jour se voit au retour).
  const [now] = useState(() => new Date());
  const today = localISO(now);
  const items = useMemo(() => creatorTodayItems({ ...data, now, snoozed, handled }), [data, now, snoozed, handled]);
  const sections = useMemo(() => creatorTodaySections(items, now), [items, now]);
  const done = handledToday(handled, today);
  const pendingNow = items.filter((i) => i.section === "late" || i.section === "today").length;
  const ahead = items.filter((i) => i.section === "week").length;
  const selected = items.find((i) => i.id === selectedId) ?? null;

  const select = useCallback(
    (id: string, openSheet: boolean) => {
      setSelectedId(id);
      if (openSheet && !isLg) setSheetOpen(true);
      document.querySelector(`[data-ct-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
    },
    [isLg],
  );

  const label = (s: CtItem) => t(s.title, s.vars);
  const doHandled = (s: CtItem) => {
    const next = markHandled(handled, s.id, label(s), today);
    setHandled(next);
    writeKey(CT_HANDLED_KEY, next);
    setSheetOpen(false);
  };
  const undoHandled = (id: string) => {
    const next = unmarkHandled(handled, id);
    setHandled(next);
    writeKey(CT_HANDLED_KEY, next);
  };
  const doSnooze = (s: CtItem) => {
    const next = snooze(snoozed, s.id, addDaysISO(today, 1), today);
    setSnoozed(next);
    writeKey(CT_SNOOZE_KEY, next);
    setSheetOpen(false);
  };
  /** Le verbe de la ligne : une tâche se termine ici, le reste s'ouvre là où il se traite. */
  const act = async (s: CtItem) => {
    if (s.target.tab === "todo") {
      if (busy) return;
      setBusy(true);
      const ok = await onDoneTodo(s.target.todoId);
      setBusy(false);
      if (ok) doHandled(s);
      return;
    }
    setSheetOpen(false);
    onOpen(s);
  };

  // Raccourcis (ordinateur) : J suivant, K précédent, E traiter.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const keyState = useRef({ items, selected, act });
  useEffect(() => {
    keyState.current = { items, selected, act };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement | null)?.isContentEditable) return;
      if (!rootRef.current?.getClientRects().length || document.querySelector('[role="dialog"]')) return;
      const { items: list, selected: cur, act: run } = keyState.current;
      const k = e.key.toLowerCase();
      if (k === "j" || k === "k") {
        if (!list.length) return;
        e.preventDefault();
        const i = cur ? list.findIndex((x) => x.id === cur.id) : -1;
        const next = k === "j" ? Math.min(list.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
        select(list[next].id, false);
      } else if (k === "e" && cur) {
        e.preventDefault();
        void run(cur);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  // Durée « 23 j » / « 4 mois » (dates.ts) ; en anglais « 23 d » / « 4 mo ».
  const dur = (d: number) =>
    lang === "en" ? (d < 30 ? `${d} d` : d < 365 ? `${Math.max(1, Math.round(d / 30))} mo` : `${Math.floor(d / 365)} y`) : fmtAgoDays(d);
  const whenSub = (s: CtItem): { text: string; tone?: StatusTone } | null => {
    if (s.days == null || s.days === 0) return null;
    if (s.days < 0) return { text: t("{d} de retard", { d: dur(-s.days) }), tone: "wait" };
    return { text: t("dans {d}", { d: dur(s.days) }) };
  };
  const subLine = (s: CtItem) => {
    const detail = t(s.detail, s.detailVars);
    const kind = t(creatorKindLabel(s));
    return detail === kind ? kind : `${detail} · ${kind}`;
  };
  const sectionRight = (from?: string, to?: string, n = 0) =>
    from && to ? t("{from} au {to}", { from: fmtDay(from, locale), to: fmtDay(to, locale) }) : from ? fmtDay(from, locale) : String(n);

  const inspector = selected ? (
    <Inspector
      it={selected}
      title={label(selected)}
      kind={t(creatorKindLabel(selected))}
      rows={[
        [t("Date"), selected.due ? fmtDay(selected.due, locale) : EMPTY],
        ...(selected.vars.brand ? ([[t("Marque"), selected.vars.brand]] as [string, ReactNode][]) : []),
        [t("Détail"), t(selected.detail, selected.detailVars)],
      ]}
      verb={t(creatorVerb(selected))}
      busy={busy}
      onPrimary={() => void act(selected)}
      onHandled={selected.target.tab === "todo" ? undefined : () => doHandled(selected)}
      onSnooze={() => doSnooze(selected)}
      onClose={() => {
        setSelectedId(null);
        setSheetOpen(false);
      }}
    />
  ) : null;

  return (
    <div ref={rootRef}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {/* État de la journée */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[20px] bg-surface p-5 shadow-sm">
            <ProgressRing value={done.length + pendingNow ? done.length / (done.length + pendingNow) : 1} />
            <div className="min-w-0 flex-1">
              <div className="text-[16px] font-semibold leading-snug text-foreground">
                {pendingNow ? plural(pendingNow, "{n} action à traiter", "{n} actions à traiter") : t("Tout est traité")}
              </div>
              {done.length > 0 && (
                <div className="text-[14px] leading-snug text-muted-foreground">
                  {plural(done.length, "{n} déjà faite aujourd'hui", "{n} déjà faites aujourd'hui")}
                </div>
              )}
              {ahead > 0 && (
                <div className="text-[14px] leading-snug text-muted-foreground">{t("+ {n} à anticiper cette semaine", { n: ahead })}</div>
              )}
            </div>
            {items.length > 0 && (
              <button
                type="button"
                onClick={() => select(items[0].id, true)}
                className="h-10 shrink-0 rounded-full bg-field px-4 text-[14px] font-semibold text-foreground transition-colors hover:bg-rowhover max-sm:basis-full"
              >
                {t("Tout parcourir")}
              </button>
            )}
          </div>

          {/* Actions par moment */}
          <div role="listbox" aria-label={t("Actions à traiter")} className="mt-5">
            {sections.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-[20px] bg-surface px-6 py-12 text-center">
                <IconTile tone="ok" size="lg">
                  <Check />
                </IconTile>
                <p className="text-[15px] font-semibold text-foreground">{t("Rien à traiter. Belle journée.")}</p>
              </div>
            ) : (
              sections.map((s) => (
                <section key={s.id} className="mb-4">
                  <div className="flex items-baseline justify-between gap-3 px-1 pb-1.5">
                    <h2 className="text-[14px] font-semibold text-muted-foreground">{t(s.title)}</h2>
                    <span className="shrink-0 text-[14px] tabular-nums text-muted-foreground">{sectionRight(s.from, s.to, s.items.length)}</span>
                  </div>
                  <div className="space-y-1">
                    {s.items.map((it) => {
                      const Icon = iconOf(it);
                      const sub = whenSub(it);
                      const on = it.id === selectedId;
                      const high = it.target.tab === "todo" && !!isHigh?.(it.target.todoId);
                      return (
                        <div
                          key={it.id}
                          role="option"
                          aria-selected={on}
                          data-ct-id={it.id}
                          onClick={() => select(it.id, true)}
                          className={cn(
                            "flex cursor-pointer items-center gap-3 rounded-[14px] px-3 py-2.5 transition-colors",
                            on ? "bg-primary/[0.06] ring-[1.5px] ring-primary" : "hover:bg-rowhover",
                          )}
                        >
                          <IconTile tone={toneOf(it)}>
                            <Icon />
                          </IconTile>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-1.5">
                              {high && <span aria-label={t("Priorité haute")} title={t("Priorité haute")} className="h-2 w-2 shrink-0 rounded-full bg-priority" />}
                              <span className="min-w-0 truncate text-[15px] font-semibold leading-snug text-foreground" title={label(it)}>{label(it)}</span>
                            </div>
                            <div className="truncate text-[13px] leading-snug text-muted-foreground">{subLine(it)}</div>
                          </div>
                          {it.due && (
                            <div className="shrink-0 text-right">
                              <div className="text-[15px] font-semibold leading-snug tabular-nums text-foreground">{fmtDay(it.due, locale)}</div>
                              {sub && <div className={cn("text-[12.5px] font-semibold leading-snug tabular-nums", sub.tone ? TONE_TEXT[sub.tone] : "text-muted-foreground")}>{sub.text}</div>}
                            </div>
                          )}
                          {/* Le verbe (ordinateur) ; sur téléphone, l'action est dans la feuille, sous le pouce. */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedId(it.id);
                              void act(it);
                            }}
                            disabled={busy && it.target.tab === "todo"}
                            className={cn(
                              "hidden h-9 shrink-0 items-center rounded-full px-3.5 text-[13px] font-semibold transition-colors disabled:opacity-60 sm:inline-flex",
                              on ? "bg-primary text-primary-foreground hover:opacity-90" : "bg-field text-foreground hover:bg-rowhover",
                            )}
                          >
                            {t(creatorVerb(it))}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))
            )}

            {done.length > 0 && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setDoneOpen((v) => !v)}
                  aria-expanded={doneOpen}
                  className="flex items-center gap-2 rounded-full px-1 py-1.5 text-[14px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ChevronRight className={cn("h-4 w-4 transition-transform", doneOpen && "rotate-90")} />
                  {plural(done.length, "{n} action traitée aujourd'hui", "{n} actions traitées aujourd'hui")}
                </button>
                {doneOpen && (
                  <ul className="mt-1 space-y-1 pl-1">
                    {done.map((d) => (
                      <li key={d.id} className="flex items-center gap-3 rounded-[14px] px-2 py-1.5">
                        <IconTile tone="ok" size="sm">
                          <Check />
                        </IconTile>
                        <span className="min-w-0 flex-1 truncate text-[14px] text-muted-foreground line-through decoration-faint">{d.label}</span>
                        {!d.id.startsWith("todo:") && (
                          <button
                            type="button"
                            onClick={() => undoHandled(d.id)}
                            className="shrink-0 rounded-full px-2.5 py-1 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
                          >
                            {t("Annuler")}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Raccourcis clavier (grand écran seulement), sous la liste : ne cachent rien. */}
          {items.length > 0 && (
            <div className="mt-4 hidden flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-3 text-[13px] text-muted-foreground lg:flex">
              <span className="flex items-center gap-1.5"><Kbd>J</Kbd> {t("Suivant")}</span>
              <span className="flex items-center gap-1.5"><Kbd>K</Kbd> {t("Précédent")}</span>
              <span className="flex items-center gap-1.5"><Kbd>E</Kbd> {t("Traiter")}</span>
            </div>
          )}
        </div>

        {/* Détail : à droite sur grand écran */}
        {isLg && (
          <aside className="min-w-0">
            <div className="sticky top-4 flex h-[calc(100dvh-9rem)] min-h-[440px] flex-col rounded-[22px] bg-surface p-5 shadow-sm">
              {inspector ?? (
                <div className="grid flex-1 place-items-center text-center text-[14px] text-muted-foreground">{t("Choisis une ligne pour voir le détail.")}</div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Téléphone et tablette : le détail s'ouvre en feuille du bas */}
      {!isLg && sheetOpen && inspector &&
        createPortal(
          <Overlay
            label={selected ? label(selected) : undefined}
            onClose={() => setSheetOpen(false)}
            className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-[88dvh] w-full flex-col rounded-t-[22px] bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-7 sm:max-w-[480px] sm:rounded-[22px] sm:pt-5"
            >
              {inspector}
            </div>
          </Overlay>,
          document.body,
        )}
    </div>
  );
}

const secondaryBtn = "flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full bg-field px-3 text-[14px] font-semibold text-foreground transition-colors hover:bg-rowhover";

function Inspector({ it, title, kind, rows, verb, busy, onPrimary, onHandled, onSnooze, onClose }: {
  it: CtItem;
  title: string;
  kind: string;
  rows: [string, ReactNode][];
  verb: string;
  busy: boolean;
  onPrimary: () => void;
  onHandled?: () => void;
  onSnooze: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[14px] font-medium text-muted-foreground">{kind}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Fermer")}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-field text-foreground transition-colors hover:bg-rowhover"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <h2 className="mt-3 text-[24px] font-bold leading-tight tracking-[-0.02em] text-foreground [overflow-wrap:anywhere]">{title}</h2>
        <dl className="mt-5 divide-y divide-border overflow-hidden rounded-[16px] bg-panel">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3 px-4 py-3 text-[14px]">
              <dt className="shrink-0 text-muted-foreground">{k}</dt>
              <dd className="min-w-0 truncate text-right font-medium tabular-nums text-foreground" title={typeof v === "string" ? v : undefined}>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="shrink-0 space-y-2 pt-3">
        <button
          type="button"
          onClick={onPrimary}
          disabled={busy && it.target.tab === "todo"}
          className="flex h-12 w-full items-center justify-center rounded-full bg-primary px-4 text-[15px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {verb}
        </button>
        <div className="flex gap-2">
          {onHandled && (
            <button type="button" onClick={onHandled} className={secondaryBtn}>
              <Check className="h-4 w-4 shrink-0" /> <span className="whitespace-nowrap">{t("C'est fait")}</span>
            </button>
          )}
          <button type="button" onClick={onSnooze} className={secondaryBtn}>
            {t("Demain")}
          </button>
        </div>
      </div>
    </div>
  );
}
