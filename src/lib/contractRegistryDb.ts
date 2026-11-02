import { dbTrash } from "./trash";
import { supabase } from "@/lib/supabase";
import { getAppState, invalidateAppState, listAppStateKey } from "@/lib/appState";
import type { BrandContact, ContractRow, ContractStatus, HistKey } from "@/lib/contractRegistry";

/*
 * Écritures de la page d'arrivée Contrats. Toujours PARTIELLES (listAppStateKey) :
 * seule l'entrée touchée est envoyée, les autres contrats ne sont jamais réécrits.
 */

type Entry = { id: string } & Record<string, unknown>;

async function freshEntry(key: HistKey, id: string): Promise<Entry | null> {
  invalidateAppState();
  const list = (await getAppState())[key];
  if (!Array.isArray(list)) return null;
  const e = list.find((x) => x && typeof x === "object" && (x as Entry).id === id);
  return (e as Entry) ?? null;
}

/** Change le statut d'un contrat (relecture fraîche de SON entrée, puis remplacement sur place). */
export async function setContractStatus(key: HistKey, id: string, status: ContractStatus): Promise<boolean> {
  try {
    const cur = await freshEntry(key, id);
    if (!cur) return false;
    const next: Entry = { ...cur, status, statusAt: Date.now() };
    return await listAppStateKey(key, [next]);
  } catch {
    return false;
  }
}

/** Supprime un contrat de la liste. Représentation : retire aussi son document (espace créateur) et son fichier,
 *  comme le fait la page Représentation. Renvoie « partial » si le document n'a pas pu être retiré. */
export async function deleteContractRow(row: Pick<ContractRow, "key" | "id">): Promise<"ok" | "partial" | "error"> {
  try {
    const cur = row.key === "contractHistory" ? await freshEntry(row.key, row.id) : null;
    if (!(await listAppStateKey(row.key, [], [row.id]))) return "error";
    if (row.key !== "contractHistory") return "ok";
    // Document par la Corbeille (fichier gardé, restaurable) ; pas de document : rien à faire.
    const { data } = await supabase.from("documents").select("id").eq("id", row.id).limit(1);
    if (!data?.length) return "ok";
    const label = typeof cur?.title === "string" && cur.title ? cur.title : "Contrat de représentation";
    return (await dbTrash("documents", row.id, label)) ? "ok" : "partial";
  } catch {
    return "error";
  }
}

/** Contacts de marque ayant un e-mail (pour « Relancer »). */
export async function loadBrandContacts(): Promise<BrandContact[]> {
  const { data, error } = await supabase.from("contacts").select("brand,email,person,first_name,creator").neq("email", "");
  if (error) return [];
  return (data as BrandContact[]) ?? [];
}

/** E-mail d'un créateur du roster (perso d'abord, sinon pro). */
export async function creatorEmail(name: string): Promise<string> {
  const { data } = await supabase.from("creators").select("email,email_pro").eq("name", name).limit(1);
  const row = (data?.[0] as { email: string | null; email_pro: string | null } | undefined) ?? null;
  return (row?.email || row?.email_pro || "").trim();
}
