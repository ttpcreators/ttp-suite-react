// ============================================================================
// ttp-mcp/verrou.ts : le verrou des agents autonomes (Alfred), côté serveur.
// ----------------------------------------------------------------------------
// Une connexion marquée « agent » (mcp_grants.agent, case cochée sur la page d'accord ou dans
// Paramètres › Connexions Claude) ne lance un envoi ou une action irréversible que si un compte
// agence l'a validé dans l'app : proposition `agent.actions` passée « valide » dans la page
// Agents, avec `valide_par` et `valide_le` posés par la base elle même (déclencheur, d'après la
// session : jamais par le serveur ni par un texte). Quand un fondateur a choisi un valideur pour
// la connexion (mcp_grants.valideur), seule sa validation compte. Règles : _shared/verrouAgent.ts.
// SQL : 2026-11-27-securite-alfred, puis 2026-11-27-verrou-connexions (valideur, proposition et
// connexion gardées dans la file et relues juste avant l'envoi : connexionDeLaFile,
// validationToujoursLa).
// Depuis le 28/11 : une validation ne vaut que pour la connexion qui l'a proposée (grant_id), elle
// est consommée (statut « envoye ») AVANT que l'outil tourne (deux appels lancés ensemble ne
// passent pas sur la même), et un brouillon doit avoir l'empreinte relevée par le serveur quand
// il l'a montré dans la page Agents (brouillonVerrou.ts).
// Les autres connexions (Marc, Gianni, leurs Claude) ne passent jamais par ici.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { Ctx } from "./oauth.ts";
import { parseMailBox } from "./gmail.ts";
import { lireBrouillonComplet } from "./brouillonVerrou.ts";
import {
  VALIDATION_JOURS, besoinValidation, brouillonDe, empreinteBrouillon, empreinteChangee, refusBrouillons, refusInterdit, refusOutil, validationBrouillon,
  validationOutil, validationTient, type ConnexionFile, type PropositionRelue, type Validation,
} from "../_shared/verrouAgent.ts";

type Args = Record<string, unknown>;
const AGENCE = (Deno.env.get("AGENCY_MAIL_DOMAIN") ?? "ttpcreators.pro").toLowerCase();
const ENTETE = "Verrou agent : rien n'est parti, rien n'a été fait.";

export type Verdict =
  | { ok: true; validations?: Record<string, string>; propositions?: Record<string, string>; messages?: Record<string, string>; consommees?: number }
  | { ok: false; texte: string };

/**
 * Consomme des validations (statut valide → envoye, seulement si elles sont encore « valide ») et
 * renvoie celles qui ont été prises. Le déclencheur agent.action_validation garde valide_par et
 * valide_le : la file d'envoi relit encore la proposition juste avant l'envoi.
 */
async function consommer(sb: SupabaseClient, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data, error } = await sb.schema("agent").from("actions")
    .update({ statut: "envoye", traite_le: new Date().toISOString() }).in("id", ids).eq("statut", "valide").select("id");
  if (error) throw new Error(`validation non consommée (${error.message.slice(0, 120)})`);
  return new Set(((data as { id: string }[] | null) ?? []).map((r) => r.id));
}

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
    .select("id, type, contexte, lien_spark, outil, valide_par, valide_le, grant_id")
    .eq("statut", "valide").gte("valide_le", depuis).order("valide_le", { ascending: false }).limit(300);
  if (error) return { erreur: `validations illisibles (${error.message.slice(0, 120)}), SQL 2026-11-27-securite-alfred à lancer ?` };
  const liste = (data as Validation[] | null) ?? [];
  try {
    return { liste, comptes: await comptesAgence(sb, [...new Set(liste.map((v) => v.valide_par).filter((x): x is string => !!x))]) };
  } catch (e) {
    return { erreur: (e as Error).message };
  }
}

/**
 * Le nom affiché du valideur imposé à la connexion, pour le dire dans un refus à la place de
 * « un fondateur » (null sans valideur).
 */
async function nomValideur(sb: SupabaseClient, ctx: Ctx): Promise<string | null> {
  if (!ctx.valideur) return null;
  const { data } = await sb.from("profiles").select("display_name").eq("user_id", ctx.valideur).maybeSingle<{ display_name: string | null }>();
  return String(data?.display_name ?? "").trim().replace(/\.\w*$/, "") || "la personne choisie dans Paramètres › Connexions Claude";
}

