import { supabase } from "./supabase";
import { CONCEPT_COLS, conceptColumnsMissing, type BriefConcept } from "./briefConcept";

/*
 * Accès base de « J'ai lu » et du concept d'un brief (logique pure : briefConcept.ts).
 * Avant le SQL 2026-11-23-espace-createur-collab.sql les colonnes manquent : la lecture
 * renvoie `missing` et l'app cache les boutons. Le créateur n'écrit que read_at, concept et
 * concept_link (garde briefs_creator_guard) ; la validation est réservée à l'agence.
 */

export type ConceptLoad = { rows: BriefConcept[]; missing: boolean; error: boolean };

export async function loadBriefConcepts(by: { creator?: string; ids?: string[] }): Promise<ConceptLoad> {
  let q = supabase.from("briefs").select(CONCEPT_COLS);
  if (by.ids) q = q.in("id", by.ids.length ? by.ids : ["00000000-0000-0000-0000-000000000000"]);
  else if (by.creator) q = q.eq("creator", by.creator);
  const { data, error } = await q;
  if (error) return { rows: [], missing: conceptColumnsMissing(error), error: !conceptColumnsMissing(error) };
  return { rows: (data as BriefConcept[] | null) ?? [], missing: false, error: false };
}

async function patchBrief(id: string, patch: Record<string, unknown>): Promise<BriefConcept | null> {
  const { data, error } = await supabase.from("briefs").update(patch).eq("id", id).select(CONCEPT_COLS).maybeSingle();
  return error || !data ? null : (data as BriefConcept);
}

/** « J'ai lu » : la date est posée par le serveur. */
export function markBriefRead(id: string): Promise<BriefConcept | null> {
  return patchBrief(id, { read_at: new Date().toISOString() });
}

/** Proposer (ou modifier) un concept : il repasse « proposé ». */
export function proposeConcept(id: string, concept: string, link: string | null): Promise<BriefConcept | null> {
  return patchBrief(id, { concept, concept_link: link, concept_status: "propose", concept_at: new Date().toISOString(), concept_validated_at: null });
}

/** Agence : valider le concept proposé. */
export function validateConcept(id: string): Promise<BriefConcept | null> {
  return patchBrief(id, { concept_status: "valide", concept_validated_at: new Date().toISOString() });
}
