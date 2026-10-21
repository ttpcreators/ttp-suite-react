import type { StatusTone } from "./statusTone";
import { overdueInvoices, type RelanceInvoice, type Reminders } from "./relance";
import { toISODate } from "./dates";
import { formatEuro, parseAmount } from "./money";
import { totalsOf, type LineItem } from "./invoice";
import { DEFAULT_COMMISSION } from "./commission";
import { titleCase } from "./utils";

/*
 * « Aujourd'hui » : la liste d'actions de la journée, construite à partir des données
 * DÉJÀ lues par l'app (factures, to-do, agenda, briefs, mails non lus). Logique PURE
 * (ni React ni Supabase) : testable sous Node, et la page ne fait qu'afficher.
 *   - « Argent en retard » : factures à relancer (même règle que la page Relances) ;
 *   - « Aujourd'hui » : agenda du jour, tâches dues aujourd'hui ou en retard, mails non lus ;
 *   - « Demain » : agenda et briefs du lendemain.
 * Les lignes d'anticipation (« Cette semaine », « À anticiper », et ce que « Demain » ne
 * couvrait pas) sont construites à part par lib/anticipation.ts : buildToday ne change pas.
 * Une facture relancée aujourd'hui ou une tâche terminée aujourd'hui sort de la liste et
 * rejoint « traitées aujourd'hui ». « Demain » (snooze) cache une ligne jusqu'au lendemain.
 */

export type AujTodo = {
  id: string;
  text: string;
  due: string | null;
  done: boolean;
  status?: string | null;
  priority: string | null;
  creator: string | null;
  done_at?: string | null;
  subtasks?: { done: boolean }[] | null;
};
export type AujEvent = { id: string; date: string | null; day: number | null; time: string | null; title: string | null; type: string | null; who: string | null };
export type AujBrief = { id: string; brand: string | null; creator: string | null; due: string | null; status: string | null; deliverables: string | null };
/** Mails non lus par boîte (coup d'œil Gmail) ; null = inconnu (Google non relié, erreur). */
export type MailUnread = { box: string; label: string; count: number }[] | null;

export type ItemKind = "relance" | "event" | "todo" | "brief" | "mails" | "echeance" | "contrat" | "collab" | "stats";
export type SectionId = "argent" | "today" | "tomorrow" | "week" | "later";

/** Échéance de contrat suivie (blob agence `contractDeadlines`, page Échéances). */
export type AujDeadline = { id?: string; creator: string; type: string; start: string; months: number; note?: string };
/** Collab (colonnes de la page Collabs) et historique daté de ses étapes (`collab_steps`). */
export type AujCollab = { id: string; brand: string | null; creator: string | null; step: number; status: string | null; updated_at: string | null };
export type AujCollabStep = { collab_id: string; step: number; reached_at: string };
/** Créateur du roster, pour la règle « stats du mois » (`creators.stats_month`). */
export type AujStatsCreator = { name: string; status: string | null; stats_month: string | null };
export const TODAY_FILTERS = ["tout", "argent", "talents", "boite"] as const;
export type TodayFilter = (typeof TODAY_FILTERS)[number];

export type TodayItem = {
  /** Identifiant stable : « inv:<id> », « todo:<id> », « ev:<id> », « brief:<id> », « mails ». */
  id: string;
  kind: ItemKind;
  section: SectionId;
  title: string;
  sub: string;
  /** Colonne de droite : valeur principale + petite ligne dessous (teintée si `metaTone`). */
  meta: string;
  metaSub?: string;
  metaTone?: StatusTone;
  /** Teinte de la tuile d'icône (le rouge `late` est réservé à l'argent en retard). */
  tone: StatusTone;
  /** Le verbe de la ligne (« Relancer », « Terminer »…). */
  verb: string;
  /** Estimation honnête du temps de traitement (minutes). */
  minutes: number;
  invoice?: RelanceInvoice;
  lateDays?: number | null;
  amount?: number;
  todo?: AujTodo;
  event?: AujEvent;
  brief?: AujBrief;
  unread?: number;
  /** Tâche de priorité haute (point rouge `bg-priority`). */
  priority?: boolean;
  /** Date de l'élément (ISO local) : tri des sections d'anticipation. */
  dateISO?: string;
  /** Jours avant l'échéance (négatif : dépassée). */
  daysLeft?: number;
  contract?: AujDeadline & { end: string };
  collab?: AujCollab & { stepLabel: string; staleDays: number };
  /** Créateurs sans stats du mois. */
  staleCreators?: string[];
};

