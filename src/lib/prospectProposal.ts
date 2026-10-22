/*
 * Tarifs → prospect → collab (règles PURES, testées par prospectProposal.test.ts).
 *   • « Proposer » (Tarifs) enregistre le prix calculé comme proposition sur un prospect
 *     de la marque (créé, ou mis à jour s'il existe déjà) ;
 *   • « Transformer en collab » (Prospection) crée la collab avec marque, créateur,
 *     livrables et cachet déjà remplis, à l'étape 1, et relie le prospect à la collab.
 * Les colonnes `creator`, `deliverables`, `proposal`, `contact_id`, `collab_id` des
 * prospects viennent du SQL 2026-10-23-prospects-proposition.sql : avant lui, la
 * proposition tient dans la colonne `value` (« 800 – 1 100 € HT »).
 */
import { formatEuro, parseAmount } from "./money";
import { sameBrand } from "./brandRecord";
import { priceRange } from "./pricingForm";

/** Étapes enregistrées d'un prospect (libellés affichés : Prospection.tsx). */
export const PROPOSAL_STAGE = "Négociation";
export const SIGNED_STAGE = "Signé";

export type Proposal = {
  mode: "influence" | "ugc";
  creator: string | null;
  deliverables: string;
  min: number;
  max: number;
  target: number;
  /** Date de la proposition (ISO). */
  at: string;
};

export type ProspectLite = {
  id: string;
  brand: string;
  contact: string | null;
  value: string | null;
  stage: string | null;
  creator?: string | null;
  deliverables?: string | null;
  proposal?: Proposal | null;
  contact_id?: string | null;
  collab_id?: string | null;
};

/** « 800 – 1 100 € HT » (un seul montant si la fourchette est plate). */
export function proposalValue(p: Pick<Proposal, "min" | "max">): string {
  return priceRange(Math.round(p.min), Math.round(p.max));
}

/** Contact de la marque (page Contacts) à relier au prospect : le premier qui correspond. */
export function contactForBrand<T extends { id: string; brand: string | null }>(contacts: readonly T[], brand: string): T | null {
  return contacts.find((c) => sameBrand(c.brand, brand)) ?? null;
}

/** Prospect de la marque déjà en cours (pas encore transformé en collab), sinon null. */
export function openProspectFor(prospects: readonly ProspectLite[], brand: string): ProspectLite | null {
  return prospects.find((p) => sameBrand(p.brand, brand) && !p.collab_id && p.stage !== SIGNED_STAGE) ?? null;
}

/**
 * Champs à écrire sur le prospect pour une proposition. `full` = les colonnes du SQL
 * existent (sinon seulement marque, contact, valeur, étape).
 */
export function proposalPatch(
  p: Proposal,
  extra: { brand: string; contact: string | null; contactId: string | null },
  full: boolean,
): Record<string, unknown> {
  const base: Record<string, unknown> = { brand: extra.brand.trim(), contact: extra.contact?.trim() || null, value: proposalValue(p), stage: PROPOSAL_STAGE };
  if (!full) return base;
  return { ...base, creator: p.creator, deliverables: p.deliverables || null, proposal: p, contact_id: extra.contactId };
}

/** Cachet de la collab : le prix cible proposé, sinon le haut du montant saisi à la main. */
export function cachetOf(p: ProspectLite): string {
  if (p.proposal && p.proposal.target > 0) return formatEuro(p.proposal.target);
  const amounts = String(p.value ?? "").match(/\d[\d\s.,]*/g) ?? [];
  const hi = Math.max(0, ...amounts.map((a) => parseAmount(a)));
  return hi > 0 ? formatEuro(hi) : "";
}

/** Collab créée depuis un prospect (étape 1, en cours). */
export function collabFromProspect(
  p: ProspectLite,
  form: { creator: string; deliverables: string; cachet: string },
  sortOrder: number,
): Record<string, unknown> {
  return {
    brand: p.brand.trim(),
    creator: form.creator.trim() || null,
    contact: p.contact?.trim() || null,
    deliverables: form.deliverables.trim() || null,
    cachet: form.cachet.trim() || null,
    step: 1,
    status: "active",
    sort_order: sortOrder,
  };
}
