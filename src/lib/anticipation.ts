import { parseDueDate, type RelanceInvoice } from "./relance";
import { toISODate } from "./dates";
import { formatEuro, parseAmount } from "./money";
import { isDone, stepDef } from "./collabs";
import { titleCase } from "./utils";
import {
  LATER_TO,
  MINUTES,
  WEEK_FROM,
  WEEK_TO,
  dayMonth,
  daysBetween,
  eventISO,
  eventTypeLabel,
  invoiceTitle,
  isSnoozed,
  localISO,
  namesCreator,
  parseTime,
  type AujBrief,
  type AujCollab,
  type AujCollabStep,
  type AujDeadline,
  type AujEvent,
  type AujStatsCreator,
  type AujTodo,
  type SectionId,
  type SnoozeMap,
  type TodayItem,
} from "./aujourdhui";

/*
 * Anticipation : ce qui arrive dans les 30 prochains jours, pour le préparer à l'avance.
 * Logique PURE (ni React ni Supabase), construite à partir des données que l'app lit
 * déjà, avec les mêmes règles que les pages d'origine :
 *   - tâches (To-do), agenda (Planning), briefs : date dans la fenêtre, pas terminés ;
 *   - factures « En attente » pas encore en retard dont l'échéance approche (Facturation) ;
 *   - contrats qui finissent sous 30 jours, ou déjà finis sans renouvellement (Échéances) ;
 *   - collabs en cours bloquées depuis 7 jours ou plus sur la même étape (Collabs) ;
 *   - à partir du 25, créateurs sans stats du mois (Roster, « Marquer à jour »).
 * « Cette semaine » = J+2 à J+7 (plus les relances sans date : contrats échus, collabs
 * bloquées, stats) ; « À anticiper » = J+8 à J+30. Ce que « Demain » ne couvrait pas
 * encore (tâches de demain, factures qui arrivent à échéance aujourd'hui ou demain) y
 * est ajouté, sans toucher aux lignes existantes.
 */

/** Une collab est bloquée à partir de 7 jours sur la même étape (même seuil que Collabs). */
export const STALE_DAYS = 7;
/** Les stats du mois se réclament à partir du 25. */
export const STATS_FROM_DAY = 25;
/** Un contrat s'anticipe 30 jours avant sa fin. */
export const CONTRACT_WINDOW = 30;
/** Lignes visibles d'une section repliée. */
export const COLLAPSED_COUNT = 5;

/** Relance des stats : environ une minute par créateur, entre 2 et 15 min. */
export const statsMinutes = (n: number) => Math.min(15, Math.max(2, n));

/** Section d'une date (écart en jours depuis aujourd'hui), ou null hors fenêtre. */
export function sectionFor(daysAhead: number): SectionId | null {
  if (daysAhead === 1) return "tomorrow";
  if (daysAhead >= WEEK_FROM && daysAhead <= WEEK_TO) return "week";
  if (daysAhead > WEEK_TO && daysAhead <= LATER_TO) return "later";
  return null;
}

/** « dans 3 j », « demain », « aujourd'hui ». */
export function inDays(n: number): string {
  if (n <= 0) return "aujourd'hui";
  if (n === 1) return "demain";
  return `dans ${n} j`;
}

// ── Contrats (même calcul que la page Échéances) ─────────────────────────────
/** Fin de contrat : début + durée, jour borné à la fin du mois cible (31 janv. + 1 mois = 28 févr.). */
export function contractEnd(start: string, months: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(start ?? "");
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1 + (months || 0);
  const lastDay = new Date(y, mo + 1, 0).getDate();
  return localISO(new Date(y, mo, Math.min(Number(m[3]), lastDay)));
}

const CONTRACT_TYPE: Record<string, string> = { "représentation": "Représentation", representation: "Représentation", marque: "Marque", ugc: "UGC" };
export const contractTypeLabel = (t: string) => CONTRACT_TYPE[(t || "").toLowerCase()] ?? titleCase(t);

/**
 * Contrats à renouveler : fin dans les 30 jours, ou déjà passée. Un contrat remplacé par
 * un suivi plus récent (même créateur, même type, fin plus tardive) est considéré renouvelé.
 */