export type DoneEntry = { id: string; label: string; kind: "relance" | "todo" | "fait" };

export type TodaySection = { id: SectionId; title: string; right: string; items: TodayItem[] };

/** Minutes par type d'action : des ordres de grandeur, volontairement simples. */
export const MINUTES: Record<Exclude<ItemKind, "mails" | "stats">, number> = { relance: 2, todo: 3, event: 2, brief: 3, echeance: 2, contrat: 5, collab: 3 };
/** Tri des mails : environ 30 s par mail non lu, entre 2 et 20 min. */
export const mailMinutes = (n: number) => Math.min(20, Math.max(2, Math.ceil(n / 2)));

/** Date LOCALE « aaaa-mm-jj ». */
export function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return localISO(new Date(y, m - 1, d + n));
}
/** Jours entre deux dates ISO (b − a). */
export function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
}

/** « mer. 21 oct. » → « Mer. 21 oct. » */
export function shortDayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const s = new Date(y, m - 1, d).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Date d'un évènement : `date`, sinon jour du mois courant (`day`, ancien format), sinon null. */
export function eventISO(e: AujEvent, now: Date): string | null {
  const iso = toISODate(e.date);
  if (iso) return iso;
  if (e.day) return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(e.day).padStart(2, "0")}`;
  return null;
}

/** « 14:30 », « 9h », « 09h15 » → minutes depuis minuit, ou null. */
export function parseTime(s: string | null | undefined): number | null {
  const m = /^\s*(\d{1,2})\s*[:hH]\s*(\d{2})?/.exec(String(s ?? ""));
  if (!m) return null;
  const h = Number(m[1]);
  const mn = Number(m[2] ?? 0);
  return h < 24 && mn < 60 ? h * 60 + mn : null;
}
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** « dans 5 h », « dans 20 min », « maintenant ». */
export function relativeIn(diffMin: number): string {
  if (diffMin <= 0) return "maintenant";
  if (diffMin < 60) return `dans ${diffMin} min`;
  return `dans ${Math.round(diffMin / 60)} h`;
}

const EVENT_TYPE: Record<string, string> = {
  call: "Call",
  reunion: "Réunion",
  collab: "Collab",
  shoot: "Shoot",
  event: "Event",
  voyage: "Voyage",
  deadline: "Deadline",
};
export const eventTypeLabel = (t: string | null) => (t ? EVENT_TYPE[t] ?? titleCase(t) : "Évènement");

const isTodoOpen = (t: AujTodo) => !t.done && t.status !== "Fait";

/** L'intitulé cite-t-il déjà le créateur (prénom ou nom complet, sans accents ni majuscules) ? */
export function namesCreator(party: string, creator: string | null | undefined): boolean {
  const n = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const words = n(party).split(/[^a-z0-9]+/);
  const first = n((creator ?? "").trim().split(/\s+/)[0] ?? "");
  return !!first && words.includes(first);
}

/** Titre d'une facture : « Marque × Créateur ». */
export function invoiceTitle(iv: Pick<RelanceInvoice, "party" | "creator">): string {
  const party = (iv.party ?? "").trim();
  const who = titleCase(iv.creator);
  // L'intitulé porte souvent déjà le créateur (« Nike x Sarah ») : pas de doublon.
  if (party && who && namesCreator(party, iv.creator)) return party;
  if (party && who) return `${party} × ${who}`;
  return party || who || "Facture";
}

// ── Snooze (« Demain ») : par appareil, id → jour de retour ──────────────────
export type SnoozeMap = Record<string, string>;
export const SNOOZE_KEY = "ttp:ui:aujourdhui:snooze";
/** Lit le stockage (valeur illisible → vide). */
export function parseSnooze(raw: string | null): SnoozeMap {
  try {
    const v = JSON.parse(raw ?? "{}") as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, d]) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))) as SnoozeMap;
  } catch {
    return {};
  }
}
export const isSnoozed = (map: SnoozeMap, id: string, today: string) => (map[id] ?? "") > today;
/** Cache `id` jusqu'à `until` et oublie les reports échus. */
export function snooze(map: SnoozeMap, id: string, until: string, today: string): SnoozeMap {
  const out: SnoozeMap = {};
  for (const [k, d] of Object.entries(map)) if (d > today) out[k] = d;
  out[id] = until;
  return out;
}

// ── « C'est fait » : un élément traité à la main (rendez-vous préparé, mail trié…) ──
// Caché pour la journée et compté dans « déjà faites » ; par appareil, comme « Demain ».
export type HandledMap = Record<string, { day: string; label: string }>;
export const HANDLED_KEY = "ttp:ui:aujourdhui:fait";
export function parseHandled(raw: string | null): HandledMap {
  try {
    const v = JSON.parse(raw ?? "{}") as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: HandledMap = {};
    for (const [k, e] of Object.entries(v as Record<string, unknown>)) {
      const o = e as { day?: unknown; label?: unknown };
      if (o && typeof o.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.day)) out[k] = { day: o.day, label: typeof o.label === "string" ? o.label : "" };
    }
    return out;
  } catch {
    return {};
  }
}
/** Marque `id` comme fait aujourd'hui (et oublie les jours passés). */
export function markHandled(map: HandledMap, id: string, label: string, today: string): HandledMap {
  const out: HandledMap = {};
  for (const [k, e] of Object.entries(map)) if (e.day >= today) out[k] = e;
  out[id] = { day: today, label };
  return out;
}
/** Retire la marque (bouton « Annuler »). */
export function unmarkHandled(map: HandledMap, id: string): HandledMap {
  const out = { ...map };
  delete out[id];
  return out;
}
export const isHandled = (map: HandledMap, id: string, today: string) => map[id]?.day === today;
/** Éléments faits à la main aujourd'hui, pour la liste « déjà faites ». */
export function handledToday(map: HandledMap, today: string): DoneEntry[] {
  return Object.entries(map).filter(([, e]) => e.day === today).map(([id, e]) => ({ id, label: e.label, kind: "fait" as const }));
}

// ── Commission : même logique que Facturation / Reversements ─────────────────
export type InvDetailsLite = { items?: LineItem[]; franchise?: boolean; vatRate?: number; commissionRate?: number };
/** Taux : fiche roster d'abord, puis l'ancien blob `creatorCommission`, puis le défaut. */
export function commissionRateFor(creator: string | null, roster: Record<string, number>, legacy: Record<string, number>): number {
  if (!creator) return DEFAULT_COMMISSION;
  return roster[creator] ?? (legacy[creator] != null ? legacy[creator] : DEFAULT_COMMISSION);
}
/** Part du créateur d'une facture (HT − commission), comme `finOf` de Facturation. */
export function creatorShare(amount: string, details: InvDetailsLite | undefined, fallbackRate: number): { reversal: number; commission: number; rate: number } {
  const rate = details?.commissionRate ?? fallbackRate;
  const t = details?.items?.length
    ? totalsOf(details.items, !!details.franchise, details.vatRate ?? 0, rate)
    : totalsOf([{ id: "x", label: "", qty: 1, unit: parseAmount(amount) }], true, 0, rate);
  return { reversal: t.reversal, commission: t.commission, rate };
}

// ── Construction de la liste ─────────────────────────────────────────────────
export type TodayInput = {
  invoices: RelanceInvoice[] | null;
  reminders: Reminders;
  todos: AujTodo[] | null;
  events: AujEvent[] | null;
  briefs: AujBrief[] | null;
  mails: MailUnread;
  snoozed: SnoozeMap;
  /** false : pas de section argent (profil sans accès Finance). */
  money: boolean;
  now: Date;
};

export type TodayResult = { items: TodayItem[]; done: DoneEntry[] };

export function buildToday(input: TodayInput): TodayResult {
  const { now } = input;
  const today = localISO(now);
  const tomorrow = addDaysISO(today, 1);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const items: TodayItem[] = [];
  const done: DoneEntry[] = [];
  const hidden = (id: string) => isSnoozed(input.snoozed, id, today);

  // Argent en retard
  if (input.money && input.invoices) {
    for (const { iv, late } of overdueInvoices(input.invoices, now)) {
      const id = `inv:${iv.id}`;
      const title = invoiceTitle(iv);
      if (input.reminders[iv.id]?.last === today) {
        done.push({ id, label: `Relance ${title}`, kind: "relance" });
        continue;
      }
      if (hidden(id)) continue;
      const amount = parseAmount(iv.amount);
      items.push({
        id,
        kind: "relance",
        section: "argent",
        title,
        sub: `Facture #${iv.ref} · relance prête`,
        meta: formatEuro(amount),
        metaSub: late != null && late > 0 ? `${late} j` : undefined,
        metaTone: "late",
        tone: "late",
        verb: "Relancer",
        minutes: MINUTES.relance,
        invoice: iv,
        lateDays: late,
        amount,
      });
    }
  }

  // Agenda : aujourd'hui (pas ceux finis depuis plus d'une heure) et demain
  const evToday: TodayItem[] = [];
  const evTomorrow: TodayItem[] = [];
  for (const e of input.events ?? []) {
    const iso = eventISO(e, now);
    if (iso !== today && iso !== tomorrow) continue;
    const id = `ev:${e.id}`;
    if (hidden(id)) continue;
    const t = parseTime(e.time);
    const type = eventTypeLabel(e.type);
    const base = {
      id,
      kind: "event" as const,
      title: (e.title ?? "").trim() || type,
      sub: [e.who ? titleCase(e.who) : null, type].filter(Boolean).join(" · "),
      tone: "progress" as const,
      verb: "Préparer",
      minutes: MINUTES.event,
      event: e,
    };
    if (iso === today) {
      if (t != null && t < nowMin - 60) continue;
      evToday.push({ ...base, section: "today", meta: t != null ? hhmm(t) : "Aujourd'hui", metaSub: t != null ? relativeIn(t - nowMin) : undefined, metaTone: "progress" });
    } else {
      evTomorrow.push({ ...base, section: "tomorrow", meta: t != null ? hhmm(t) : "Demain", metaSub: type, metaTone: "progress" });
    }
  }
  const byTime = (a: TodayItem, b: TodayItem) => (parseTime(a.event?.time) ?? 9999) - (parseTime(b.event?.time) ?? 9999);
  evToday.sort(byTime);
  evTomorrow.sort(byTime);

  // To-do : dues aujourd'hui ou en retard ; terminées aujourd'hui → « traitées »
  const todoItems: TodayItem[] = [];
  for (const t of input.todos ?? []) {
    const id = `todo:${t.id}`;
    if (!isTodoOpen(t)) {
      if (t.done_at && localISO(new Date(t.done_at)) === today) done.push({ id, label: t.text, kind: "todo" });
      continue;
    }
    const due = toISODate(t.due);
    if (!due || due > today || hidden(id)) continue;
    const late = daysBetween(due, today);
    const subs = t.subtasks ?? [];
    todoItems.push({
      id,
      kind: "todo",
      section: "today",
      title: t.text,
      sub: [t.creator ? titleCase(t.creator) : "Agence", t.priority === "haute" ? "priorité haute" : null].filter(Boolean).join(" · "),
      meta: subs.length ? `${subs.filter((s) => s.done).length} / ${subs.length}` : late > 0 ? "En retard" : "Aujourd'hui",
      metaSub: late > 0 ? `${late} j de retard` : subs.length ? "aujourd'hui" : undefined,
      metaTone: late > 0 ? "wait" : undefined,
      tone: "wait",
      verb: "Terminer",
      minutes: MINUTES.todo,
      todo: t,
      lateDays: late,
    });
  }
  todoItems.sort((a, b) => (b.lateDays ?? 0) - (a.lateDays ?? 0));

  // Briefs : échéance aujourd'hui ou demain (hors terminés)
  const briefToday: TodayItem[] = [];
  const briefTomorrow: TodayItem[] = [];
  for (const b of input.briefs ?? []) {
    if (b.status === "terminé") continue;
    const due = toISODate(b.due);
    if (due !== today && due !== tomorrow) continue;
    const id = `brief:${b.id}`;
    if (hidden(id)) continue;
    const item: TodayItem = {
      id,
      kind: "brief",
      section: due === today ? "today" : "tomorrow",
      title: `Brief ${(b.brand ?? "").trim() || "sans marque"}`.trim(),
      sub: [b.creator ? titleCase(b.creator) : null, (b.deliverables ?? "").trim() || null].filter(Boolean).join(" · ") || "Brief à envoyer",
      meta: "Échéance",
      metaSub: due === today ? "aujourd'hui" : "demain",
      metaTone: "info",
      tone: "info",
      verb: "Brief",
      minutes: MINUTES.brief,
      brief: b,
    };
    (due === today ? briefToday : briefTomorrow).push(item);
  }

  // Mails non lus (une seule ligne)
  const mailItems: TodayItem[] = [];
  const unread = (input.mails ?? []).reduce((s, b) => s + b.count, 0);
  if (unread > 0 && !hidden("mails")) {
    mailItems.push({
      id: "mails",
      kind: "mails",
      section: "today",
      title: `${unread} mail${unread > 1 ? "s" : ""} non lu${unread > 1 ? "s" : ""}`,
      sub: (input.mails ?? []).filter((b) => b.count > 0).map((b) => `${b.label} ${b.count}`).join(" · "),
      meta: String(unread),
      metaSub: unread > 1 ? "non lus" : "non lu",
      metaTone: "info",
      tone: "info",
      verb: "Trier",
      minutes: mailMinutes(unread),
      unread,
    });
  }

  items.push(...evToday, ...todoItems, ...briefToday, ...mailItems, ...evTomorrow, ...briefTomorrow);
  return { items, done };
}

