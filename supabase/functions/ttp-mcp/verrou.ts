// ============================================================================
// ttp-mcp/verrou.ts : le verrou des agents autonomes (Alfred), côté serveur.
// ----------------------------------------------------------------------------
// Une connexion marquée « agent » (mcp_grants.agent, case cochée sur la page d'accord ou dans
// Paramètres › Connexions Claude) ne lance un envoi ou une action irréversible que si un compte
// agence l'a validé dans l'app : proposition `agent.actions` passée « valide » dans la page
// Agents, avec `valide_par` et `valide_le` posés par la base elle même (déclencheur, d'après la
// session : jamais par le serveur ni par un texte). Quand un fondateur a choisi un valideur pour
// la connexion (mcp_grants.valideur), seule sa validation compte. Règles : _shared/verrouAgent.ts.
// SQL : 2026-11-27-securite-alfred, puis 2026-11-27-verrou-connexions (valideur, proposition
// gardée dans la file et relue juste avant l'envoi : validationToujoursLa).
// Les autres connexions (Marc, Gianni, leurs Claude) ne passent jamais par ici.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { Ctx } from "./oauth.ts";
import { lireEntetesBrouillon, parseMailBox } from "./gmail.ts";
import {
  VALIDATION_JOURS, besoinValidation, modifieApres, noteValideur, refusBrouillons, refusInterdit, refusOutil, validationBrouillon, validationOutil, validationTient,
  type PropositionRelue, type Validation,
} from "../_shared/verrouAgent.ts";

type Args = Record<string, unknown>;
const AGENCE = (Deno.env.get("AGENCY_MAIL_DOMAIN") ?? "ttpcreators.pro").toLowerCase();
const ENTETE = "Verrou agent : rien n'est parti, rien n'a été fait.";

export type Verdict =
  | { ok: true; validations?: Record<string, string>; propositions?: Record<string, string>; apres?: (reussi: boolean) => Promise<void> }
  | { ok: false; texte: string };

/** Ceux de ces comptes qui sont encore des comptes agence. Lève une erreur si la lecture échoue. */
async function comptesAgence(sb: SupabaseClient, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data, error } = await sb.from("profiles").select("user_id").in("user_id", ids).eq("role", "agency");
  if (error) throw new Error(`comptes illisibles (${error.message.slice(0, 120)})`);
  return new Set(((data as { user_id: string }[] | null) ?? []).map((p) => p.user_id));
}

/** Les propositions validées depuis 7 jours, et les comptes agence qui les ont validées. */
async function lireValidations(sb: SupabaseClient): Promise<{ liste: Validation[]; comptes: Set<string> } | { erreur: string }> {
  const depuis = new Date(Date.now() - VALIDATION_JOURS * 86_400_000).toISOString();
  const { data, error } = await sb.schema("agent").from("actions")
    .select("id, type, contexte, lien_spark, outil, valide_par, valide_le")
    .eq("statut", "valide").gte("valide_le", depuis).order("valide_le", { ascending: false }).limit(300);
  if (error) return { erreur: `validations illisibles (${error.message.slice(0, 120)}), SQL 2026-11-27-securite-alfred à lancer ?` };
  const liste = (data as Validation[] | null) ?? [];
  try {
    return { liste, comptes: await comptesAgence(sb, [...new Set(liste.map((v) => v.valide_par).filter((x): x is string => !!x))]) };
  } catch (e) {
    return { erreur: (e as Error).message };
  }
}

/** Le nom affiché du valideur imposé à la connexion, pour le dire dans un refus (null sans valideur). */
async function nomValideur(sb: SupabaseClient, ctx: Ctx): Promise<string | null> {
  if (!ctx.valideur) return null;
  const { data } = await sb.from("profiles").select("display_name").eq("user_id", ctx.valideur).maybeSingle<{ display_name: string | null }>();
  return String(data?.display_name ?? "").trim().replace(/\.\w*$/, "") || "la personne choisie dans Paramètres › Connexions Claude";
}

/**
 * Avant chaque outil : refus (avec la marche à suivre) ou feu vert. Pour un appel d'outil
 * validé, `apres` marque la proposition « envoye » quand l'outil a réussi (une validation = un appel).
 * Pour des brouillons, `validations` donne la date de validation de chacun et `propositions`
 * l'id de la proposition validée (file d'envoi : relue juste avant l'envoi).
 */