export function contractsToRenew(list: AujDeadline[], today: string): (AujDeadline & { end: string; left: number })[] {
  const key = (d: AujDeadline) => `${(d.type || "").toLowerCase()}|${(d.creator || "").trim().toLowerCase()}`;
  const withEnd = list.flatMap((d) => {
    const end = d && d.creator ? contractEnd(d.start, d.months) : null;
    return end ? [{ ...d, end, left: daysBetween(today, end) }] : [];
  });
  const latest = new Map<string, string>();
  for (const d of withEnd) if ((latest.get(key(d)) ?? "") < d.end) latest.set(key(d), d.end);
  return withEnd.filter((d) => d.left <= CONTRACT_WINDOW && latest.get(key(d)) === d.end).sort((a, b) => a.left - b.left);
}

// ── Collabs bloquées (même règle que la page Collabs) ────────────────────────
/** Jours passés sur l'étape courante (null : collab finie, pas en cours, ou sous le seuil). */
export function collabStaleDays(c: AujCollab, steps: AujCollabStep[] | undefined, now: Date): number | null {
  if (isDone(c.step) || c.status !== "active") return null;
  // Date d'arrivée sur l'étape courante : dernière entrée de l'historique pour cette étape, sinon updated_at.
  const hit = [...(steps ?? [])].reverse().find((s) => s.step === c.step);
  const since = hit?.reached_at ?? c.updated_at;
  if (!since) return null;
  const t = new Date(since).getTime();
  if (Number.isNaN(t)) return null;
  const d = Math.floor((now.getTime() - t) / 86400000);
  return d >= STALE_DAYS ? d : null;
}

/** Historique `collab_steps` (trié par date) regroupé par collab. */
export function groupSteps(rows: AujCollabStep[] | null): Record<string, AujCollabStep[]> {
  const map: Record<string, AujCollabStep[]> = {};
  for (const s of rows ?? []) (map[s.collab_id] ??= []).push(s);
  return map;
}

/** « Nike × Léna Pasquale » (sans doubler le créateur déjà cité dans la marque). */
export function collabTitle(c: Pick<AujCollab, "brand" | "creator">): string {
  const brand = (c.brand ?? "").trim();
  const who = titleCase(c.creator ?? "");
  if (brand && who && !namesCreator(brand, c.creator)) return `${brand} × ${who}`;
  return brand || who || "Collab";
}

// ── Stats du mois (même règle que le Roster) ─────────────────────────────────
export const monthKey = (now: Date) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

/** Créateurs actifs dont les stats du mois ne sont pas marquées à jour, à partir du 25. */
export function statsMissing(creators: AujStatsCreator[] | null, now: Date): string[] {
  if (!creators || now.getDate() < STATS_FROM_DAY) return [];
  const month = monthKey(now);
  return creators.filter((c) => (c.status ?? "actif").toLowerCase() !== "inactif" && (c.stats_month ?? "") !== month).map((c) => titleCase(c.name));
}

// ── Construction ─────────────────────────────────────────────────────────────
export type AnticipationInput = {
  todos: AujTodo[] | null;
  events: AujEvent[] | null;
  briefs: AujBrief[] | null;
  /** Factures (même source que Relances / Facturation) ; null si pas d'accès Finance. */
  invoices: RelanceInvoice[] | null;
  /** Échéances de contrats ; null si la page Échéances n'est pas accessible. */
  contracts: AujDeadline[] | null;
  collabs: AujCollab[] | null;
  collabSteps: Record<string, AujCollabStep[]>;
  statsCreators: AujStatsCreator[] | null;
  snoozed: SnoozeMap;
  now: Date;
};

const isTodoOpen = (t: AujTodo) => !t.done && t.status !== "Fait";

/**
 * Ordre dans une section : d'abord ce qui bloque déjà (contrat échu, collab bloquée),
 * puis les stats, les tâches de priorité haute, et enfin le reste par date puis heure.
 */
function rank(it: TodayItem): number {
  if (it.kind === "contrat" && (it.daysLeft ?? 0) < 0) return 0;
  if (it.kind === "collab") return 0;
  if (it.kind === "stats") return 1;
  if (it.priority) return 2;
  return 3;
}
export function compareAnticipation(a: TodayItem, b: TodayItem): number {
  return (
    rank(a) - rank(b) ||
    (a.kind === "collab" && b.kind === "collab" ? (b.collab?.staleDays ?? 0) - (a.collab?.staleDays ?? 0) : 0) ||
    (a.dateISO ?? "").localeCompare(b.dateISO ?? "") ||
    (parseTime(a.event?.time) ?? 9999) - (parseTime(b.event?.time) ?? 9999)
  );
}

