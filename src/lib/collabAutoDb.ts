import { supabase } from "./supabase";
import { pokeTeam } from "./team";
import { getAppState } from "./appState";
import { createStepTask } from "./collabLinksDb";
import { texteAvance, texteProspectSigne } from "./collabAuto";
import {
  apresCollabSignee, apresFacturePayee, apresVersement, type Avance, type LigneVersement,
} from "../../supabase/functions/_shared/collabAutoDb.ts";

/*
 * Étapes automatiques côté app (règles : collabAuto.ts ; écritures partagées avec le
 * connecteur : _shared/collabAutoDb.ts). Appelées APRÈS l'action principale, sans l'attendre
 * ni la bloquer : chaque fonction renvoie les textes à afficher (toasts), rien en cas d'échec.
 * Une collab qui avance prévient l'équipe et reçoit la tâche de l'étape (réglage
 * `collabAutoTasks`), comme un changement d'étape fait à la main dans Collabs.
 */

/** `paiementRecu` : l'avance vient d'une facture payée (la tâche « Reverser » reste due). */
async function suites(a: Avance, paiementRecu = false): Promise<string> {
  pokeTeam("collabs", { step: a.step });
  try {
    const st = await getAppState();
    if (st["collabAutoTasks"] !== false) await createStepTask({ id: a.collabId, brand: a.brand, creator: a.creator, step: a.step, status: "active" }, a.step, { paiementRecu });
  } catch {
    // Tâche de l'étape non créée : l'étape, elle, est bien enregistrée.
  }
  return texteAvance(a);
}

/** Facture passée « payée » (indice : collab choisie dans l'éditeur, pas encore enregistrée). */
export async function autoFacturePayee(invoiceId: string, indice?: string | null): Promise<string[]> {
  const a = await apresFacturePayee(supabase, invoiceId, indice);
  return a ? [await suites(a, true)] : [];
}

/** Versement noté pour un créateur, avec ses factures dues AVANT ce versement. */
export async function autoVersement(v: { createur: string; lignes: readonly LigneVersement[]; dejaVerse: number; montant: number }): Promise<string[]> {
  const list = await apresVersement(supabase, v);
  const out: string[] = [];
  for (const a of list) out.push(await suites(a));
  return out;
}

/** Collab créée, ou marquée gagnée hors étape 11 : le prospect ouvert de la marque passe « Signé ». */
export async function autoCollabSignee(collabId: string): Promise<string[]> {
  const p = await apresCollabSignee(supabase, collabId);
  return p ? [texteProspectSigne(p.brand)] : [];
}
