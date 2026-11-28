// ============================================================================
// gmail-poll/sequences.ts : les mails reçus pilotent les séquences de prospection
// (liste de Gianni du 20/11/2026, points 2 et 7).
//   - un contact en séquence répond, ou une adresse prospectée par la file d'envoi ces 90 jours :
//     la séquence s'arrête, la réponse est classée (intéressé, plus tard, refus, à lire :
//     _shared/reponseProspect.ts, audit du 24/11 point M23) et notée dans son journal, et une
//     tâche est créée : « Visio : [marque] » avec le lien de rendez-vous, « Recontacter » datée
//     plus tard, ou « Refus » qui propose la liste « ne plus contacter » (rien d'automatique,
//     aucun mail envoyé) ;
//   - un rebond : l'adresse est marquée « en erreur » sur la fiche et sa séquence s'arrête.
// Depuis le 28/11 (_shared/mailRecu.ts) : l'expéditeur est l'adresse réelle de l'en-tête From ;
// un rebond n'est lu que dans un vrai avis de non-remise (`avis`, classé par la relève) ; une
// réponse ne change la fiche (séquence, journal) que si son expéditeur est authentifié
// (`verifie`), sinon seule une tâche « Réponse à lire » la signale. Les recherches par adresse
// sont exactes (_shared/ilikeExact.ts : « * » refusé).
// Les réponses automatiques (absence…) ne comptent pas. Sans les colonnes (SQL pas lancé) :
// rien ne se passe. Règles : _shared/sequence.ts.
// ============================================================================

import { adresseEnRebond, arreter, estReponseAuto, lireSequence, tacheVisio } from "../_shared/sequence.ts";
import { classerReponse, noteReponse, reponseSequence, tacheReponse, textesTaches } from "../_shared/reponseProspect.ts";
import { adresseDe, estRobot, nomAffiche } from "../_shared/mailRecu.ts";
import { ilikeContient, ilikeExact, lignesExactes } from "../_shared/ilikeExact.ts";
import { lignesVers } from "../_shared/fileEnvoi.ts";

// deno-lint-ignore no-explicit-any
type Sb = { from: (t: string) => any };
/** Un mail reçu. `avis` : vrai avis de non-remise ; `verifie` : expéditeur authentifié (classés par la relève, index.ts). */
type Mail = { from: string; subject: string; snippet: string; failed?: string; ts: number; avis?: boolean; verifie?: boolean };

/** Ce que dit la tâche quand l'expéditeur d'une réponse n'est pas authentifié. */
const NON_VERIFIE = "Expéditeur non vérifié : le domaine de son adresse ne confirme pas l'envoi (DMARC, SPF ou DKIM). La séquence n'a pas été arrêtée et la fiche n'a pas été modifiée. Si c'est bien ce contact, après lecture du mail : sequence_contact (reponse_positive ou reponse_negative).";

/** La fiche contact de cette adresse exacte, ou null (adresse refusée par ilikeExact, absente, ou lecture ratée). */
async function contact(sb: Sb, email: string): Promise<Record<string, unknown> | null> {
  const motif = ilikeExact(email);
  if (!motif) return null;
  const { data, error } = await sb.from("contacts").select("*").ilike("email", motif).limit(5);
  if (error) return null;
  return lignesExactes((data ?? []) as Record<string, unknown>[], "email", email)[0] ?? null;
}

/** Dernier mail de la file de prospection (programmer_envoi) à cette adresse ces 90 derniers jours (journal email_activity), ou null. */
async function dernierEnvoiClaude(sb: Sb, email: string, now: Date): Promise<string | null> {
  const motif = ilikeExact(email);
  if (!motif) return null;
  const depuis = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const { data, error } = await sb.from("email_activity").select("created_at").eq("direction", "out").eq("source", "claude-file")
    .ilike("contact_email", motif).gte("created_at", depuis).order("created_at", { ascending: false }).limit(1);
  if (error) return null;
  return String(((data ?? []) as Record<string, unknown>[])[0]?.created_at ?? "") || null;
}

/**
 * Coupe-circuit de la file d'envoi (décision de Gianni du 27/11) : le rebond est noté sur les mails
 * partis par la file depuis 3 jours vers CETTE adresse (créateurs compris, ils ne sont pas au carnet
 * de contacts). Les lignes sont relues puis comparées adresse par adresse, et notées par id.
 */
async function noterRebondFile(sb: Sb, rebond: string, now: Date): Promise<boolean> {
  const motif = ilikeContient(rebond);
  if (!motif) return false;
  const depuis = new Date(now.getTime() - 3 * 86_400_000).toISOString();
  const { data: lignes, error } = await sb.from("envoi_file").select("id, destinataires")
    .eq("statut", "envoye").gte("envoye_at", depuis).ilike("destinataires", motif).limit(50);
  if (error) return false;
  const ids = lignesVers((lignes ?? []) as { id: string; destinataires?: unknown }[], { email: rebond }).map((l) => l.id);
  if (!ids.length) return false;
  const { data: file } = await sb.from("envoi_file").update({ erreur: `rebond : adresse refusée par le serveur (${rebond})` }).in("id", ids).select("id");
  return Array.isArray(file) && file.length > 0;
}