export function buildAnticipation(input: AnticipationInput): TodayItem[] {
  const { now } = input;
  const today = localISO(now);
  const hidden = (id: string) => isSnoozed(input.snoozed, id, today);
  const out: TodayItem[] = [];

  // Tâches : demain (« Demain » ne les montrait pas) jusqu'à J+30, pas terminées.
  for (const t of input.todos ?? []) {
    if (!isTodoOpen(t)) continue;
    const due = toISODate(t.due);
    if (!due) continue;
    const ahead = daysBetween(today, due);
    const section = sectionFor(ahead);
    const id = `todo:${t.id}`;
    if (!section || hidden(id)) continue;
    const high = t.priority === "haute";
    out.push({
      id,
      kind: "todo",
      section,
      title: t.text,
      sub: [t.creator ? titleCase(t.creator) : "Agence", high ? "priorité haute" : null].filter(Boolean).join(" · "),
      meta: section === "tomorrow" ? "Demain" : dayMonth(due),
      metaSub: section === "tomorrow" ? undefined : inDays(ahead),
      tone: "progress",
      verb: "Terminer",
      minutes: MINUTES.todo,
      todo: t,
      priority: high,
      dateISO: due,
      daysLeft: ahead,
    });
  }

  // Agenda : J+2 à J+30 (aujourd'hui et demain restent dans leurs sections).
  for (const e of input.events ?? []) {
    const iso = eventISO(e, now);
    if (!iso) continue;
    const ahead = daysBetween(today, iso);
    const section = sectionFor(ahead);
    const id = `ev:${e.id}`;
    if (!section || section === "tomorrow" || hidden(id)) continue;
    const type = eventTypeLabel(e.type);
    const t = parseTime(e.time);
    out.push({
      id,
      kind: "event",
      section,
      title: (e.title ?? "").trim() || type,
      sub: [e.who ? titleCase(e.who) : null, type].filter(Boolean).join(" · "),
      meta: dayMonth(iso),
      metaSub: t != null ? `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}` : inDays(ahead),
      tone: "progress",
      verb: "Préparer",
      minutes: MINUTES.event,
      event: e,
      dateISO: iso,
      daysLeft: ahead,
    });
  }

  // Briefs : échéance J+2 à J+30, hors terminés.
  for (const b of input.briefs ?? []) {
    if (b.status === "terminé") continue;
    const due = toISODate(b.due);
    if (!due) continue;
    const ahead = daysBetween(today, due);
    const section = sectionFor(ahead);
    const id = `brief:${b.id}`;
    if (!section || section === "tomorrow" || hidden(id)) continue;
    out.push({
      id,
      kind: "brief",
      section,
      title: `Brief ${(b.brand ?? "").trim() || "sans marque"}`.trim(),
      sub: [b.creator ? titleCase(b.creator) : null, (b.deliverables ?? "").trim() || null].filter(Boolean).join(" · ") || "Brief à envoyer",
      meta: dayMonth(due),
      metaSub: inDays(ahead),
      tone: "info",
      verb: "Brief",
      minutes: MINUTES.brief,
      brief: b,
      dateISO: due,
      daysLeft: ahead,
    });
  }

  // Factures « En attente » pas encore en retard : échéance d'aujourd'hui à J+30.
  for (const iv of input.invoices ?? []) {
    if (iv.status !== "attente") continue;
    const d = parseDueDate(iv.date);
    if (!d) continue;
    const due = localISO(d);
    const ahead = daysBetween(today, due);
    if (ahead < 0) continue; // déjà en retard : c'est « Argent en retard »
    const section = ahead === 0 ? "tomorrow" : sectionFor(ahead);
    const id = `due:${iv.id}`;
    if (!section || hidden(id)) continue;
    const amount = parseAmount(iv.amount);
    out.push({
      id,
      kind: "echeance",
      section,
      title: invoiceTitle(iv),
      sub: `Facture #${iv.ref} arrive à échéance ${ahead === 0 ? "aujourd'hui" : ahead === 1 ? "demain" : `le ${dayMonth(due)}`}`,
      meta: formatEuro(amount),
      metaSub: ahead === 0 ? "en retard demain" : inDays(ahead),
      tone: "info",
      verb: "Préparer",
      minutes: MINUTES.echeance,
      invoice: iv,
      amount,
      dateISO: due,
      daysLeft: ahead,
    });
  }

  // Contrats à renouveler : fin sous 30 jours, ou déjà finis sans renouvellement.
  for (const c of contractsToRenew(input.contracts ?? [], today)) {
    const id = `ct:${c.id ?? `${c.creator}:${c.type}:${c.start}`}`;
    if (hidden(id)) continue;
    const late = c.left < 0;
    out.push({
      id,
      kind: "contrat",
      section: c.left <= WEEK_TO ? "week" : "later",
      title: "Contrat à renouveler",
      sub: `${titleCase(c.creator)} · ${contractTypeLabel(c.type)}`,
      meta: dayMonth(c.end),
      metaSub: late ? `expiré depuis ${-c.left} j` : c.left === 0 ? "expire aujourd'hui" : `expire ${inDays(c.left)}`,
      metaTone: late || c.left <= WEEK_TO ? "wait" : undefined,
      tone: late || c.left <= WEEK_TO ? "wait" : "info",
      verb: "Voir",
      minutes: MINUTES.contrat,
      contract: { id: c.id, creator: c.creator, type: c.type, start: c.start, months: c.months, note: c.note, end: c.end },
      dateISO: c.end,
      daysLeft: c.left,
    });
  }

  // Collabs sans changement d'étape depuis 7 jours ou plus : à faire avancer cette semaine.
  for (const c of input.collabs ?? []) {
    const stale = collabStaleDays(c, input.collabSteps[c.id], now);
    const id = `collab:${c.id}`;
    if (stale == null || hidden(id)) continue;
    const stepLabel = stepDef(c.step).label;
    out.push({
      id,
      kind: "collab",
      section: "week",
      title: `Faire avancer : ${collabTitle(c)}`,
      sub: `Rien n'a bougé depuis ${stale} j · étape ${stepLabel}`,
      meta: `${stale} j`,
      metaSub: "sans bouger",
      metaTone: "wait",
      tone: "wait",
      verb: "Ouvrir",
      minutes: MINUTES.collab,
      collab: { ...c, stepLabel, staleDays: stale },
    });
  }

  // Stats du mois manquantes (à partir du 25) : une seule ligne.
  const missing = statsMissing(input.statsCreators, now);
  const statsId = `stats:${monthKey(now)}`;
  if (missing.length && !hidden(statsId)) {
    const n = missing.length;
    const lastDay = localISO(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    out.push({
      id: statsId,
      kind: "stats",
      section: "week",
      title: `Relancer les stats de ${n} créateur${n > 1 ? "s" : ""}`,
      sub: missing.length > 3 ? `${missing.slice(0, 3).join(", ")} et ${n - 3} autre${n - 3 > 1 ? "s" : ""}` : missing.join(", "),
      meta: dayMonth(lastDay),
      metaSub: "fin du mois",
      metaTone: "wait",
      tone: "wait",
      verb: "Ouvrir",
      minutes: statsMinutes(n),
      staleCreators: missing,
      dateISO: lastDay,
    });
  }

  return out.sort(compareAnticipation);
}

/** Lignes montrées d'une section : tout, ou les 5 premières tant qu'elle est repliée. */
export function collapseItems<T>(items: T[], open: boolean, limit = COLLAPSED_COUNT): { shown: T[]; hidden: number } {
  // Replier pour cacher une seule ligne n'a pas de sens : on montre tout.
  if (open || items.length <= limit + 1) return { shown: items, hidden: 0 };
  return { shown: items.slice(0, limit), hidden: items.length - limit };
}

/** « + 4 à anticiper cette semaine » : demain et la semaine, hors lignes de « Demain » déjà comptées. */
export function anticipationLine(items: TodayItem[]): string {
  const n = items.filter((i) => i.section === "tomorrow" || i.section === "week").length;
  return n ? `+ ${n} à anticiper cette semaine` : "";
}