/**
 * Avant chaque outil : refus (avec la marche à suivre) ou feu vert. La validation trouvée est
 * consommée avant le feu vert (une validation = un appel, même si l'outil échoue ensuite :
 * `consommees` le dit). Pour des brouillons, `validations` donne la date de validation de chacun
 * et `propositions` l'id de la proposition validée (file d'envoi : relue juste avant l'envoi).
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
    const trouve = validationOutil(v.liste, nom, a, v.comptes, maintenant, valideur, ctx.grantId);
    if (!trouve) return { ok: false, texte: refusOutil(nom, a, await nomValideur(sb, ctx)) };
    let pris: Set<string>;
    try {
      pris = await consommer(sb, [trouve.id]);
    } catch (e) {
      return { ok: false, texte: `${ENTETE} Vérification impossible : ${(e as Error).message}.` };
    }
    if (!pris.has(trouve.id)) return { ok: false, texte: `${ENTETE} ${nom} : cette validation a déjà servi (un autre appel l'a utilisée). Une validation = un appel : repropose avec proposer_action.` };
    return { ok: true, consommees: 1 };
  }

  if (!besoin.ids.length) return { ok: false, texte: refusBrouillons(nom, [{ id: "?", pourquoi: "aucun id de brouillon valable" }], await nomValideur(sb, ctx)) };
  const pb = await parseMailBox(sb, a.boite);
  if ("error" in pb) return { ok: false, texte: `${ENTETE} ${pb.error}` };
  const lus = await Promise.all(besoin.ids.map(async (id) => {
    const val = validationBrouillon(v.liste, id, pb.box, v.comptes, maintenant, valideur, ctx.grantId);
    const range = val ? brouillonDe(val) : null;
    if (!val?.valide_le || !range) return { id, pourquoi: "aucune proposition validée dans la page Agents pour ce brouillon, cette boîte et cette connexion (proposer_action, type brouillon_mail)" };
    try {
      const b = await lireBrouillonComplet(sb, pb.box, id);
      if (empreinteChangee(range.empreinte, await empreinteBrouillon(b))) return { id, pourquoi: "il n'est plus celui que la page Agents a montré (modifié depuis la proposition) : à reproposer" };
      return { id, valideLe: val.valide_le, proposition: val.id, message: b.message };
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      return { id, pourquoi: /gmail_404/.test(m) ? "introuvable (déjà envoyé ou supprimé)" : `illisible (${m.slice(0, 80)})` };
    }
  }));
  const manquants = lus.filter((x): x is { id: string; pourquoi: string } => "pourquoi" in x);
  if (manquants.length) return { ok: false, texte: refusBrouillons(nom, manquants, await nomValideur(sb, ctx)) };
  const bons = lus as { id: string; valideLe: string; proposition: string; message: string }[];
  // Consommées avant l'envoi ou la mise en file : une proposition ne sert qu'une fois.
  let pris: Set<string>;
  try {
    pris = await consommer(sb, [...new Set(bons.map((x) => x.proposition))]);
  } catch (e) {
    return { ok: false, texte: `${ENTETE} Vérification impossible : ${(e as Error).message}.` };
  }
  const dejaPris = bons.filter((x) => !pris.has(x.proposition));
  if (dejaPris.length) {
    return { ok: false, texte: refusBrouillons(nom, dejaPris.map((x) => ({ id: x.id, pourquoi: "sa validation a déjà servi (un autre appel l'a utilisée)" })), await nomValideur(sb, ctx)) };
  }
  return {
    ok: true,
    consommees: pris.size,
    validations: Object.fromEntries(bons.map((x) => [x.id, x.valideLe])),
    propositions: Object.fromEntries(bons.map((x) => [x.id, x.proposition])),
    // Le message relu ici : l'envoi s'arrête si le brouillon a changé entre ce contrôle et l'envoi.
    messages: Object.fromEntries(bons.map((x) => [x.id, x.message])),
  };
}

const COLONNES = "id, type, statut, contexte, lien_spark, outil, valide_par, valide_le";
const COLONNES_SANS_LIEN = "id, type, statut, contexte, outil, valide_par, valide_le";

/**
 * File d'envoi, juste avant l'envoi : la connexion qui a programmé la ligne (envoi_file.grant_id),
 * telle qu'elle est maintenant (case « agent autonome », valideur). null : connexion introuvable.
 * « * » : la colonne valideur n'existe qu'après le SQL 2026-11-27-verrou-connexions. Lève une
 * erreur si la base ne répond pas : la file réessaie plus tard (jamais d'envoi à l'aveugle).
 */