export async function verrouAgent(sb: SupabaseClient, ctx: Ctx, nom: string, a: Args): Promise<Verdict> {
  if (!ctx.agent) return { ok: true };
  const besoin = besoinValidation(nom, a, AGENCE);
  if (!besoin) return { ok: true };
  if (besoin.genre === "interdit") return { ok: false, texte: refusInterdit(nom, besoin.raison) };
  const v = await lireValidations(sb);
  if ("erreur" in v) return { ok: false, texte: `${ENTETE} Vérification impossible : ${v.erreur}.` };
  const maintenant = Date.now();
  const valideur = ctx.valideur ?? null;

  if (besoin.genre === "outil") {
    const trouve = validationOutil(v.liste, nom, a, v.comptes, maintenant, valideur);
    if (!trouve) return { ok: false, texte: refusOutil(nom, a, noteValideur(await nomValideur(sb, ctx))) };
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
    const val = validationBrouillon(v.liste, id, v.comptes, maintenant, valideur);
    if (!val?.valide_le) return { id, pourquoi: "aucune proposition validée dans la page Agents ne le cite" };
    try {
      const b = await lireEntetesBrouillon(sb, pb.box, id);
      if (modifieApres(b.date, val.valide_le)) return { id, pourquoi: "modifié après la validation, à faire valider de nouveau" };
      return { id, valideLe: val.valide_le, proposition: val.id };
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      return { id, pourquoi: /gmail_404/.test(m) ? "introuvable (déjà envoyé ou supprimé)" : `illisible (${m.slice(0, 80)})` };
    }
  }));
  const manquants = lus.filter((x): x is { id: string; pourquoi: string } => "pourquoi" in x);
  if (manquants.length) return { ok: false, texte: refusBrouillons(nom, manquants, noteValideur(await nomValideur(sb, ctx))) };
  const bons = lus as { id: string; valideLe: string; proposition: string }[];
  return {
    ok: true,
    validations: Object.fromEntries(bons.map((x) => [x.id, x.valideLe])),
    propositions: Object.fromEntries(bons.map((x) => [x.id, x.proposition])),
  };
}

const COLONNES = "id, type, statut, contexte, lien_spark, outil, valide_par, valide_le";

/**
 * File d'envoi, juste avant l'envoi d'un brouillon programmé par un agent : la validation
 * tient-elle encore (pas retirée, pas écartée, toujours d'un compte agence) ? Relit la
 * proposition gardée sur la ligne de la file ; sans elle (ligne programmée avant le SQL du
 * 27/11), les propositions de mail qui citent ce brouillon. Renvoie la date de la validation
 * qui tient (le brouillon ne doit pas avoir changé depuis), ou la raison de ne pas envoyer.
 * Lève une erreur si la base ne répond pas : la file réessaie plus tard (jamais d'envoi à l'aveugle).
 */
export async function validationToujoursLa(
  sb: SupabaseClient,
  row: { brouillon: string; proposition?: string | null },
): Promise<{ ok: true; valideLe: string } | { ok: false; raison: string }> {
  const db = sb.schema("agent").from("actions");
  const { data, error } = row.proposition
    ? await db.select(COLONNES).eq("id", row.proposition).limit(1)
    : await db.select(COLONNES).eq("type", "brouillon_mail").not("valide_le", "is", null)
      .or(`contexte.ilike.${JSON.stringify(`%${row.brouillon}%`)},lien_spark.ilike.${JSON.stringify(`%${row.brouillon}%`)}`)
      .order("valide_le", { ascending: false }).limit(20);
  if (error) throw new Error(`validation illisible : ${error.message.slice(0, 120)}`);
  const props = (data as PropositionRelue[] | null) ?? [];
  const comptes = await comptesAgence(sb, [...new Set(props.map((p) => p.valide_par).filter((x): x is string => !!x))]);
  const tient = props.find((p) => validationTient(p, row.brouillon, comptes) === null);
  if (tient?.valide_le) return { ok: true, valideLe: tient.valide_le };
  return { ok: false, raison: validationTient(props[0] ?? null, row.brouillon, comptes) ?? "validation introuvable dans la page Agents" };
}
