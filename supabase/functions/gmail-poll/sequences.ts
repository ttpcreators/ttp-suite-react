// ============================================================================
// gmail-poll/sequences.ts : les mails reçus pilotent les séquences de prospection
// (liste de Gianni du 20/11/2026, points 2 et 7).
//   - un contact en séquence répond, ou une adresse prospectée par la file d'envoi ces 90 jours :
//     la séquence s'arrête, la réponse est classée (intéressé, plus tard, refus, à lire :
//     _shared/reponseProspect.ts, audit du 24/11 point M23) et notée dans son journal, et une
//     tâche est créée : « Visio : [marque] » avec le lien de rendez-vous, « Recontacter » datée
//     plus tard, ou « Refus » qui propose la liste « ne plus contacter » (rien d'automatique,
//     aucun mail envoyé) ;
//   - un rebond (mailer-daemon) : l'adresse est marquée « en erreur » sur la fiche et sa
//     séquence s'arrête.
// Les réponses automatiques (absence…) ne comptent pas. Sans les colonnes (SQL pas lancé) :
// rien ne se passe. Règles : _shared/sequence.ts.
// ============================================================================

import { adresseEnRebond, arreter, estReponseAuto, lireSequence, tacheVisio } from "../_shared/sequence.ts";
import { classerReponse, noteReponse, reponseSequence, tacheReponse, textesTaches } from "../_shared/reponseProspect.ts";

// deno-lint-ignore no-explicit-any
type Sb = { from: (t: string) => any };
type Mail = { from: string; subject: string; snippet: string; failed?: string; ts: number };

const emailDe = (from: string) => ((/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase());
const echappe = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

async function contact(sb: Sb, email: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await sb.from("contacts").select("*").ilike("email", echappe(email)).limit(1);
  if (error) return null;
  return ((data ?? []) as Record<string, unknown>[])[0] ?? null;
}

/** Dernier mail de la file de prospection (programmer_envoi) à cette adresse ces 90 derniers jours (journal email_activity), ou null. */
async function dernierEnvoiClaude(sb: Sb, email: string, now: Date): Promise<string | null> {
  const depuis = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const { data, error } = await sb.from("email_activity").select("created_at").eq("direction", "out").eq("source", "claude-file")
    .ilike("contact_email", echappe(email)).gte("created_at", depuis).order("created_at", { ascending: false }).limit(1);
  if (error) return null;
  return String(((data ?? []) as Record<string, unknown>[])[0]?.created_at ?? "") || null;
}

export async function suivreReponses(sb: Sb, mails: Mail[], domaineAgence: string): Promise<{ reponses: number; rebonds: number }> {
  let reponses = 0, rebonds = 0;
  for (const m of mails) {
    const now = new Date(m.ts || Date.now());
    const jour = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const rebond = adresseEnRebond(m, domaineAgence);
    if (rebond) {
      const c = await contact(sb, rebond);
      if (!c || !("email_check" in c)) continue;
      const seq = lireSequence(c.sequence);
      const patch: Record<string, unknown> = { email_check: { statut: "erreur", raison: "rebond : adresse refusée par le serveur", le: now.toISOString() } };
      if (seq && seq.statut === "en_cours") patch.sequence = arreter(seq, "rebond", now);
      const { error } = await sb.from("contacts").update(patch).eq("id", c.id);
      if (!error) rebonds++;
      continue;
    }
    const from = emailDe(m.from);
    if (!from || from.endsWith("@" + domaineAgence) || estReponseAuto(m.subject, from)) continue;
    const c = await contact(sb, from);
    const seq = c && "sequence" in c ? lireSequence(c.sequence) : null;
    const enSequence = !!seq && seq.statut === "en_cours";
    const fiche = c ?? { email: from, brand: from.split("@")[1] ?? from };
    const marque = String(fiche.brand ?? "").trim() || from;
    // Hors séquence : seulement une adresse prospectée par la file d'envoi (90 jours),
    // et seulement sa première réponse : une tâche déjà créée depuis notre mail suffit.
    if (!enSequence) {
      const depuis = await dernierEnvoiClaude(sb, from, now);
      if (!depuis) continue;
      const { data: dejaTache, error: e2 } = await sb.from("todos").select("id").in("text", textesTaches(marque)).gte("created_at", depuis).limit(1);
      if (e2 || (dejaTache ?? []).length) continue;
    }
    const classe = classerReponse(m.subject, m.snippet);
    if (c) {
      const touches = Array.isArray(c.touches) ? (c.touches as Record<string, unknown>[]) : [];
      const patch: Record<string, unknown> = {};
      if (enSequence && seq) patch.sequence = arreter(seq, "réponse reçue", now, reponseSequence(classe));
      if ("touches" in c && !touches.some((t) => String(t.date ?? "").slice(0, 10) === jour && t.kind === "reponse")) {
        patch.touches = [{ id: `rep${now.getTime().toString(36)}`, date: jour, canal: "email", kind: "reponse", note: noteReponse(classe, m.subject) }, ...touches];
      }
      if (Object.keys(patch).length) {
        const { error } = await sb.from("contacts").update(patch).eq("id", c.id);
        if (error) continue;
      }
    }
    reponses++;
    const t = tacheReponse(classe, {
      marque, email: from, personne: String(fiche.person ?? ""),
      objet: m.subject, extrait: m.snippet, jour,
      visio: enSequence && seq ? tacheVisio(fiche, seq, m) : null,
    });
    const { data: deja } = await sb.from("todos").select("id").eq("text", t.text).or("done.is.null,done.eq.false").limit(1);
    if (!(deja ?? []).length) {
      await sb.from("todos").insert({ text: t.text, descr: t.descr, priority: t.priority, due: t.due, done: false }).then(() => {}, () => {});
    }
  }
  return { reponses, rebonds };
}
