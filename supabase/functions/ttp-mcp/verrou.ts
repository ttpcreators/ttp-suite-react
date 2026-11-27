// ============================================================================
// ttp-mcp/verrou.ts : le verrou des agents autonomes (Alfred), côté serveur.
// ----------------------------------------------------------------------------
// Une connexion marquée « agent » (mcp_grants.agent, case cochée sur la page d'accord) ne
// lance un envoi ou une action irréversible que si un compte agence l'a validé dans l'app :
// proposition `agent.actions` passée « valide » dans la page Agents, avec `valide_par` et
// `valide_le` posés par la base elle même (déclencheur, d'après la session : jamais par le
// serveur ni par un texte). Règles : _shared/verrouAgent.ts. SQL : 2026-11-27-securite-alfred.
// Les autres connexions (Marc, Gianni, leurs Claude) ne passent jamais par ici.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { Ctx } from "./oauth.ts";
import { lireEntetesBrouillon, parseMailBox } from "./gmail.ts";
import {
  VALIDATION_JOURS, besoinValidation, modifieApres, refusBrouillons, refusInterdit, refusOutil, validationBrouillon, validationOutil, type Validation,
} from "../_shared/verrouAgent.ts";

type Args = Record<string, unknown>;
const AGENCE = (Deno.env.get("AGENCY_MAIL_DOMAIN") ?? "ttpcreators.pro").toLowerCase();
const ENTETE = "Verrou agent : rien n'est parti, rien n'a été fait.";

export type Verdict =
  | { ok: true; validations?: Record<string, string>; apres?: (reussi: boolean) => Promise<void> }
  | { ok: false; texte: string };

/** Les propositions validées depuis 7 jours, et les comptes agence qui les ont validées. */
async function lireValidations(sb: SupabaseClient): Promise<{ liste: Validation[]; comptes: Set<string> } | { erreur: string }> {
  const depuis = new Date(Date.now() - VALIDATION_JOURS * 86_400_000).toISOString();
  const { data, error } = await sb.schema("agent").from("actions")
    .select("id, type, contexte, lien_spark, outil, valide_par, valide_le")
    .eq("statut", "valide").gte("valide_le", depuis).order("valide_le", { ascending: false }).limit(300);
  if (error) return { erreur: `validations illisibles (${error.message.slice(0, 120)}), SQL 2026-11-27-securite-alfred à lancer ?` };
  const liste = (data as Validation[] | null) ?? [];
  const ids = [...new Set(liste.map((v) => v.valide_par).filter((x): x is string => !!x))];
  if (!ids.length) return { liste, comptes: new Set() };
  const { data: profils, error: e2 } = await sb.from("profiles").select("user_id").in("user_id", ids).eq("role", "agency");
  if (e2) return { erreur: `comptes illisibles (${e2.message.slice(0, 120)})` };
  return { liste, comptes: new Set(((profils as { user_id: string }[] | null) ?? []).map((p) => p.user_id)) };
}

/**
 * Avant chaque outil : refus (avec la marche à suivre) ou feu vert. Pour un appel d'outil
 * validé, `apres` marque la proposition « envoye » quand l'outil a réussi (une validation = un appel).
 * Pour des brouillons, `validations` donne la date de validation de chacun (file d'envoi).
 */
export async function verrouAgent(sb: SupabaseClient, ctx: Ctx, nom: string, a: Args): Promise<Verdict> {
  if (!ctx.agent) return { ok: true };
  const besoin = besoinValidation(nom, a, AGENCE);
  if (!besoin) return { ok: true };
  if (besoin.genre === "interdit") return { ok: false, texte: refusInterdit(nom, besoin.raison) };
  const v = await lireValidations(sb);
  if ("erreur" in v) return { ok: false, texte: `${ENTETE} Vérification impossible : ${v.erreur}.` };
  const maintenant = Date.now();

  if (besoin.genre === "outil") {
    const trouve = validationOutil(v.liste, nom, a, v.comptes, maintenant);
    if (!trouve) return { ok: false, texte: refusOutil(nom, a) };
    return {
      ok: true,
      apres: async (reussi) => {
        if (!reussi) return; // l'outil a échoué : la validation reste, l'agent peut réessayer
        await sb.schema("agent").from("actions").update({ statut: "envoye", traite_le: new Date().toISOString() }).eq("id", trouve.id).eq("statut", "valide");
      },
    };
  }

  if (!besoin.ids.length) return { ok: false, texte: refusBrouillons(nom, [{ id: "?", pourquoi: "aucun id de brouillon valable" }]) };
  const pb = await parseMailBox(sb, a.boite);
  if ("error" in pb) return { ok: false, texte: `${ENTETE} ${pb.error}` };
  const lus = await Promise.all(besoin.ids.map(async (id) => {
    const val = validationBrouillon(v.liste, id, v.comptes, maintenant);
    if (!val?.valide_le) return { id, pourquoi: "aucune proposition validée dans la page Agents ne le cite" };
    try {
      const b = await lireEntetesBrouillon(sb, pb.box, id);
      if (modifieApres(b.date, val.valide_le)) return { id, pourquoi: "modifié après la validation, à faire valider de nouveau" };
      return { id, valideLe: val.valide_le };
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      return { id, pourquoi: /gmail_404/.test(m) ? "introuvable (déjà envoyé ou supprimé)" : `illisible (${m.slice(0, 80)})` };
    }
  }));
  const manquants = lus.filter((x): x is { id: string; pourquoi: string } => "pourquoi" in x);
  if (manquants.length) return { ok: false, texte: refusBrouillons(nom, manquants) };
  return { ok: true, validations: Object.fromEntries(lus.map((x) => [x.id, (x as { valideLe: string }).valideLe])) };
}
