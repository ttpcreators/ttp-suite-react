/**
 * Les 11 étapes d'une collab (cycle de vie complet, de la signature au bilan).
 * Source unique, partagée par la page Collabs et (plus tard) la page Agent, pour
 * que l'agent détecte ce qui stagne. Ordre et libellés figés par la spec.
 *
 * Chaque collab porte une étape courante (`collabs.step`, 1 à 11) ; chaque
 * changement d'étape est daté dans `collab_steps` (via un trigger côté base), ce
 * qui donne l'historique « telle étape franchie tel jour ».
 */

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
  { n: 2, label: "Brief transmis à la créatrice", short: "Brief transmis", phase: "negociation" },
  { n: 3, label: "Concept validé", short: "Concept validé", phase: "negociation" },
  { n: 4, label: "Tournage", short: "Tournage", phase: "production" },
  { n: 5, label: "Validation marque", short: "Validation marque", phase: "production" },
  { n: 6, label: "Publication", short: "Publication", phase: "production" },
  { n: 7, label: "Statistiques à sept jours", short: "Stats à 7 jours", phase: "mesure" },
  { n: 8, label: "Facture envoyée", short: "Facture envoyée", phase: "facturation" },
  { n: 9, label: "Paiement marque reçu", short: "Paiement marque", phase: "facturation" },
  { n: 10, label: "Créatrice payée", short: "Créatrice payée", phase: "facturation" },
  { n: 11, label: "Bilan et renouvellement", short: "Bilan", phase: "cloture" },
];

export const STEP_COUNT = STEPS.length;

export const PHASES: { key: PhaseKey; label: string; dot: string }[] = [
  { key: "negociation", label: "Négociation", dot: "bg-primary" },
  { key: "production", label: "Production", dot: "bg-cyan" },
  { key: "mesure", label: "Mesure", dot: "bg-indigo" },
  { key: "facturation", label: "Facturation", dot: "bg-amber" },
  { key: "cloture", label: "Clôture", dot: "bg-signal" },
];

export function stepDef(n: number): CollabStepDef {
  return STEPS.find((s) => s.n === n) ?? STEPS[0];
}

export function phaseOf(n: number): PhaseKey {
  return stepDef(n).phase;
}

export function phaseLabel(key: PhaseKey): string {
  return PHASES.find((p) => p.key === key)?.label ?? "";
}

/** Une collab est terminée quand elle atteint la dernière étape (bilan). */
export function isDone(step: number): boolean {
  return step >= STEP_COUNT;
}
