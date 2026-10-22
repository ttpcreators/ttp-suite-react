import type { BriefResume } from "@/lib/briefResume";
import type { StatusTone } from "./statusTone";
import { STEP_COUNT, isDone, stepDef } from "./collabs";
import { toISODate } from "./dates";

/**
 * Missions de l'espace créateur (logique PURE, testable sous Node) : ses collabs
 * (lecture seule, RLS `collabs_scoped`) rapprochées de ses briefs. Une collab
 * reliée à un brief (`brief_id`, sinon même marque) ne fait qu'UNE mission ; un
 * brief sans collab reste une mission à lui seul. Rien n'est inventé : sans collab,
 * pas d'étape affichée.
 */

export type MissionCollab = {
  id: string;
  brand: string;
  title: string | null;
  deliverables: string | null;
  step: number;
  status: string | null;
  brief_id: string | null;
  created_at?: string | null;
};
export type MissionBrief = { id: string; brand: string; deliverables: string | null; due: string | null; status: string | null; consignes: string | null; resume?: BriefResume | null };

export type Mission = {
  /** « c:<id> » pour une collab, « b:<id> » pour un brief seul. */
  id: string;
  brand: string;
  /** Titre court (titre de la collab, sinon les livrables). */
  title: string | null;
  deliverables: string | null;
  /** Étape de la collab (1 à 11), null pour un brief seul. */
  step: number | null;
  collab: MissionCollab | null;
  brief: MissionBrief | null;
  /** Échéance ISO (celle du brief), "" si inconnue. */
  due: string;
  done: boolean;
};

/** Statut de brief normalisé (anciens libellés compris), comme côté agence. */
export function briefKey(status: string): string {
  const s = String(status).toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (s.includes("termin")) return "terminé";
  if (s.includes("cours")) return "cours";
  if (s.includes("valider")) return "valider";
  return "attente";
}

/**
 * Les 5 phases vues par le créateur (les 11 étapes restent côté agence) :
 * Signature (1), Brief (2-3), Création (4-5), Publication (6-7), Paiement (8-11).
 */
export const CREATOR_PHASES: { key: string; label: string; from: number; to: number }[] = [
  { key: "signature", label: "Signature", from: 1, to: 1 },
  { key: "brief", label: "Brief", from: 2, to: 3 },
  { key: "creation", label: "Création", from: 4, to: 5 },
  { key: "publication", label: "Publication", from: 6, to: 7 },
  { key: "paiement", label: "Paiement", from: 8, to: STEP_COUNT },
];

/** Index (0 à 4) de la phase créateur d'une étape. */
export function creatorPhaseIndex(step: number): number {
  const i = CREATOR_PHASES.findIndex((p) => step >= p.from && step <= p.to);
  return i < 0 ? 0 : i;
}

const norm = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

/** Collabs visibles par le créateur : en cours ou gagnées (pas les pistes perdues ou archivées). */
const visibleCollab = (c: MissionCollab) => c.status !== "perdue" && c.status !== "archivee";

export function buildMissions(collabs: MissionCollab[], briefs: MissionBrief[]): Mission[] {
  const used = new Set<string>();
  const out: Mission[] = [];
  for (const c of collabs.filter(visibleCollab)) {
    let brief = c.brief_id ? briefs.find((b) => b.id === c.brief_id && !used.has(b.id)) ?? null : null;
    if (!brief) brief = briefs.find((b) => !used.has(b.id) && norm(b.brand) === norm(c.brand) && norm(b.brand) !== "") ?? null;
    if (brief) used.add(brief.id);
    out.push({
      id: `c:${c.id}`,
      brand: c.brand || brief?.brand || "",
      title: c.title?.trim() || c.deliverables?.trim() || brief?.deliverables?.trim() || null,
      deliverables: c.deliverables?.trim() || brief?.deliverables?.trim() || null,
      step: c.step,
      collab: c,
      brief,
      due: toISODate(brief?.due),
      done: c.status === "gagnee" || isDone(c.step),
    });
  }
  for (const b of briefs) {
    if (used.has(b.id)) continue;
    out.push({
      id: `b:${b.id}`,
      brand: b.brand,
      title: b.deliverables?.trim() || null,
      deliverables: b.deliverables?.trim() || null,
      step: null,
      collab: null,
      brief: b,
      due: toISODate(b.due),
      done: briefKey(b.status ?? "attente") === "terminé",
    });
  }
  // En cours d'abord, par échéance (sans date à la fin) ; terminées ensuite.
  return out.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.due !== b.due) return !a.due ? 1 : !b.due ? -1 : a.due.localeCompare(b.due);
    return a.brand.localeCompare(b.brand);
  });
}

