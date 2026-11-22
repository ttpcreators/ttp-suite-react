/**
 * Les 11 étapes d'une collab (cycle de vie complet, de la signature au bilan).
 * Source unique, partagée par la page Collabs et (plus tard) la page Agent, pour
 * que l'agent détecte ce qui stagne. Ordre et libellés figés par la spec.
 *
 * Chaque collab porte une étape courante (`collabs.step`, 1 à 11) ; chaque
 * changement d'étape est daté dans `collab_steps` (via un trigger côté base), ce
 * qui donne l'historique « telle étape franchie tel jour ».
 */

import { foldName } from "../../supabase/functions/_shared/exclusivites.ts";

export type PhaseKey = "negociation" | "production" | "mesure" | "facturation" | "cloture";

export type CollabStepDef = {
  /** Numéro de l'étape (1 à 11). */
  n: number;
  /** Libellé complet, affiché tel quel. */
  label: string;
  /** Libellé court pour les pastilles compactes. */
  short: string;
  /** Grande phase, pour le regroupement (bento, filtres). */
  phase: PhaseKey;
};

export const STEPS: CollabStepDef[] = [
  { n: 1, label: "Signature", short: "Signature", phase: "negociation" },
  { n: 2, label: "Brief transmis au créateur", short: "Brief transmis", phase: "negociation" },
  { n: 3, label: "Concept validé", short: "Concept validé", phase: "negociation" },
  { n: 4, label: "Tournage", short: "Tournage", phase: "production" },
  { n: 5, label: "Validation marque", short: "Validation marque", phase: "production" },
  { n: 6, label: "Publication", short: "Publication", phase: "production" },
  { n: 7, label: "Statistiques à sept jours", short: "Stats à 7 jours", phase: "mesure" },
  { n: 8, label: "Facture envoyée", short: "Facture envoyée", phase: "facturation" },
  { n: 9, label: "Paiement marque reçu", short: "Paiement marque", phase: "facturation" },
  { n: 10, label: "Créateur payé", short: "Créateur payé", phase: "facturation" },
  { n: 11, label: "Bilan et renouvellement", short: "Bilan", phase: "cloture" },
];

export const STEP_COUNT = STEPS.length;

export const PHASES: { key: PhaseKey; label: string; dot: string }[] = [
  { key: "negociation", label: "Négociation", dot: "bg-wait" },
  { key: "production", label: "Production", dot: "bg-progress" },
  { key: "mesure", label: "Mesure", dot: "bg-info" },
  { key: "facturation", label: "Facturation", dot: "bg-ok" },
  { key: "cloture", label: "Clôture", dot: "bg-closed" },
];

export function stepDef(n: number): CollabStepDef {
  return STEPS.find((s) => s.n === n) ?? STEPS[0];
}

export function phaseOf(n: number): PhaseKey {
  return stepDef(n).phase;
}

/** Une collab est terminée quand elle atteint la dernière étape (bilan). */
export function isDone(step: number): boolean {
  return step >= STEP_COUNT;
}

/**
 * Collab encore « en cours » (travail à faire) : en cours ou déjà gagnée, tant qu'elle
 * n'a pas atteint la dernière étape. Sert aux totaux, à la prochaine action et à la
 * détection de stagnation (une collab gagnée à l'étape 5 a encore 6 étapes devant elle).
 */
export function isInProgress(status: string | null | undefined, step: number): boolean {
  return (status === "active" || status === "gagnee") && !isDone(step);
}

/** Étape « Créateur payé » (versement au créateur, noté dans Reversements). */
export const PAYOUT_STEP = 10;

/**
 * Un versement est-il noté pour ce créateur (blob `creatorPayouts`, clés sans tenir compte
 * des majuscules ni des accents) à partir de cette date (AAAA-MM-JJ, date de la facture de
 * la collab) ? Sans date : n'importe quel versement compte.
 */
export function payoutNotedSince(payouts: unknown, creator: string | null | undefined, sinceISO?: string | null): boolean {
  const who = foldName(creator);
  if (!who || !payouts || typeof payouts !== "object") return false;
  const since = String(sinceISO ?? "").slice(0, 10);
  for (const [k, list] of Object.entries(payouts as Record<string, unknown>)) {
    if (foldName(k) !== who || !Array.isArray(list)) continue;
    if (list.some((p) => (Number((p as { amount?: unknown })?.amount) || 0) > 0 && String((p as { date?: unknown })?.date ?? "").slice(0, 10) >= since)) return true;
  }
  return false;
}
