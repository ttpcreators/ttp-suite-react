import { daysBetween, eventISO, localISO } from "./aujourdhui";
import { toISODate } from "./dates";
import { briefKey } from "./creatorMissions";
import { isDone } from "./collabs";

/**
 * « Ta prochaine étape » de l'espace créateur (logique PURE, testable sous Node).
 * Une seule question : qu'est-ce que je fais maintenant ? On classe ce que l'espace
 * lit DÉJÀ (briefs, collabs, tâches, planning, factures, stats du mois) par urgence :
 *   0  contenu dont l'échéance est passée
 *   1  à rendre d'ici 2 jours, rendez-vous aujourd'hui ou demain, tâche due
 *   2  brief à valider
 *   3  script à écrire
 *   4  à rendre d'ici 14 jours, rendez-vous de la semaine
 *   5  stats du mois à envoyer
 *   6  facture qui n'apparaît pas, tâche prioritaire
 *   7  autres tâches
 * À urgence égale : la date la plus proche d'abord. Les textes sont des clés
 * françaises (+ variables) traduites à l'affichage.
 */

export type NsBrief = { id: string; brand: string | null; deliverables: string | null; due: string | null; status: string | null; consignes: string | null };
export type NsCollab = { id: string; brand: string; step: number; status: string | null; brief_id: string | null };
export type NsTodo = { id: string; text: string; due: string | null; priority: string | null; done: boolean; status?: string | null };
export type NsEvent = { id: string; date: string | null; day: number | null; time: string | null; title: string | null; type: string | null };
export type NsInvoice = { party: string | null };

export type NextStepKind = "deliverable" | "validate" | "script" | "event" | "todo" | "stats" | "invoice";
export type NextStepTarget =
  | { tab: "missions"; briefId?: string; collabId?: string }
  | { tab: "todo"; todoId: string }
  | { tab: "planning" }
  | { tab: "gains" }
  | { tab: "stats" };

export type NextStep = {
  id: string;
  kind: NextStepKind;
  /** Clé française du titre + variables. */
  title: string;
  vars: Record<string, string>;
  /** Clé française du détail + variables (texte libre passé par « {text} »). */
  detail: string;
  detailVars: Record<string, string>;
  /** Date ISO de l'échéance, null si aucune. */
  due: string | null;
  /** Jours d'ici l'échéance (négatif = passée), null si aucune. */
  days: number | null;
  bucket: number;
  target: NextStepTarget;
};

export type NextStepInput = {
  briefs: NsBrief[];
  collabs: NsCollab[];
  todos: NsTodo[];
  events: NsEvent[];
  invoices: NsInvoice[];
  /** Stats du mois pas encore à jour (même indicateur que l'accueil). */
  statsStale: boolean;
  now: Date;
};

const norm = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();
/** Texte repris tel quel dans un titre : jamais vide (« — » si la base n'a rien). */
const shown = (s: string | null | undefined) => String(s ?? "").trim() || "—";
const text = (s: string | null | undefined, fallback: string): { detail: string; detailVars: Record<string, string> } =>
  s && s.trim() && s.trim() !== "—" ? { detail: "{text}", detailVars: { text: s.trim() } } : { detail: fallback, detailVars: {} };