/** Pastille de statut d'une mission (jamais « late » : le rouge est réservé à l'argent). */
export function missionState(m: Mission, todayIso: string): { tone: StatusTone; label: string } {
  if (m.done) return { tone: "ok", label: "Terminée" };
  if (m.due && m.due < todayIso) return { tone: "wait", label: "Échéance passée" };
  const k = m.brief ? briefKey(m.brief.status ?? "attente") : null;
  if (k === "valider") return { tone: "info", label: "À valider" };
  if (k === "attente" && !m.collab) return { tone: "wait", label: "En attente" };
  return { tone: "progress", label: "En cours" };
}

/** « Étape 4 sur 11 · Tournage » (clé française + variables, traduite à l'affichage). */
export function stepLine(step: number): { key: string; vars: { n: number; total: number; label: string } } {
  return { key: "Étape {n} sur {total} · {label}", vars: { n: step, total: STEP_COUNT, label: stepDef(step).short } };
}

/** Initiale d'une marque pour sa tuile (« ? » si vide). */
export function brandInitial(brand: string | null | undefined): string {
  const c = String(brand ?? "").trim().charAt(0);
  return c ? c.toUpperCase() : "?";
}

/**
 * Les 5 étapes vues par le créateur (demande de Marc, 2026-10-22), sans termes internes :
 * Brief reçu → Contenu envoyé → Validé → Publié → Payé.
 */
export const CREATOR_STAGES = ["Brief reçu", "Contenu envoyé", "Validé", "Publié", "Payé"] as const;

/**
 * Dernière étape créateur FRANCHIE (0 à 4), -1 si aucune. Étapes agence (src/lib/collabs.ts) :
 * 1 Signature → aucune ; 2-3 Brief transmis, Concept validé → Brief reçu ; 4 Tournage →
 * Contenu envoyé ; 5 Validation marque → Validé ; 6-9 Publication à Paiement marque → Publié ;
 * 10-11 Créateur payé, Bilan → Payé. Brief seul : attente ou en cours → Brief reçu,
 * à valider → Contenu envoyé, terminé → Validé.
 */
export function creatorStage(m: Pick<Mission, "step" | "brief" | "collab" | "done">): number {
  if (m.collab) {
    if (m.collab.status === "gagnee") return 4;
    const s = m.step ?? 1;
    return s >= 10 ? 4 : s >= 6 ? 3 : s >= 5 ? 2 : s >= 4 ? 1 : s >= 2 ? 0 : -1;
  }
  const k = briefKey(m.brief?.status ?? "attente");
  return k === "terminé" ? 2 : k === "valider" ? 1 : 0;
}

export type MissionActionKey = "brief" | "content" | "feedback" | "invoice" | "open";

/**
 * LE bouton principal d'une mission selon où elle en est (null quand tout est fini).
 * Libellé français (clé de traduction) : un verbe, deux ou trois mots.
 */
export function missionAction(m: Pick<Mission, "step" | "brief" | "collab" | "done">): { key: MissionActionKey; label: string } | null {
  const stage = creatorStage(m);
  if (stage >= 4) return null;
  if (stage <= 0) {
    const fresh = m.collab ? (m.step ?? 1) <= 2 : briefKey(m.brief?.status ?? "attente") === "attente";
    if (m.brief && (stage < 0 || fresh)) return { key: "brief", label: "Lire le brief" };
    return stage < 0 ? { key: "open", label: "Ouvrir" } : { key: "content", label: "Envoyer mon contenu" };
  }
  if (stage === 1) return { key: "feedback", label: "Voir les retours" };
  if (m.collab && (m.step ?? 0) >= 8) return { key: "invoice", label: "Déposer ma facture" };
  return { key: "open", label: "Ouvrir" };
}

