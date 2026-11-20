// ============================================================================
// gmail-poll/sequences.ts : les mails reçus pilotent les séquences de prospection
// (liste de Gianni du 20/11/2026, points 2 et 7).
//   - un contact en séquence répond : la séquence s'arrête (« a répondu »), la réponse est
//     notée dans son journal, et une tâche « Visio : [marque] » est créée pour Marc avec la
//     fiche avant l'appel ;
//   - un rebond (mailer-daemon) : l'adresse est marquée « en erreur » sur la fiche et sa
//     séquence s'arrête.
// Les réponses automatiques (absence…) ne comptent pas. Sans les colonnes (SQL pas lancé) :
// rien ne se passe. Règles : _shared/sequence.ts.
// ============================================================================

import { adresseEnRebond, arreter, estReponseAuto, lireSequence, tacheVisio } from "../_shared/sequence.ts";

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
    if (!c || !("sequence" in c)) continue;
    const seq = lireSequence(c.sequence);
    if (!seq || seq.statut !== "en_cours") continue;
    const touches = Array.isArray(c.touches) ? (c.touches as Record<string, unknown>[]) : [];
    const patch: Record<string, unknown> = { sequence: arreter(seq, "réponse reçue", now, "a_repondu") };
    if (!touches.some((t) => String(t.date ?? "").slice(0, 10) === jour && t.kind === "reponse")) {
      patch.touches = [{ id: `rep${now.getTime().toString(36)}`, date: jour, canal: "email", kind: "reponse", note: `Réponse : ${m.subject.slice(0, 120)}` }, ...touches];
    }
    const { error } = await sb.from("contacts").update(patch).eq("id", c.id);
    if (error) continue;
    reponses++;
    const t = tacheVisio(c, seq, m);
    const { data: deja } = await sb.from("todos").select("id").eq("text", t.text).or("done.is.null,done.eq.false").limit(1);
    if (!(deja ?? []).length) {
      await sb.from("todos").insert({ text: t.text, descr: t.descr, priority: "haute", due: jour, done: false }).then(() => {}, () => {});
    }
  }
  return { reponses, rebonds };
}
