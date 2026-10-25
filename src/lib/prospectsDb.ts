import { supabase } from "./supabase";
import { dbInsert, dbUpdate } from "./db";
import { contactForBrand, openProspectFor, proposalPatch, type Proposal, type ProspectLite } from "./prospectProposal";

/*
 * Accès base de Tarifs → prospect → collab (logique pure : prospectProposal.ts).
 * Les colonnes ajoutées par sql/2026-10-23-prospects-proposition.sql sont sondées une fois :
 * avant le SQL, tout marche sans elles (la proposition tient dans `value`).
 */

let ready: boolean | null = null;

const missingCol = (e: { code?: string | null; message?: string | null } | null | undefined) =>
  !!e && (e.code === "42703" || e.code === "PGRST204" || /(proposal|contact_id|collab_id|deliverables|creator)/i.test(e.message ?? ""));

/** Les colonnes de proposition existent-elles ? */
export async function proposalColumnsReady(): Promise<boolean> {
  if (ready !== null) return ready;
  const { error } = await supabase.from("prospects").select("proposal,contact_id,collab_id").limit(1);
  ready = !missingCol(error);
  return ready;
}

/** Tous les prospects, avec les colonnes de proposition si elles existent. */
export async function loadProspects(): Promise<ProspectLite[]> {
  const full = await proposalColumnsReady();
  const cols = full ? "id,brand,contact,value,stage,creator,deliverables,proposal,contact_id,collab_id" : "id,brand,contact,value,stage";
  const { data, error } = await supabase.from("prospects").select(cols).order("sort_order");
  return error ? [] : ((data as unknown as ProspectLite[]) ?? []);
}

/**
 * « Proposer » : met la proposition sur le prospect ouvert de la marque, ou en crée un.
 * Relie le contact de la marque s'il existe. Renvoie le prospect écrit (ou null en cas d'échec).
 */
export async function saveProposal(p: Proposal, brand: string, contact: string | null): Promise<{ id: string; created: boolean } | null> {
  const full = await proposalColumnsReady();
  const [prospects, contacts] = await Promise.all([
    loadProspects(),
    supabase.from("contacts").select("id,brand").then(({ data, error }) => (error ? [] : ((data as { id: string; brand: string | null }[]) ?? []))),
  ]);
  const contactId = contactForBrand(contacts, brand)?.id ?? null;
  const patch = proposalPatch(p, { brand, contact, contactId }, full);
  const open = openProspectFor(prospects, brand);
  if (open) {
    // On garde le contact déjà noté sur le prospect si rien n'est saisi.
    if (!contact?.trim()) delete patch.contact;
    return (await dbUpdate("prospects", open.id, patch)) ? { id: open.id, created: false } : null;
  }
  const row = await dbInsert("prospects", { ...patch, tone: "info", sort_order: 0 });
  return row ? { id: (row as { id: string }).id, created: true } : null;
}

/**
 * Collab déjà reliée au prospect, relue en base (un collègue a pu signer depuis le dernier
 * chargement). null = aucune, ou colonne absente / lecture impossible : on laisse créer.
 */
export async function prospectCollabId(id: string): Promise<string | null> {
  if (!(await proposalColumnsReady())) return null;
  const { data, error } = await supabase.from("prospects").select("collab_id").eq("id", id).maybeSingle<{ collab_id: string | null }>();
  return error ? null : data?.collab_id ?? null;
}

/** Relie un prospect à la collab créée et le passe en « Signé ». */
export async function markProspectSigned(id: string, collabId: string): Promise<boolean> {
  const full = await proposalColumnsReady();
  return dbUpdate("prospects", id, full ? { stage: "Signé", collab_id: collabId } : { stage: "Signé" });
}