export async function suivreReponses(sb: Sb, mails: Mail[], domaineAgence: string): Promise<{ reponses: number; douteuses: number; rebonds: number }> {
  let reponses = 0, douteuses = 0, rebonds = 0;
  for (const m of mails) {
    const now = new Date(m.ts || Date.now());
    const jour = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    // Rebond : seulement un vrai avis de non-remise (adresseEnRebond lit l'adresse réelle du robot).
    const rebond = m.avis ? adresseEnRebond(m, domaineAgence) : null;
    if (rebond) {
      const noteFile = await noterRebondFile(sb, rebond, now);
      const c = await contact(sb, rebond);
      if (!c || !("email_check" in c)) {
        if (noteFile) rebonds++;
        continue;
      }
      const seq = lireSequence(c.sequence);
      const patch: Record<string, unknown> = { email_check: { statut: "erreur", raison: "rebond : adresse refusée par le serveur", le: now.toISOString() } };
      if (seq && seq.statut === "en_cours") patch.sequence = arreter(seq, "rebond", now);
      const { error } = await sb.from("contacts").update(patch).eq("id", c.id);
      if (!error) rebonds++;
      continue;
    }
    const from = adresseDe(m.from);
    if (m.avis || !from || estRobot(from) || from.endsWith("@" + domaineAgence) || estReponseAuto(m.subject, from, m.snippet)) continue;
    const c = await contact(sb, from);
    const seq = c && "sequence" in c ? lireSequence(c.sequence) : null;
    const enSequence = !!seq && seq.statut === "en_cours";
    // Hors carnet : le nom affiché de l'expéditeur (« Marine Audineau »), sinon l'adresse entière
    // (jamais « gmail.com », cas du 25/11 ; un nom affiché qui contient « @ » n'est pas gardé).
    const fiche = c ?? { email: from, brand: nomAffiche(m.from) || from };
    const marque = String(fiche.brand ?? "").trim() || from;
    // Hors séquence : seulement une adresse prospectée par la file d'envoi (90 jours),
    // et seulement sa première réponse : une tâche déjà créée depuis notre mail suffit.
    if (!enSequence) {
      const depuis = await dernierEnvoiClaude(sb, from, now);
      if (!depuis) continue;
      const { data: dejaTache, error: e2 } = await sb.from("todos").select("id").in("text", textesTaches(marque)).gte("created_at", depuis).limit(1);
      if (e2 || (dejaTache ?? []).length) continue;
    }
    // Expéditeur non authentifié : la fiche ne bouge pas, une tâche « Réponse à lire » le dit.
    const verifie = m.verifie === true;
    const classe = verifie ? classerReponse(m.subject, m.snippet) : "a_lire";
    if (c && verifie) {
      const touches = Array.isArray(c.touches) ? (c.touches as Record<string, unknown>[]) : [];
      const patch: Record<string, unknown> = {};
      if (enSequence && seq) patch.sequence = arreter(seq, "réponse reçue", now, reponseSequence(classe));
      if ("touches" in c && !touches.some((t) => String(t.date ?? "").slice(0, 10) === jour && t.kind === "reponse")) {
        patch.touches = [{ id: `rep${now.getTime().toString(36)}`, date: jour, canal: "email", kind: "reponse", note: noteReponse(classe, m.subject) }, ...touches];
      }
      if (Object.keys(patch).length) {
        const { error } = await sb.from("contacts").update(patch).eq("id", c.id);
        if (error) {
          console.warn("gmail-poll réponse : fiche contact refusée", c.id, error.message);
          continue;
        }
      }
    }
    if (verifie) reponses++;
    else douteuses++;
    const t = tacheReponse(classe, {
      marque, email: from, personne: String(fiche.person ?? ""),
      objet: m.subject, extrait: m.snippet, jour,
      visio: verifie && enSequence && seq ? tacheVisio(fiche, seq, m) : null,
    });
    const descr = verifie ? t.descr : `${NON_VERIFIE}\n${t.descr}`;
    const { data: deja } = await sb.from("todos").select("id").eq("text", t.text).or("done.is.null,done.eq.false").limit(1);
    if (!(deja ?? []).length) {
      await sb.from("todos").insert({ text: t.text, descr, priority: t.priority, due: t.due, done: false }).then(({ error }: { error: { message: string } | null }) => {
        if (error) console.warn("gmail-poll réponse : tâche refusée", error.message);
      }, () => {});
    }
  }
  return { reponses, douteuses, rebonds };
}
