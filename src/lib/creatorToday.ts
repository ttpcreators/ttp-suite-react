import { creatorSteps, type NextStep, type NextStepInput } from "./creatorNextStep";
import { addDaysISO, daysBetween, eventISO, isHandled, isSnoozed, localISO, LATER_TO, WEEK_FROM, WEEK_TO, type HandledMap, type SnoozeMap } from "./aujourdhui";
import { briefKey } from "./creatorMissions";
import { toISODate } from "./dates";

/**
 * Page « Aujourd'hui » de l'espace créateur (logique PURE, testable sous Node), dans
 * l'esprit de la page agence : les actions du créateur rangées par moment.
 *   • En retard, Aujourd'hui (et ce qui n'a pas de date : brief à valider, stats…),
 *     Demain, Cette semaine (J+2 à J+7), À anticiper (J+8 à J+30).
 * Les actions viennent de « Ta prochaine étape » (creatorNextStep.ts : briefs, collabs à
 * facturer, tâches, planning, stats du mois), complétées des contenus et rendez-vous des
 * 30 prochains jours. « Demain » (report) et « C'est fait » sont gardés sur l'appareil,
 * avec les mêmes règles que la page agence (aujourdhui.ts).
 */

export type CtSectionId = "late" | "today" | "tomorrow" | "week" | "later";
export type CtItem = NextStep & { section: CtSectionId };
export type CtSection = { id: CtSectionId; title: string; from?: string; to?: string; items: CtItem[] };

/** Stockage par appareil, séparé de celui de la page agence. */
export const CT_SNOOZE_KEY = "ttp:ui:createur:aujourdhui:snooze";
export const CT_HANDLED_KEY = "ttp:ui:createur:aujourdhui:fait";

export type CreatorTodayInput = NextStepInput & { snoozed: SnoozeMap; handled: HandledMap };

/** Section d'une action selon les jours qui la séparent d'aujourd'hui (null : sans date). */
export function sectionFor(days: number | null): CtSectionId | null {
  if (days == null || days === 0) return "today";
  if (days < 0) return "late";
  if (days === 1) return "tomorrow";
  if (days <= WEEK_TO) return "week";
  if (days <= LATER_TO) return "later";
  return null;
}

/** Actions à afficher (sans celles reportées ou faites aujourd'hui), dans l'ordre d'urgence. */
export function creatorTodayItems(input: CreatorTodayInput): CtItem[] {
  const today = localISO(input.now);
  const base = creatorSteps(input);
  const extra: NextStep[] = [];
  // Contenus à rendre au-delà de 14 jours (jusqu'à 30) : « À anticiper ».
  const briefsSeen = new Set(base.map((s) => (s.target.tab === "missions" ? s.target.briefId : undefined)).filter(Boolean));
  for (const b of input.briefs) {
    if (briefsSeen.has(b.id) || briefKey(b.status ?? "attente") === "terminé") continue;
    const due = toISODate(b.due) || null;
    if (!due) continue;
    const days = daysBetween(today, due);
    if (days <= 14 || days > LATER_TO) continue;
    const detail = b.deliverables && b.deliverables.trim() && b.deliverables.trim() !== "—" ? b.deliverables.trim() : "";
    extra.push({
      id: `brief-later:${b.id}`, kind: "deliverable", title: "Contenu à rendre pour {brand}", vars: { brand: b.brand?.trim() || "—" },
      detail: detail ? "{text}" : "Livrables à préciser", detailVars: detail ? { text: detail } : {},
      due, days, bucket: 8, target: { tab: "missions", briefId: b.id },
    });
  }
  // Rendez-vous au-delà de la semaine (jusqu'à 30 jours).
  for (const e of input.events) {
    const iso = eventISO({ ...e, who: null }, input.now);
    if (!iso) continue;
    const days = daysBetween(today, iso);
    if (days <= 7 || days > LATER_TO) continue;
    const time = e.time && e.time.trim() && e.time.trim() !== "—" ? e.time.trim() : "";
    extra.push({
      id: `event:${e.id}`, kind: "event", title: "{text}", vars: { text: e.title || "Rendez-vous" },
      detail: time ? "Rendez-vous à {time}" : "Rendez-vous", detailVars: time ? { time } : {},
      due: iso, days, bucket: 8, target: { tab: "planning" },
    });
  }
  const out: CtItem[] = [];
  for (const s of [...base, ...extra]) {
    const section = sectionFor(s.days);
    if (!section || isSnoozed(input.snoozed, s.id, today) || isHandled(input.handled, s.id, today)) continue;
    out.push({ ...s, section });
  }
  const order: CtSectionId[] = ["late", "today", "tomorrow", "week", "later"];
  return out.sort((a, b) => {
    if (a.section !== b.section) return order.indexOf(a.section) - order.indexOf(b.section);
    if (a.days !== b.days) return a.days == null ? -1 : b.days == null ? 1 : a.days - b.days;
    if (a.bucket !== b.bucket) return a.bucket - b.bucket;
    return a.id.localeCompare(b.id);
  });
}

/** Sections non vides, dans l'ordre de la page (titres = clés françaises, bornes ISO pour la colonne de droite). */
export function creatorTodaySections(items: CtItem[], now: Date): CtSection[] {
  const d0 = localISO(now);
  const pick = (id: CtSectionId) => items.filter((i) => i.section === id);
  const out: CtSection[] = [];
  const late = pick("late");
  const today = pick("today");
  const next = pick("tomorrow");
  const week = pick("week");
  const later = pick("later");
  if (late.length) out.push({ id: "late", title: "En retard", items: late });
  if (today.length) out.push({ id: "today", title: "Aujourd'hui", items: today });
  if (next.length) out.push({ id: "tomorrow", title: "Demain", from: addDaysISO(d0, 1), items: next });
  if (week.length) out.push({ id: "week", title: "Cette semaine", from: addDaysISO(d0, WEEK_FROM), to: addDaysISO(d0, WEEK_TO), items: week });
  if (later.length) out.push({ id: "later", title: "À anticiper", from: addDaysISO(d0, WEEK_TO + 1), to: addDaysISO(d0, LATER_TO), items: later });
  return out;
}

/** Le verbe de la ligne (clé française) : ce que fait le bouton, en un mot. */
export function creatorVerb(s: Pick<NextStep, "kind">): string {
  switch (s.kind) {
    case "todo":
      return "Terminer";
    case "event":
      return "Préparer";
    case "script":
      return "Écrire";
    case "validate":
      return "Valider";
    case "stats":
      return "Envoyer";
    case "invoice":
      return "Déposer";
    default:
      return "Ouvrir";
  }
}

/** Type d'action (clé française), pour la sous-ligne et le panneau. */
export function creatorKindLabel(s: Pick<NextStep, "kind">): string {
  switch (s.kind) {
    case "todo":
      return "Tâche";
    case "event":
      return "Rendez-vous";
    case "script":
      return "Script";
    case "validate":
      return "Brief";
    case "stats":
      return "Stats";
    case "invoice":
      return "Facture";
    default:
      return "Contenu";
  }
}