export async function connexionDeLaFile(sb: SupabaseClient, grantId: string): Promise<ConnexionFile | null> {
  const { data, error } = await sb.from("mcp_grants").select("*").eq("id", grantId).maybeSingle<{ agent?: boolean | null; valideur?: string | null }>();
  if (error) throw new Error(`connexion illisible : ${error.message.slice(0, 120)}`);
  if (!data) return null;
  return { agent: data.agent === true, valideur: typeof data.valideur === "string" && data.valideur ? data.valideur : null };
}

/**
 * File d'envoi, juste avant l'envoi d'un brouillon programmé par un agent : la validation
 * tient-elle encore (pas retirée, pas écartée, toujours d'un compte agence, et du valideur
 * d'aujourd'hui de la connexion s'il y en a un) ? Relit la proposition gardée sur la ligne de la
 * file ; sans elle (ligne programmée avant le SQL du 27/11), les propositions de mail qui citent
 * ce brouillon. Une proposition du serveur (depuis le 28/11) garde l'empreinte du brouillon
 * montré dans la page Agents : le brouillon est relu, et une empreinte différente l'arrête.
 * Renvoie la date de la validation qui tient (le brouillon ne doit pas avoir changé depuis) et,
 * quand le brouillon a été relu, l'id de son message (l'envoi s'arrête s'il a changé), ou la
 * raison de ne pas envoyer.
 * Lève une erreur si la base ne répond pas : la file réessaie plus tard (jamais d'envoi à l'aveugle).
 */
export async function validationToujoursLa(
  sb: SupabaseClient,
  row: { brouillon: string; proposition?: string | null },
  valideur: string | null = null,
): Promise<{ ok: true; valideLe: string; message?: string } | { ok: false; raison: string }> {
  const db = sb.schema("agent").from("actions");
  const { data, error } = row.proposition
    ? await db.select(COLONNES).eq("id", row.proposition).limit(1)
    // Ligne d'avant le SQL du 27/11 : l'id cité dans contexte (jamais le lien, qui ne se lit pas).
    : await db.select(COLONNES_SANS_LIEN).eq("type", "brouillon_mail").not("valide_le", "is", null)
      .ilike("contexte", `%${row.brouillon.replace(/[%_\\]/g, (c) => `\\${c}`)}%`)
      .order("valide_le", { ascending: false }).limit(20);
  if (error) throw new Error(`validation illisible : ${error.message.slice(0, 120)}`);
  const props = (data as PropositionRelue[] | null) ?? [];
  const comptes = await comptesAgence(sb, [...new Set(props.map((p) => p.valide_par).filter((x): x is string => !!x))]);
  const tient = props.find((p) => validationTient(p, row.brouillon, comptes, valideur) === null);
  if (tient?.valide_le) {
    const range = brouillonDe(tient);
    if (range) {
      const pb = await parseMailBox(sb, range.boite);
      if ("error" in pb) return { ok: false, raison: pb.error };
      let lu: { empreinte: string; message: string };
      try {
        const b = await lireBrouillonComplet(sb, pb.box, row.brouillon);
        lu = { empreinte: await empreinteBrouillon(b), message: b.message };
      } catch (e) {
        const m = String((e as Error)?.message ?? e);
        if (/gmail_404/.test(m)) return { ok: false, raison: "brouillon introuvable (déjà envoyé ou supprimé)" };
        throw e; // Gmail ne répond pas : la file réessaie plus tard
      }
      if (empreinteChangee(range.empreinte, lu.empreinte)) return { ok: false, raison: "brouillon modifié depuis que la page Agents l'a montré (empreinte différente)" };
      return { ok: true, valideLe: tient.valide_le, message: lu.message };
    }
    return { ok: true, valideLe: tient.valide_le };
  }
  return { ok: false, raison: validationTient(props[0] ?? null, row.brouillon, comptes, valideur) ?? "validation introuvable dans la page Agents" };
}
