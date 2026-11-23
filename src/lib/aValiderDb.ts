import { supabase } from "./supabase";
import { getAppState } from "./appState";
import { createStepTask } from "./collabLinksDb";
import { stepDef } from "./collabs";
import { titleCase } from "./utils";
import { detailModification, patchEtape, type PropositionLite } from "./aValider";

/*
 * Accès base de la file « À valider » (logique pure : aValider.ts).
 */

/**
 * « Valider » sur une proposition « avancer la collab » : la colonne `step` (le trigger date
 * l'étape dans `collab_steps`), « gagnée » à la dernière étape, et la tâche de l'étape si le
 * réglage d'équipe est actif. Mise à jour conditionnelle (étape plus basse, collab ni perdue
 * ni archivée) : si rien n'a bougé, `ok` est faux et le message dit pourquoi.
 */
export async function avancerCollabDepuisFile(collabId: string, etape: number): Promise<{ ok: boolean; message: string }> {
  const { data, error } = await supabase.from("collabs").select("id, brand, creator, step, status").eq("id", collabId).maybeSingle<{ id: string; brand: string; creator: string | null; step: number; status: string }>();
  if (error) return { ok: false, message: "Erreur, réessaie" };
  if (!data) return { ok: false, message: "Collab introuvable : écarte la proposition" };
  const nom = `${data.brand}${data.creator ? ` × ${titleCase(data.creator)}` : ""}`;
  const patch = patchEtape({ step: data.step, status: data.status }, etape);
  if (!patch) {
    return {
      ok: false,
      message: data.status === "perdue" || data.status === "archivee"
        ? `${nom} est ${data.status === "perdue" ? "perdue" : "archivée"} : rien n'avance, écarte la proposition`
        : `${nom} est déjà à l'étape ${data.step} : rien n'avance, écarte la proposition`,
    };
  }
  const { data: up, error: e2 } = await supabase.from("collabs").update(patch)
    .eq("id", data.id).lt("step", patch.step).not("status", "in", "(perdue,archivee)").select("id");
  if (e2) return { ok: false, message: "Erreur, réessaie" };
  if (!up?.length) return { ok: false, message: `${nom} a changé entre temps : rien n'avance, recharge la page` };
  const st = await getAppState().catch(() => null);
  if (st && st["collabAutoTasks"] !== false) {
    void createStepTask({ id: data.id, brand: data.brand, creator: data.creator, step: patch.step, status: patch.status ?? data.status }, patch.step);
  }
  return { ok: true, message: `${nom} : étape ${patch.step} · ${stepDef(patch.step).short} ✓` };
}

/**
 * Trace « avant / après » d'un texte que Marc a modifié avant de valider, dans le journal des
 * agents (action `marc_modifie`, rattachée à l'agent qui avait proposé). Rien de bloquant.
 */
export async function noterModification(a: PropositionLite, avant: string, apres: string): Promise<void> {
  const row: Record<string, string> = { action: "marc_modifie", detail: detailModification(a, avant, apres) };
  const db = supabase.schema("agent").from("journal");
  const { error } = await db.insert(a.agent_id ? { ...row, agent_id: a.agent_id } : row);
  // Colonne agent_id absente (très ancien schéma) : la trace sans l'agent.
  if (error && a.agent_id) await db.insert(row).then(() => {}, () => {});
}