export function creatorSteps(input: NextStepInput): NextStep[] {
  const today = localISO(input.now);
  const out: NextStep[] = [];
  const daysTo = (iso: string) => daysBetween(today, iso);

  // ── Briefs en cours : une seule étape par brief, la plus urgente.
  for (const b of input.briefs) {
    const k = briefKey(b.status ?? "attente");
    if (k === "terminé") continue;
    const due = toISODate(b.due) || null;
    const days = due ? daysTo(due) : null;
    const target: NextStepTarget = { tab: "missions", briefId: b.id };
    const base = { due, days, target, vars: { brand: shown(b.brand) } };
    if (days != null && days < 0) {
      out.push({ ...base, id: `brief-late:${b.id}`, kind: "deliverable", title: "Rendre ton contenu {brand}", ...text(b.deliverables, "Livrables à préciser"), bucket: 0 });
    } else if (k === "valider") {
      out.push({ ...base, id: `brief-validate:${b.id}`, kind: "validate", title: "Valider le brief {brand}", detail: "Relis les livrables et l'échéance, puis passe-le en cours.", detailVars: {}, bucket: 2 });
    } else if (days != null && days <= 2) {
      out.push({ ...base, id: `brief-soon:${b.id}`, kind: "deliverable", title: "Contenu à rendre pour {brand}", ...text(b.deliverables, "Livrables à préciser"), bucket: 1 });
    } else if (!b.consignes || !b.consignes.trim()) {
      out.push({ ...base, id: `brief-script:${b.id}`, kind: "script", title: "Écrire ton script pour {brand}", detail: "Ton agence le voit dès que tu l'enregistres.", detailVars: {}, bucket: 3 });
    } else if (days != null && days <= 14) {
      out.push({ ...base, id: `brief-next:${b.id}`, kind: "deliverable", title: "Contenu à rendre pour {brand}", ...text(b.deliverables, "Livrables à préciser"), bucket: 4 });
    }
  }

  // ── Collabs à l'étape facturation sans facture à ce nom de marque : on propose
  // le dépôt (même filet que « Déposer ma facture »).
  for (const c of input.collabs) {
    if (c.status === "perdue" || c.status === "archivee" || isDone(c.step)) continue;
    if (c.step < 8 || c.step > 10) continue;
    if (input.invoices.some((i) => norm(i.party) === norm(c.brand) && norm(c.brand) !== "")) continue;
    out.push({
      id: `invoice:${c.id}`, kind: "invoice", title: "Ta facture {brand} n'apparaît pas", vars: { brand: c.brand },
      detail: "Dépose-la, ton agence la reçoit aussitôt.", detailVars: {}, due: null, days: null, bucket: 6, target: { tab: "gains" },
    });
  }

  // ── Planning : aujourd'hui et demain d'abord, puis la semaine.
  for (const e of input.events) {
    const iso = eventISO({ ...e, who: null }, input.now);
    if (!iso) continue;
    const days = daysTo(iso);
    if (days < 0 || days > 7) continue;
    const time = e.time && e.time.trim() && e.time.trim() !== "—" ? e.time.trim() : "";
    out.push({
      // Sans titre : la clé « Rendez-vous » elle-même, pour qu'elle soit traduite.
      id: `event:${e.id}`, kind: "event", ...(e.title?.trim() ? { title: "{text}", vars: { text: e.title.trim() } } : { title: "Rendez-vous", vars: {} }),
      detail: time ? "Rendez-vous à {time}" : "Rendez-vous", detailVars: time ? { time } : {},
      due: iso, days, bucket: days <= 1 ? 1 : 4, target: { tab: "planning" },
    });
  }

  // ── Stats du mois.
  if (input.statsStale) {
    out.push({
      id: "stats", kind: "stats", title: "Envoyer tes stats du mois", vars: {},
      detail: "Ton agence s'en sert pour te proposer aux marques.", detailVars: {}, due: null, days: null, bucket: 5, target: { tab: "stats" },
    });
  }

  // ── Tâches ouvertes.
  for (const td of input.todos) {
    if (td.done || td.status === "Fait") continue;
    const due = toISODate(td.due) || null;
    const days = due ? daysTo(due) : null;
    const urgent = days != null && days <= 1;
    const bucket = urgent ? 1 : td.priority === "haute" ? 6 : 7;
    out.push({
      id: `todo:${td.id}`, kind: "todo", title: "{text}", vars: { text: shown(td.text) },
      detail: td.priority === "haute" ? "Tâche prioritaire" : "Tâche", detailVars: {},
      due, days, bucket, target: { tab: "todo", todoId: td.id },
    });
  }

  return out.sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket - b.bucket;
    if (a.days !== b.days) return a.days == null ? 1 : b.days == null ? -1 : a.days - b.days;
    return a.id.localeCompare(b.id);
  });
}

/** La prochaine étape (la plus urgente), ou null si tout est à jour. */
export function pickNextStep(input: NextStepInput): NextStep | null {
  return creatorSteps(input)[0] ?? null;
}

/** Libellé court du « quand » (clé française + variables), null au-delà d'une semaine. */
export function whenLabel(days: number | null): { key: string; vars?: Record<string, number> } | null {
  if (days == null) return null;
  if (days < -1) return { key: "Depuis {n} jours", vars: { n: -days } };
  if (days === -1) return { key: "Depuis hier" };
  if (days === 0) return { key: "Aujourd'hui" };
  if (days === 1) return { key: "Demain" };
  if (days < 7) return { key: "Dans {n} jours", vars: { n: days } };
  return null;
}
