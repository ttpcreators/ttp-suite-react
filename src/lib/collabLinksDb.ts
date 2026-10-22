import { supabase } from "./supabase";
import { autoTaskFor, collabIdMissing, hasAutoTask, LINK_TABLES, type CollabLite, type LinkData, type LinkTable } from "./collabLinks";
import { requestIntent } from "./openIntent";
import { dbInsert } from "./db";
import { creatorsPatch } from "./todoCreators";
import { todosHaveCreators } from "./todoCreatorsDb";

/*
 * Accès base de « la collab au centre » (logique pure : collabLinks.ts).
 * Toutes les lectures marchent AVANT le SQL 2026-10-23-collab-id.sql : `select *` ne
 * demande pas `collab_id`, et l'écriture du lien est faite à part (jamais dans l'insertion
 * principale d'un objet, qui ne peut donc pas échouer à cause de la colonne).
 */

let columnMissing: boolean | null = null;

/** La colonne `collab_id` existe-t-elle ? (une sonde, gardée pour la visite). */
export async function collabIdReady(): Promise<boolean> {
  if (columnMissing !== null) return !columnMissing;
  const { error } = await supabase.from("todos").select("collab_id").limit(1);
  columnMissing = collabIdMissing(error);
  return !columnMissing;
}

/** Collabs pour les champs « Collab » et les liens retour (id, marque, créateur, étape). */
export async function loadCollabsLite(): Promise<CollabLite[]> {
  const { data, error } = await supabase.from("collabs").select("id,brand,creator,step,status,cachet").order("sort_order");
  return error ? [] : ((data as CollabLite[]) ?? []);
}

/** Les 5 tables reliables, entières (agence : la RLS lui donne tout). */
export async function loadLinkData(): Promise<LinkData> {
  const res = await Promise.all(LINK_TABLES.map((t) => supabase.from(t).select("*").limit(2000)));
  const out = {} as LinkData;
  LINK_TABLES.forEach((t, i) => {
    out[t] = res[i].error ? [] : ((res[i].data as Record<string, unknown>[]) ?? []);
  });
  return out;
}

export type LinkResult = "ok" | "missing" | "error";

/** Relie (ou détache, `null`) un objet à une collab. « missing » = SQL pas encore lancé. */
export async function setCollabLink(table: LinkTable, id: string, collabId: string | null): Promise<LinkResult> {
  if (!(await collabIdReady())) return "missing";
  const { data, error } = await supabase.from(table).update({ collab_id: collabId }).eq("id", id).select("id");
  if (error) return collabIdMissing(error) ? "missing" : "error";
  return (data?.length ?? 0) > 0 ? "ok" : "error";
}

/** Collab reliée à un objet (null si aucune ou si la colonne n'existe pas encore). */
export async function getCollabLink(table: LinkTable, id: string): Promise<string | null> {
  if (!(await collabIdReady())) return null;
  const { data, error } = await supabase.from(table).select("collab_id").eq("id", id).maybeSingle<{ collab_id: string | null }>();
  return error ? null : data?.collab_id ?? null;
}

/** Ouvre la fiche d'une collab dans la page Collabs. */
export async function openCollab(collabId: string): Promise<void> {
  requestIntent("collab:open", collabId);
  window.dispatchEvent(new CustomEvent("ttp-navigate", { detail: "collabs" }));
}

/**
 * Tâche de l'étape que la collab vient d'atteindre (« Résumer le brief pour Léna » à J+1…).
 * Pas de doublon : une tâche au même texte pour cette collab (ou sans collab) existe déjà.
 */
export async function createStepTask(c: CollabLite, step: number): Promise<"created" | "exists" | "none" | "error"> {
  const task = autoTaskFor(step, c);
  if (!task) return "none";
  const { data: same, error } = await supabase.from("todos").select("*").ilike("text", task.text.replace(/[\\%_]/g, (m) => `\\${m}`));
  if (error) return "error";
  if (hasAutoTask((same as { text: string; collab_id?: string | null }[]) ?? [], c.id, task.text)) return "exists";
  const created = await dbInsert("todos", {
    text: task.text,
    descr: null,
    due: task.due,
    ...creatorsPatch(c.creator ? [c.creator] : [], await todosHaveCreators()),
    priority: "moyenne",
    source: "agency",
    done: false,
    sort_order: Math.floor(Date.now() / 1000),
  });
  if (!created) return "error";
  await setCollabLink("todos", (created as { id: string }).id, c.id);
  return "created";
}
