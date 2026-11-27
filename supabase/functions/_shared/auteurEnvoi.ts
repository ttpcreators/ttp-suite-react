// ============================================================================
// _shared/auteurEnvoi.ts : qui de l'équipe a envoyé un mail (« Envoyé par »).
// ----------------------------------------------------------------------------
// Demande de Gianni du 25/11 : Marc et Gianni envoient depuis les mêmes boîtes, au nom de
// Marc. Chaque envoi fait par l'app (gmail-send) ou par Claude (ttp-mcp, file d'envoi) note
// dans email_activity le compte qui l'a envoyé (envoye_par) et son nom (envoye_par_nom).
// Règles PURES ici (testées par auteurEnvoi.test.ts) ; la lecture du nom est dans nomAuteur.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { couper, texteSur } from "./texteSur.ts";

export type Auteur = { id: string; nom: string };

/** Nom affiché d'un compte : son prénom réglé dans l'app, sinon le début de son adresse. */
export function nomAffiche(displayName: unknown, email: unknown): string {
  const dn = String(displayName ?? "").trim();
  if (dn) return couper(dn, 40);
  const local = String(email ?? "").split("@")[0].trim();
  return couper(local || "Agence", 40);
}

/**
 * Colonnes envoye_par absentes (SQL du 25/11 pas encore lancé) : l'envoi est journalisé sans
 * auteur plutôt que pas du tout. PostgREST : PGRST204 ; Postgres : 42703.
 */
export function colonneAuteurAbsente(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === "PGRST204" || e.code === "42703" || /envoye_par/.test(String(e.message ?? ""));
}

/** Id Gmail déjà journalisé (index unique sur gmail_message_id) : on réessaie sans l'id. */
export function idDejaJournalise(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === "23505" || /gmail_msg_uidx|duplicate key/i.test(String(e.message ?? ""));
}

/**
 * Lignes du journal d'un envoi : une par destinataire. L'id du message Gmail ne va que sur la
 * première ligne (il est unique dans la table) ; l'auteur va sur toutes.
 */
export function lignesEnvoi(
  destinataires: string[],
  m: { subject: string; snippet: string; source: string; threadId?: string | null; box?: string | null; messageId?: string | null; auteur?: Auteur | null },
): Record<string, unknown>[] {
  return destinataires.map((e, i) => ({
    contact_email: e,
    direction: "out",
    subject: couper(m.subject, 300), // textes coupés sans casser d'emoji (_shared/texteSur.ts)
    snippet: texteSur(m.snippet),
    source: m.source,
    thread_id: m.threadId || null,
    ...(m.box ? { box: m.box } : {}),
    ...(i === 0 && m.messageId ? { gmail_message_id: m.messageId } : {}),
    ...(m.auteur?.id ? { envoye_par: m.auteur.id, envoye_par_nom: couper(m.auteur.nom, 40) } : {}),
  }));
}

/** Retire l'auteur des lignes (colonnes pas encore créées). */
export const sansAuteur = (rows: Record<string, unknown>[]) =>
  rows.map(({ envoye_par: _a, envoye_par_nom: _b, ...r }) => r);

/** Retire l'id Gmail des lignes (déjà journalisé ailleurs). */
export const sansIdGmail = (rows: Record<string, unknown>[]) =>
  rows.map(({ gmail_message_id: _g, ...r }) => r);

/** L'auteur d'un envoi à partir de son compte (null si inconnu). Ne lève jamais. */
export async function nomAuteur(sb: SupabaseClient, userId: string | null | undefined): Promise<Auteur | null> {
  if (!userId) return null;
  try {
    const { data } = await sb.from("profiles").select("display_name").eq("user_id", userId).maybeSingle();
    const dn = (data as { display_name?: string | null } | null)?.display_name;
    if (String(dn ?? "").trim()) return { id: userId, nom: nomAffiche(dn, "") };
    const { data: u } = await sb.auth.admin.getUserById(userId);
    return { id: userId, nom: nomAffiche("", u?.user?.email ?? "") };
  } catch {
    return { id: userId, nom: "Agence" };
  }
}
