import { supabase } from "./supabase";
import { dbUpdate } from "./db";
import { pokeTeam, myDisplayName } from "./team";
import { getAppState, mergeAppStateKey } from "./appState";
import { markProspectSigned } from "./prospectsDb";
import { IGNORES_KEY, type ControleInput, type Correction } from "./controle";

/*
 * Accès base du contrôle qualité (logique pure : supabase/functions/_shared/controle.ts).
 * Chaque table est lue à part : une lecture ratée donne null et ses règles sont sautées,
 * jamais une fausse alerte. Les colonnes récentes ont un repli (`select *`).
 */

type Res = { data: unknown; error: { message: string } | null };

/** Lit `cols`, et `*` si une colonne manque encore en prod. null si la table est illisible. */
async function lire<T>(table: string, cols: string): Promise<T[] | null> {
  const run = (c: string) => supabase.from(table).select(c) as unknown as Promise<Res>;
  let r = await run(cols);
  if (r.error && cols !== "*") r = await run("*");
  return r.error ? null : ((r.data as T[] | null) ?? []);
}

/** Toutes les données du contrôle. `founder` = false : ni factures ni versements (règles d'argent sautées). */
export async function chargerControle(founder: boolean, aujourdhui: string): Promise<ControleInput> {
  const [collabs, collabSteps, invoices, creators, briefs, prospects, todos, contacts, st] = await Promise.all([
    lire<NonNullable<ControleInput["collabs"]>[number]>("collabs", "id,brand,creator,step,status,brief_id,cachet,created_at"),
    lire<NonNullable<ControleInput["collabSteps"]>[number]>("collab_steps", "collab_id,step,reached_at"),
    founder ? lire<NonNullable<ControleInput["invoices"]>[number]>("invoices", "id,ref,party,amount,date,status,creator,collab_id,paid_at") : Promise.resolve(null),
    lire<NonNullable<ControleInput["creators"]>[number]>("creators", "name,status,email,email_pro,phone,photo_url,platform"),
    lire<{ id: string }>("briefs", "id"),
    lire<NonNullable<ControleInput["prospects"]>[number]>("prospects", "id,brand,stage,creator,collab_id,proposal,created_at"),
    lire<NonNullable<ControleInput["todos"]>[number]>("todos", "id,text,done,status"),
    lire<NonNullable<ControleInput["contacts"]>[number]>("contacts", "id,tag"),
    getAppState().catch(() => null),
  ]);
  return {
    aujourdhui,
    collabs,
    collabSteps,
    invoices,
    creators,
    briefs,
    prospects,
    todos,
    contacts,
    payouts: founder && st ? ((st.creatorPayouts as Record<string, unknown> | undefined) ?? {}) : null,
    cashModes: st ? ((st.collabCashMode as Record<string, string> | undefined) ?? {}) : null,
    contractHistory: st ? (st.contractHistory ?? []) : null,
  };
}

/** Applique une correction sûre. true = enregistrée. */
export async function appliquerCorrection(c: Correction): Promise<boolean> {
  if (c.type === "tache_fait") return dbUpdate("todos", c.todoId, { status: "Fait", done: true });
  if (c.type === "prospect_signe") return markProspectSigned(c.prospectId, c.collabId);
  // Lien de brief : retiré seulement s'il pointe toujours vers le brief supprimé.
  const { data, error } = await supabase.from("collabs").update({ brief_id: null }).eq("id", c.collabId).eq("brief_id", c.briefId).select("id");
  if (error || !data?.length) return false;
  pokeTeam("collabs");
  return true;
}

/** Masque un problème pour toute l'agence (blob `controleIgnores`). */
export async function ignorerProbleme(id: string): Promise<boolean> {
  return mergeAppStateKey(IGNORES_KEY, { [id]: { at: new Date().toISOString(), by: await myDisplayName().catch(() => "") } });
}
