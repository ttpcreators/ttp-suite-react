import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronRight,
  FileText,
  Inbox,
  Pencil,
  Phone,
  Plus,
  ReceiptText,
  Sparkle,
  SquareCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, titleCase } from "@/lib/utils";
import { useAppState, type AppState } from "@/lib/appState";
import { useLiveKey } from "@/lib/useLive";
import { getCache, setCache } from "@/lib/viewCache";
import { useStickyState } from "@/lib/useStickyState";
import { useSearch } from "@/lib/search";
import { useCreators } from "@/lib/useCreators";
import { commissionMap } from "@/lib/commission";
import { notifyCreator } from "@/lib/push";
import { useNavActionSlot } from "@/lib/navAction";
import { requestIntent } from "@/lib/openIntent";
import { openCommandPalette } from "@/lib/commandPalette";
import { useRestrictedViews } from "@/lib/restrictedViews";
import { parseDueDate, relanceEmail, relanceMailto, type Reminders } from "@/lib/relance";
import { recordReminder, useRelanceInvoices } from "@/lib/useRelanceInvoices";
import { writeTodoStatus } from "@/lib/todoStatus";
import { useMailUnread } from "@/lib/useMailUnread";
import { TONE_TEXT } from "@/lib/statusTone";
import {
  SNOOZE_KEY,
  TODAY_FILTERS,
  addDaysISO,
  buildToday,
  commissionRateFor,
  creatorShare,
  eventISO,
  eventTypeLabel,
  filterItems,
  localISO,
  parseSnooze,
  sectionsOf,
  snooze,
  summaryLine,
  type AujBrief,
  type AujEvent,
  type AujTodo,
  type InvDetailsLite,
  type SnoozeMap,
  type TodayFilter,
  type TodayItem,
} from "@/lib/aujourdhui";
import { Tabs } from "@/components/ui/animated-tabs";
import { PageHeaderRow } from "@/components/ui/page-header";
import { IconTile } from "@/components/ui/icon-tile";
import { StatusPill } from "@/components/ui/status-pill";
import { Kbd } from "@/components/ui/kbd";
import { AddButton } from "@/components/ui/form";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";
import { Overlay } from "@/components/mobile/ios-sheet";
import { toast } from "@/components/ui/toast";
import { formatEuro } from "@/lib/money";

/**
 * « Aujourd'hui » : la journée de l'agence en une liste d'actions triées par urgence
 * (argent en retard, agenda, tâches, mails, demain), avec un inspecteur à droite
 * (feuille du bas sur mobile) et le clavier (J / K / E / R). Toutes les lignes viennent
 * des tables déjà lues par l'app, avec les mêmes requêtes ; la logique est dans
 * lib/aujourdhui.ts (testée), cette page ne fait qu'afficher et déclencher.
 */

const go = (id: string) => window.dispatchEvent(new CustomEvent("ttp-navigate", { detail: id }));

const FILTER_LABEL: Record<TodayFilter, string> = { tout: "Tout", argent: "Argent", talents: "Talents", boite: "Boîte" };

/** Écran large (lg) : inspecteur à droite ; sinon feuille du bas. */
const lgMq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(min-width: 1024px)") : null;
function useIsLg(): boolean {
  return useSyncExternalStore(
    (fn) => {
      lgMq?.addEventListener("change", fn);
      return () => lgMq?.removeEventListener("change", fn);
    },
    () => !!lgMq?.matches,
    () => true,
  );
}

function readSnooze(): SnoozeMap {
  try {
    return parseSnooze(localStorage.getItem(SNOOZE_KEY));
  } catch {
    return {};
  }
}

const longDate = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const shortDate = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const isoToDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

function iconOf(it: TodayItem): LucideIcon {
  if (it.kind === "relance") return ReceiptText;
  if (it.kind === "todo") return SquareCheck;
  if (it.kind === "mails") return Inbox;
  if (it.kind === "brief") return FileText;
  return it.event?.type === "call" ? Phone : CalendarDays;
}

