// ============================================================================
// _shared/ancreRebond.ts : un avis de non-remise ne compte que s'il suit un envoi réel.
// ----------------------------------------------------------------------------
// Le format d'un avis (_shared/mailRecu.ts, estAvisDeNonRemise) se recopie sans peine. Avant de
// marquer une adresse en erreur, d'arrêter une séquence ou de noter « inbox-rebond » au journal,
// la relève (gmail-poll) vérifie donc que l'agence a écrit à l'adresse citée dans les 7 jours
// avant l'avis : journal des mails envoyés (email_activity, direction « out ») ou file d'envoi
// (envoi_file, statut « envoye »). Sinon le mail est noté « inbox-douteux » et ne change rien.
// Le connecteur (ttp-mcp/envois.ts) applique la même règle aux rebonds qu'il relit au journal.
// Limite : un mail écrit directement dans Gmail (hors app et hors connecteur) n'est pas au
// journal ; son rebond ne marque donc pas l'adresse en erreur.
// Règles pures : _shared/fileEnvoi.ts (rebondAncre, rebondsAncres).
// ============================================================================

import { ANCRE_REBOND_JOURS, adresses, rebondAncre, type EnvoiRecent } from "./fileEnvoi.ts";
import { ilikeContient } from "./ilikeExact.ts";
import { adresseEnRebond } from "./sequence.ts";

// deno-lint-ignore no-explicit-any
type Sb = { from: (t: string) => any };

/**
 * Les envois de l'agence vers ces adresses (20 au plus) depuis `depuis` : journal des mails
 * envoyés et file d'envoi, adresses comparées exactement (une ligne peut en porter plusieurs).
 * null si le journal est illisible (l'appelant ne compte alors aucun rebond) ; une file
 * illisible ou absente est ignorée (ses envois sont aussi notés au journal).
 */
export async function envoisVers(sb: Sb, emails: readonly string[], depuis: string): Promise<EnvoiRecent[] | null> {
  const vises = [...new Set(emails.map((e) => String(e ?? "").trim().toLowerCase()))].filter((e) => ilikeContient(e) !== null).slice(0, 20);
  if (!vises.length) return [];
  const filtre = (col: string) => vises.map((e) => `${col}.ilike.${JSON.stringify(ilikeContient(e))}`).join(",");
  const [journal, file] = await Promise.all([
    sb.from("email_activity").select("contact_email, created_at").eq("direction", "out").gte("created_at", depuis).or(filtre("contact_email")).limit(500),
    sb.from("envoi_file").select("destinataires, envoye_at").eq("statut", "envoye").gte("envoye_at", depuis).or(filtre("destinataires")).limit(500),
  ]);
  if (journal.error) return null;
  const v = new Set(vises);
  const out: EnvoiRecent[] = [];
  for (const r of (journal.data ?? []) as Record<string, unknown>[]) {
    for (const e of adresses(r.contact_email)) if (v.has(e)) out.push({ email: e, at: String(r.created_at ?? "") });
  }
  if (!file.error) {
    for (const r of (file.data ?? []) as Record<string, unknown>[]) {
      for (const e of adresses(r.destinataires)) if (v.has(e)) out.push({ email: e, at: String(r.envoye_at ?? "") });
    }
  }
  return out;
}

/** Un mail reçu tel que la relève le classe (gmail-poll/index.ts). */
type MailClasse = { from: string; subject: string; snippet: string; failed?: string; ts: number; avis: boolean; verifie: boolean };

/**
 * Garde `avis` seulement pour un avis qui suit un envoi réel à l'adresse qu'il cite (rebondAncre) ;
 * les autres passent douteux (`avis` et `verifie` à false : rien ne change sur une fiche, le
 * journal note « inbox-douteux »). Journal illisible : aucun avis n'est gardé. Renvoie le
 * nombre d'avis écartés.
 */
export async function ancrerAvis(sb: Sb, mails: MailClasse[], agence: string): Promise<number> {
  const avis = mails.filter((m) => m.avis).map((m) => ({ m, email: adresseEnRebond(m, agence) }));
  if (!avis.length) return 0;
  const emails = avis.map((a) => a.email).filter((e): e is string => !!e);
  const plusTot = Math.min(...avis.map((a) => a.m.ts || Date.now()));
  const envois = emails.length ? await envoisVers(sb, emails, new Date(plusTot - ANCRE_REBOND_JOURS * 86_400_000).toISOString()) : [];
  let ecartes = 0;
  for (const { m, email } of avis) {
    const at = new Date(m.ts || Date.now()).toISOString();
    if (email && envois && rebondAncre({ email, at }, envois)) continue;
    m.avis = false;
    m.verifie = false;
    ecartes++;
  }
  return ecartes;
}