/** « 23 oct. » */
export function dayMonth(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
/** Fenêtre de dates : « 23 au 28 oct. », ou « 29 oct. au 20 nov. » à cheval sur deux mois. */
export function rangeLabel(from: string, to: string): string {
  const head = from.slice(0, 7) === to.slice(0, 7) ? String(Number(from.slice(8, 10))) : dayMonth(from);
  return `${head} au ${dayMonth(to)}`;
}
/** Fenêtres d'anticipation : « Cette semaine » de J+2 à J+7, « À anticiper » de J+8 à J+30. */
export const WEEK_FROM = 2;
export const WEEK_TO = 7;
export const LATER_TO = 30;

const TALENT_KINDS: ItemKind[] = ["event", "todo", "brief", "contrat", "collab", "stats"];

/** Filtre « Tout / Argent / Talents / Boîte ». */
export function filterItems(items: TodayItem[], f: TodayFilter): TodayItem[] {
  if (f === "tout") return items;
  if (f === "argent") return items.filter((i) => i.kind === "relance" || i.kind === "echeance");
  if (f === "boite") return items.filter((i) => i.kind === "mails");
  return items.filter((i) => TALENT_KINDS.includes(i.kind));
}

/** Sections affichées (seulement les non vides), dans l'ordre de la page. */
export function sectionsOf(items: TodayItem[], now: Date): TodaySection[] {
  const tomorrow = addDaysISO(localISO(now), 1);
  const pick = (id: SectionId) => items.filter((i) => i.section === id);
  const argent = pick("argent");
  const today = pick("today");
  const next = pick("tomorrow");
  const week = pick("week");
  const later = pick("later");
  const d0 = localISO(now);
  const out: TodaySection[] = [];
  if (argent.length) out.push({ id: "argent", title: "Argent en retard", right: formatEuro(argent.reduce((s, i) => s + (i.amount ?? 0), 0)), items: argent });
  if (today.length) out.push({ id: "today", title: "Aujourd'hui", right: String(today.length), items: today });
  if (next.length) out.push({ id: "tomorrow", title: "Demain", right: shortDayLabel(tomorrow), items: next });
  if (week.length) out.push({ id: "week", title: "Cette semaine", right: rangeLabel(addDaysISO(d0, WEEK_FROM), addDaysISO(d0, WEEK_TO)), items: week });
  if (later.length) out.push({ id: "later", title: "À anticiper", right: rangeLabel(addDaysISO(d0, WEEK_TO + 1), addDaysISO(d0, LATER_TO)), items: later });
  return out;
}

/** Temps estimé total (minutes, arrondi) et résumé « 7 actions à traiter · environ 12 min ». */
export function totalMinutes(items: TodayItem[]): number {
  return items.reduce((s, i) => s + i.minutes, 0);
}
export function summaryLine(items: TodayItem[]): string {
  const n = items.length;
  const min = totalMinutes(items);
  // Espaces insécables : « environ 11 min » ne se coupe jamais avant « min » sur téléphone.
  const dur = min >= 60 ? `${Math.floor(min / 60)}\u00a0h${min % 60 ? `\u00a0${String(min % 60).padStart(2, "0")}` : ""}` : `${min}\u00a0min`;
  return `${n} action${n > 1 ? "s" : ""} à traiter · environ\u00a0${dur}`;
}