/** Libellé du bouton principal de l'inspecteur. */
function primaryLabel(it: TodayItem): string {
  switch (it.kind) {
    case "relance":
      return "Envoyer la relance";
    case "todo":
      return "Terminer la tâche";
    case "event":
      return "Préparer dans le Planning";
    case "brief":
      return "Ouvrir le brief";
    case "mails":
      return "Trier les mails";
  }
}

// ─── Anneau de progression ───────────────────────────────────────────────────

function ProgressRing({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const r = 18;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <svg viewBox="0 0 44 44" className="h-11 w-11 shrink-0 -rotate-90" aria-hidden>
      <circle cx="22" cy="22" r={r} fill="none" strokeWidth="4" className="stroke-field" />
      <motion.circle
        cx="22"
        cy="22"
        r={r}
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        className="stroke-primary"
        strokeDasharray={c}
        initial={reduce ? false : { strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - v) }}
        transition={{ duration: reduce ? 0 : 0.6, ease: "easeOut" }}
      />
    </svg>
  );
}

// ─── Ligne ───────────────────────────────────────────────────────────────────

function Row({ it, selected, onSelect, onVerb }: { it: TodayItem; selected: boolean; onSelect: () => void; onVerb: () => void }) {
  const Icon = iconOf(it);
  return (
    <div
      role="option"
      aria-selected={selected}
      data-id={it.id}
      onClick={onSelect}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-[14px] px-3 py-2.5 transition-colors",
        selected ? "bg-primary/[0.06] ring-[1.5px] ring-primary" : "hover:bg-rowhover",
      )}
    >
      <IconTile tone={it.tone}>
        <Icon />
      </IconTile>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold leading-snug text-foreground">{it.title}</div>
        <div className="truncate text-[13px] leading-snug text-muted-foreground">{it.sub}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[15px] font-semibold leading-snug tabular-nums text-foreground">{it.meta}</div>
        {it.metaSub && (
          <div className={cn("text-[12.5px] font-semibold leading-snug tabular-nums", it.metaTone ? TONE_TEXT[it.metaTone] : "text-muted-foreground")}>{it.metaSub}</div>
        )}
      </div>
      {/* Le verbe de la ligne (ordinateur) ; sur mobile, l'action est dans la feuille, sous le pouce. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onVerb();
        }}
        className={cn(
          "hidden h-9 shrink-0 items-center rounded-full px-3.5 text-[13px] font-semibold transition-colors sm:inline-flex",
          selected ? "bg-primary text-primary-foreground hover:opacity-90" : "bg-field text-foreground hover:bg-rowhover",
        )}
      >
        {it.verb}
      </button>
    </div>
  );
}

// ─── Inspecteur ──────────────────────────────────────────────────────────────

function InfoRows({ rows }: { rows: [string, ReactNode][] }) {
  if (!rows.length) return null;
  return (
    <dl className="divide-y divide-border overflow-hidden rounded-[16px] bg-panel">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-3 px-4 py-3 text-[14px]">
          <dt className="shrink-0 text-muted-foreground">{k}</dt>
          <dd className="min-w-0 truncate text-right font-medium tabular-nums text-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const secondaryBtn = "flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-field px-4 text-[14px] font-semibold text-foreground transition-colors hover:bg-rowhover";

type InspectorProps = {
  it: TodayItem;
  reminders: Reminders;
  details: Record<string, InvDetailsLite & { clientEmail?: string }>;
  rateFor: (creator: string | null) => number;
  draft: string | undefined;
  setDraft: (v: string | undefined) => void;
  busy: boolean;
  onPrimary: () => void;
  onSnooze: () => void;
  onClose: () => void;
  onOpenSource: () => void;
};

function Inspector({ it, reminders, details, rateFor, draft, setDraft, busy, onPrimary, onSnooze, onClose, onOpenSource }: InspectorProps) {
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [it.id]);
  const iv = it.invoice;
  const mail = iv ? relanceEmail(iv, reminders[iv.id]?.count ?? 0) : null;

  let eyebrow = "";
  let rows: [string, ReactNode][] = [];
  let pill: ReactNode = null;
  if (iv) {
    eyebrow = `Facture #${iv.ref}`;
    const due = parseDueDate(iv.date);
    const rem = reminders[iv.id];
    const share = iv.creator ? creatorShare(iv.amount, details[iv.id], rateFor(iv.creator)) : null;
    rows = [
      ...(due ? [["Échéance", longDate(due)] as [string, ReactNode]] : []),
      ...(rem ? [["Dernière relance", `${shortDate(parseDueDate(rem.last) ?? new Date())} · ${rem.count} fois`] as [string, ReactNode]] : []),
      ...(share ? [[`Part de ${titleCase(iv.creator).split(" ")[0]}`, formatEuro(share.reversal)] as [string, ReactNode]] : []),
    ];
    if (it.lateDays) pill = <StatusPill tone="late" size="md">En retard de {it.lateDays} jour{it.lateDays > 1 ? "s" : ""}</StatusPill>;
  } else if (it.todo) {
    const t = it.todo;
    eyebrow = "Tâche";
    const subs = t.subtasks ?? [];
    rows = [
      ["Échéance", parseDueDate(t.due) ? longDate(parseDueDate(t.due)!) : "Aujourd'hui"],
      ["Pour", t.creator ? titleCase(t.creator) : "Agence"],
      ...(t.priority ? [["Priorité", titleCase(t.priority)] as [string, ReactNode]] : []),
      ...(subs.length ? [["Sous-tâches", `${subs.filter((s) => s.done).length} / ${subs.length}`] as [string, ReactNode]] : []),
    ];
    pill = it.lateDays ? <StatusPill tone="wait" size="md">{it.lateDays} j de retard</StatusPill> : <StatusPill tone="progress" size="md">Pour aujourd'hui</StatusPill>;
  } else if (it.event) {
    const e = it.event;
    eyebrow = eventTypeLabel(e.type);
    const iso = eventISO(e, new Date());
    rows = [
      ...(iso ? [["Date", longDate(isoToDate(iso))] as [string, ReactNode]] : []),
      ...(e.time && e.time !== "—" ? [["Heure", e.time] as [string, ReactNode]] : []),
      ...(e.who ? [["Avec", titleCase(e.who)] as [string, ReactNode]] : []),
    ];
    if (it.metaSub && it.section === "today") pill = <StatusPill tone="progress" size="md">{it.metaSub}</StatusPill>;
  } else if (it.brief) {
    const b = it.brief;
    eyebrow = "Brief";
    rows = [
      ...(b.brand ? [["Marque", b.brand] as [string, ReactNode]] : []),
      ...(b.creator ? [["Créateur", titleCase(b.creator)] as [string, ReactNode]] : []),
      ...(b.deliverables ? [["Livrables", b.deliverables] as [string, ReactNode]] : []),
      ...(parseDueDate(b.due) ? [["Échéance", longDate(parseDueDate(b.due)!)] as [string, ReactNode]] : []),
    ];
    pill = <StatusPill tone="info" size="md">Échéance {it.metaSub}</StatusPill>;
  } else if (it.kind === "mails") {
    eyebrow = "Boîte de réception";
    rows = it.sub.split(" · ").map((s) => {
      const i = s.lastIndexOf(" ");
      return [s.slice(0, i), s.slice(i + 1)] as [string, ReactNode];
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-muted-foreground">{eyebrow}</span>
        <button type="button" onClick={onOpenSource} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground" aria-label="Ouvrir la page" title="Ouvrir la page">
          <ArrowUpRight className="h-4 w-4" />
        </button>
        <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-field text-muted-foreground transition-colors hover:text-foreground" aria-label="Fermer" title="Fermer">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        <h2 className="mt-3 text-[22px] font-bold leading-tight tracking-[-0.01em] text-foreground [overflow-wrap:anywhere]">{it.title}</h2>
        {it.amount != null && <div className="mt-1 text-[38px] font-bold leading-none tracking-[-0.02em] tabular-nums text-foreground">{formatEuro(it.amount)}</div>}
        {pill && <div className="mt-3">{pill}</div>}
        {rows.length > 0 && <div className="mt-5"><InfoRows rows={rows} /></div>}

        {mail && (
          <div className="mt-4 rounded-[16px] border border-border p-4">
            <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-primary">
              <Sparkle className="h-3.5 w-3.5" /> Relance préparée
            </div>
            <div className="mt-1 truncate text-[13px] text-muted-foreground">Objet : {mail.subject}</div>
            {editing ? (
              <textarea
                value={draft ?? mail.body}
                onChange={(e) => setDraft(e.target.value)}
                rows={10}
                aria-label="Texte de la relance"
                className="mt-2 w-full resize-y rounded-[12px] bg-field p-3 text-[14px] leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-ring/30"
              />
            ) : (
              <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-foreground">{draft ?? mail.body}</p>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-2 pt-3">
        <button
          type="button"
          onClick={onPrimary}
          disabled={busy}
          className="flex h-12 w-full items-center justify-center rounded-full bg-primary px-4 text-[15px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {primaryLabel(it)}
        </button>
        <div className="flex gap-2">
          {mail && (
            <button type="button" onClick={() => setEditing((v) => !v)} className={secondaryBtn}>
              {editing ? <><Check className="h-4 w-4" /> Terminé</> : <><Pencil className="h-4 w-4" /> Modifier</>}
            </button>
          )}
          <button type="button" onClick={onSnooze} className={secondaryBtn}>
            Demain
          </button>
        </div>
        {mail && <p className="text-center text-[12.5px] text-muted-foreground">S'ouvre dans ta messagerie, puis la relance est notée.</p>}
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function Aujourdhui() {
  const restricted = useRestrictedViews();
  const money = !restricted.includes("relances");
  const canAgent = !restricted.includes("agent");
  const live = useLiveKey();
  const { setQuery } = useSearch();
  const creators = useCreators();
  const { data: app } = useAppState<AppState>();
  const { invoices } = useRelanceInvoices(money);
  const mails = useMailUnread();

  // Mêmes requêtes que To-do, Planning (agenda) et Aperçu (briefs).
  const [todos, setTodos] = useState<AujTodo[] | null>(() => getCache<AujTodo[]>("todos"));
  const [events, setEvents] = useState<AujEvent[] | null>(() => getCache<AujEvent[]>("aujourdhui:events"));
  const [briefs, setBriefs] = useState<AujBrief[] | null>(() => getCache<AujBrief[]>("aujourdhui:briefs"));
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all([
      supabase.from("todos").select("*").order("sort_order"),
      supabase.from("events").select("id,day,date,time,title,type,who,description").or("deleted.is.null,deleted.eq.false").order("sort_order"),
      supabase.from("briefs").select("id,brand,creator,deliverables,due,status").order("sort_order"),
    ])
      .then(([td, ev, br]) => {
        if (!alive) return;
        // Rafraîchissement raté : on garde ce qui est affiché.
        if (td.error || ev.error || br.error) {
          setLoadError(true);
          return;
        }
        setLoadError(false);
        const t = (td.data as AujTodo[]) ?? [];
        const e = (ev.data as AujEvent[]) ?? [];
        const b = (br.data as AujBrief[]) ?? [];
        setCache("todos", t);
        setCache("aujourdhui:events", e);
        setCache("aujourdhui:briefs", b);
        setTodos(t);
        setEvents(e);
        setBriefs(b);
      })
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, [live]);

  // Relances : copie locale après une relance, jusqu'au prochain blob live.
  const [localRem, setLocalRem] = useState<Reminders | null>(null);
  const liveRem = app?.invoiceReminders;
  useEffect(() => setLocalRem(null), [liveRem]);
  const reminders: Reminders = useMemo(() => localRem ?? ((liveRem as Reminders | undefined) ?? {}), [localRem, liveRem]);
  const details = (app?.invoiceDetails as Record<string, InvDetailsLite & { clientEmail?: string }> | undefined) ?? {};
  const legacyRates = (app?.creatorCommission as Record<string, number> | undefined) ?? {};
  const roster = useMemo(() => commissionMap(creators), [creators]);
  const rateFor = (creator: string | null) => commissionRateFor(creator, roster, legacyRates);

  // Reports « Demain » (par appareil).
  const [snoozed, setSnoozed] = useState<SnoozeMap>(readSnooze);
  // L'heure courante, rafraîchie à chaque tick (le « dans 5 h » reste juste).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => setNow(new Date()), [live, snoozed, localRem]);

  const { items, done } = useMemo(
    () => buildToday({ invoices, reminders, todos, events, briefs, mails, snoozed, money, now }),
    [invoices, reminders, todos, events, briefs, mails, snoozed, money, now],
  );

  const filters = money ? TODAY_FILTERS : TODAY_FILTERS.filter((f) => f !== "argent");
  const [filter, setFilter] = useStickyState<TodayFilter>("aujourdhui:filtre", filters, "tout");
  const visible = useMemo(() => filterItems(items, filter), [items, filter]);
  const sections = useMemo(() => sectionsOf(visible, now), [visible, now]);
  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  // Sélection (inspecteur) + feuille du bas sur mobile.
  const isLg = useIsLg();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const lastIndex = useRef(0);
  const selected = flat.find((i) => i.id === selectedId) ?? null;
  useEffect(() => {
    const i = flat.findIndex((x) => x.id === selectedId);
    if (i >= 0) {
      lastIndex.current = i;
      return;
    }
    // La ligne traitée disparaît : on passe à la suivante (comme une boîte mail).
    if (selectedId) setSelectedId(flat.length ? flat[Math.min(lastIndex.current, flat.length - 1)].id : null);
    // Ordinateur : la fiche montre d'emblée la première action (pas de panneau vide).
    else if (isLg && flat.length) setSelectedId(flat[0].id);
  }, [flat, selectedId, isLg]);
  useEffect(() => {
    if (!selected) setSheetOpen(false);
  }, [selected]);

  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const select = useCallback(
    (id: string, openSheet: boolean) => {
      setSelectedId(id);
      if (openSheet && !isLg) setSheetOpen(true);
      // Garde la ligne visible pendant la navigation au clavier.
      requestAnimationFrame(() => listRef.current?.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" }));
    },
    [isLg],
  );

  // Brouillons de relance modifiés (par facture).
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const doSnooze = (it: TodayItem) => {
    const today = localISO(new Date());
    const next = snooze(snoozed, it.id, addDaysISO(today, 1), today);
    setSnoozed(next);
    try {
      localStorage.setItem(SNOOZE_KEY, JSON.stringify(next));
    } catch {
      /* stockage indisponible : le report vaut pour la session */
    }
    toast("Reporté à demain");
  };

  const sendRelance = async (it: TodayItem) => {
    const iv = it.invoice;
    if (!iv || busy) return;
    const { subject, body } = relanceEmail(iv, reminders[iv.id]?.count ?? 0);
    // Même envoi que la page Relances : la messagerie s'ouvre avec le texte, puis la relance est notée.
    window.location.href = relanceMailto(details[iv.id]?.clientEmail ?? "", subject, drafts[iv.id] ?? body);
    setBusy(true);
    const next = await recordReminder(iv.id);
    setBusy(false);
    if (!next) {
      toast("Erreur, relance non enregistrée. Réessaie");
      return;
    }
    setLocalRem(next);
    toast("Relance enregistrée ✓");
  };

  const finishTodo = async (it: TodayItem) => {
    const t = it.todo;
    if (!t || busy) return;
    setBusy(true);
    const saved = await writeTodoStatus(t.id, "Fait");
    setBusy(false);
    if (!saved) {
      toast("Statut non enregistré, réessaie");
      return;
    }
    // Comme la page To-do : le créateur est prévenu quand SA demande est faite.
    if (t.creator) notifyCreator("task-done", t.creator, `✅ Ta demande est faite : « ${t.text} »`);
    setTodos((prev) => (prev ?? []).map((x) => (x.id === t.id ? { ...x, ...saved } : x)));
    toast("Tâche terminée ✓");
  };

  /** Le verbe de la ligne : fait l'action, ou ouvre la page qui la fait. */
  const act = (it: TodayItem) => {
    if (it.kind === "relance") return void sendRelance(it);
    if (it.kind === "todo") return void finishTodo(it);
    if (it.kind === "mails") return go("mails");
    if (it.kind === "brief") return go("briefs");
    return go("planning");
  };
  const openSource = (it: TodayItem) => {
    if (it.invoice) {
      setQuery(it.invoice.ref); // Facturation filtre sur la référence
      go("facturation");
    } else go(it.kind === "todo" ? "todo" : it.kind === "mails" ? "mails" : it.kind === "brief" ? "briefs" : "planning");
  };

  // Clavier : J suivant, K précédent, E traiter, R relancer (jamais pendant une saisie).
  const keyState = useRef({ flat, selected, act });
  keyState.current = { flat, selected, act };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName))) return;
      // Page masquée (onglet en arrière-plan) ou fenêtre ouverte par-dessus : on ne fait rien.
      if (!rootRef.current?.getClientRects().length || document.querySelector('[role="dialog"]')) return;
      const { flat: list, selected: cur, act: run } = keyState.current;
      const k = e.key.toLowerCase();
      if (k === "j" || k === "k") {
        if (!list.length) return;
        e.preventDefault();
        const i = cur ? list.findIndex((x) => x.id === cur.id) : -1;
        const next = k === "j" ? Math.min(list.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
        select(list[next].id, false);
      } else if (k === "e" && cur) {
        e.preventDefault();
        run(cur);
      } else if (k === "r" && cur?.kind === "relance") {
        e.preventDefault();
        run(cur);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  const browseAll = () => {
    if (!flat.length) return;
    select(flat[0].id, true);
    listRef.current?.focus({ preventScroll: true });
  };

  // En-tête : filtre, Megan, « + » (nouvelle tâche).
  const navSlot = useNavActionSlot();
  const newTask = () => {
    requestIntent("todo:new");
    go("todo");
  };
  const header = (
    <PageHeaderRow>
      <div className="flex min-w-0 items-center gap-2">
        <Tabs
          size="sm"
          label="Filtrer les actions"
          items={filters.map((f) => ({ value: f, label: FILTER_LABEL[f] }))}
          value={filter}
          onValueChange={(v) => setFilter(v as TodayFilter)}
        />
        {canAgent && (
          <button
            type="button"
            onClick={() => go("agent")}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-field text-foreground transition-colors hover:bg-rowhover"
            aria-label="Demander à Megan"
            title="Demander à Megan"
          >
            <Sparkle className="h-4 w-4" />
          </button>
        )}
        {navSlot ? (
          <AddButton label="Tâche" onClick={newTask} />
        ) : (
          <button
            type="button"
            onClick={newTask}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90"
            aria-label="Nouvelle tâche"
            title="Nouvelle tâche"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>
    </PageHeaderRow>
  );

  const [doneOpen, setDoneOpen] = useState(false);
  const loading = todos === null || events === null || briefs === null || (money && invoices === null);
  if (loading) {
    return (
      <div ref={rootRef}>
        {header}
        {loadError ? (
          <div className="rounded-[20px] bg-surface p-6 text-sm text-muted-foreground">Impossible de charger ta journée.</div>
        ) : (
          <AnimatedBadge status="loading" size="sm">Chargement de ta journée…</AnimatedBadge>
        )}
      </div>
    );
  }

  const total = items.length + done.length;
  const morning = now.getHours() < 12;
  const inspector = selected ? (
    <Inspector
      it={selected}
      reminders={reminders}
      details={details}
      rateFor={rateFor}
      draft={selected.invoice ? drafts[selected.invoice.id] : undefined}
      setDraft={(v) => {
        const id = selected.invoice?.id;
        if (id) setDrafts((d) => ({ ...d, [id]: v ?? "" }));
      }}
      busy={busy}
      onPrimary={() => act(selected)}
      onSnooze={() => doSnooze(selected)}
      onClose={() => {
        setSelectedId(null);
        setSheetOpen(false);
      }}
      onOpenSource={() => openSource(selected)}
    />
  ) : null;

  return (
    <div ref={rootRef}>
      {header}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          {/* Progression de la journée */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[20px] bg-surface p-5">
            <ProgressRing value={total ? done.length / total : 1} />
            <div className="min-w-0 flex-1">
              <div className="text-[16px] font-semibold leading-snug text-foreground">
                {items.length ? summaryLine(items) : "Tout est traité"}
              </div>
              {done.length > 0 && (
                <div className="text-[14px] leading-snug text-muted-foreground">
                  {done.length} déjà faite{done.length > 1 ? "s" : ""} {morning ? "ce matin" : "aujourd'hui"}.
                </div>
              )}
            </div>
            {flat.length > 0 && (
              <button type="button" onClick={browseAll} className="h-10 shrink-0 rounded-full bg-field px-4 text-[14px] font-semibold text-foreground transition-colors hover:bg-rowhover max-sm:basis-full">
                Tout parcourir
              </button>
            )}
          </div>

          {/* Sections */}
          <div ref={listRef} tabIndex={-1} role="listbox" aria-label="Actions à traiter" className="mt-5 outline-none">
            {sections.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-[20px] bg-surface px-6 py-12 text-center">
                <IconTile tone="ok" size="lg">
                  <Check />
                </IconTile>
                <p className="text-[15px] font-semibold text-foreground">Rien à traiter. Belle journée.</p>
              </div>
            ) : (
              sections.map((s) => (
                <section key={s.id} className="mb-4">
                  <div className="flex items-baseline justify-between gap-3 px-1 pb-1.5">
                    <h2 className="text-[14px] font-semibold text-muted-foreground">{s.title}</h2>
                    <span className="shrink-0 text-[14px] tabular-nums text-muted-foreground">{s.right}</span>
                  </div>
                  <div className="space-y-1">
                    {s.items.map((it) => (
                      <Row key={it.id} it={it} selected={it.id === selectedId} onSelect={() => select(it.id, true)} onVerb={() => { select(it.id, false); act(it); }} />
                    ))}
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
                  {done.length} action{done.length > 1 ? "s" : ""} traitée{done.length > 1 ? "s" : ""} {morning ? "ce matin" : "aujourd'hui"}
                </button>
                {doneOpen && (
                  <ul className="mt-1 space-y-1 pl-1">
                    {done.map((d) => (
                      <li key={d.id} className="flex items-center gap-3 rounded-[14px] px-2 py-1.5">
                        <IconTile tone="ok" size="sm">
                          <Check />
                        </IconTile>
                        <span className="min-w-0 truncate text-[14px] text-muted-foreground line-through decoration-faint">{d.label}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Raccourcis clavier (ordinateur) */}
          {flat.length > 0 && (
            <div className="sticky bottom-0 z-10 mt-4 hidden flex-wrap items-center gap-x-5 gap-y-2 border-t border-border bg-background py-3 text-[13px] text-muted-foreground verre:bg-transparent lg:flex">
              <span className="flex items-center gap-1.5"><Kbd>J</Kbd> Suivant</span>
              <span className="flex items-center gap-1.5"><Kbd>K</Kbd> Précédent</span>
              <span className="flex items-center gap-1.5"><Kbd>E</Kbd> Traiter</span>
              {money && <span className="flex items-center gap-1.5"><Kbd>R</Kbd> Relancer</span>}
              <button type="button" onClick={openCommandPalette} className="flex items-center gap-1.5 transition-colors hover:text-foreground">
                <Kbd>⌘K</Kbd> Tout faire
              </button>
            </div>
          )}
        </div>

        {/* Inspecteur : à droite sur grand écran */}
        {isLg && (
          <aside className="min-w-0">
            <div className="sticky top-4 flex h-[calc(100dvh-9rem)] min-h-[480px] flex-col rounded-[22px] bg-surface p-5">
              {inspector ?? (
                <div className="grid flex-1 place-items-center text-center text-[14px] text-muted-foreground">
                  Choisis une ligne pour voir le détail.
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Mobile et tablette : l'inspecteur s'ouvre en feuille du bas */}
      {!isLg && sheetOpen && inspector &&
        createPortal(
          <Overlay
            label={selected?.title}
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
