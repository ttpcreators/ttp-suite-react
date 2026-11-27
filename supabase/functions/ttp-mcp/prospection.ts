// ============================================================================
// ttp-mcp/prospection.ts : la prospection automatisée (liste de Gianni du 20/11/2026).
// ----------------------------------------------------------------------------
//   1. séquence sur chaque fiche contact + outil `contacts_a_relancer` ;
//      l'étape avance toute seule quand un mail part (envoyer_mail, envoyer_brouillon,
//      envoyer_brouillons_valides, file d'envoi) ; les autres canaux : `sequence_contact` ;
//   3. une liste validée part par `programmer_envoi` (envois.ts : file étalée, plafond, 30 jours
//      par société), jamais par `envoyer_brouillons_valides` pour un lot de prospection ;
//   7. domaine vérifié avant d'envoyer (MX), adresse marquée « en erreur » sur la fiche.
// La détection des réponses et des rebonds est dans gmail-poll (sequences.ts).
// Règles : _shared/sequence.ts et _shared/mxCheck.ts. Colonnes : SQL 2026-11-20-sequences-contacts.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { AdminTool } from "./admin.ts";
import { ETAPES, aRelancer, apresMail, arreter, demarrerSequence, etapeFaite, lireEmailCheck, lireSequence, type Sequence } from "../_shared/sequence.ts";
import { verifierDomaines } from "../_shared/mxCheck.ts";

type Json = Record<string, unknown>;
const ok = (text: string) => ({ text });
const fail = (text: string) => ({ text, isError: true });
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const today = () => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const frDay = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("fr-FR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const colonneAbsente = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42703" || e.code === "PGRST204" || /sequence|email_check/.test(e.message ?? ""));
const SQL_MANQUANT = "Le suivi des séquences n'est pas encore installé (SQL 2026-11-20-sequences-contacts à lancer).";

/** Adresses d'un champ « Nom <a@b.fr>, c@d.fr ». */
export function adressesDe(v: string): string[] {
  return [...String(v ?? "").matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) => m[0].toLowerCase());
}

async function contactParEmail(sb: SupabaseClient, email: string): Promise<Json | null> {
  const { data } = await sb.from("contacts").select("*").ilike("email", email.replace(/[\\%_]/g, (c) => `\\${c}`)).limit(1);
  return ((data as Json[] | null) ?? [])[0] ?? null;
}

/**
 * Avant un envoi : refuse les adresses dont le domaine ne reçoit pas de mail, et marque
 * la fiche. Renvoie le message de refus, ou null si tout est bon (ou DNS injoignable).
 */
export async function adressesInvalides(sb: SupabaseClient, adresses: string[]): Promise<string | null> {
  const ko = await verifierDomaines(adresses);
  if (!ko.length) return null;
  const le = new Date().toISOString();
  for (const k of ko) {
    const c = await contactParEmail(sb, k.email);
    if (c) await sb.from("contacts").update({ email_check: { statut: "erreur", raison: k.raison, le } }).eq("id", c.id).then(() => {}, () => {});
  }
  return `Rien n'est parti : ${ko.map((k) => `${k.email} (${k.raison})`).join(", ")}. La fiche contact est marquée « adresse en erreur ». Chercher une autre adresse (site, LinkedIn).`;
}

/**
 * Après un envoi réussi : pour chaque destinataire qui est au carnet, l'échange est noté
 * (une fois par jour et par canal), l'adresse marquée bonne, et la séquence avance si sa
 * prochaine étape est un mail. `demarrer` : commence la séquence si le contact n'en a pas.
 * Renvoie une ligne de compte rendu ("" si personne n'est au carnet).
 */
export async function suiviApresEnvoi(sb: SupabaseClient, adresses: string[], opts: { demarrer?: boolean; createur?: string } = {}): Promise<string> {
  const now = new Date();
  const jour = today();
  const lignes: string[] = [];
  for (const email of [...new Set(adresses)]) {
    const c = await contactParEmail(sb, email);
    if (!c) continue;
    const touches = Array.isArray(c.touches) ? (c.touches as Json[]) : [];
    const patch: Json = { email_check: { statut: "ok", raison: "mail parti", le: now.toISOString() } };
    if (!touches.some((t) => String(t.date ?? "").slice(0, 10) === jour && t.canal === "email" && t.kind !== "reponse")) {
      patch.touches = [{ id: `seq${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 5)}`, date: jour, canal: "email", kind: touches.length ? "relance" : "contact", note: "Mail envoyé par l'assistant" }, ...touches];
      if (!c.last_contacted || now.toISOString() > String(c.last_contacted)) patch.last_contacted = now.toISOString();
    }
    const seq = lireSequence(c.sequence);
    let next: Sequence | null = null;
    if (seq) next = apresMail(seq, c, now);
    else if (opts.demarrer) next = demarrerSequence(c, jour, now, opts.createur);
    if (next) patch.sequence = next;
    let { error } = await sb.from("contacts").update(patch).eq("id", c.id);
    if (colonneAbsente(error)) {
      delete patch.sequence;
      delete patch.email_check;
      ({ error } = await sb.from("contacts").update(patch).eq("id", c.id));
      lignes.push(`${c.brand} : échange noté. ${SQL_MANQUANT}`);
      continue;
    }
    if (error) {
      lignes.push(`${c.brand} : suivi non noté (${error.message}).`);
      continue;
    }
    lignes.push(`${c.brand} : ${next ? (next.statut === "finie" ? "séquence terminée." : `séquence ${next.faites.join(", ")} faites, prochaine étape ${next.etape} (${next.canal}) le ${frDay(next.prochaine!)}.`) : seq ? `séquence inchangée (prochaine étape : ${seq.etape ?? "aucune"}${seq.canal && seq.canal !== "email" ? `, ${seq.canal}` : ""}).` : "échange noté (pas de séquence ; demarrer_sequence pour en commencer une)."}`);
  }
  return lignes.length ? `\nSuivi : ${lignes.join(" ")}` : "";
}

const contactsARelancer: AdminTool = {
  name: "contacts_a_relancer",
  title: "Contacts à relancer (séquences)",
  description:
    `Les contacts dont la prochaine étape de séquence est due (date ≤ aujourd'hui par défaut), triés par date. Étapes : 100 % mail (décision de Gianni du 25/11) : J0 premier mail · J+5 relance avec un nouvel angle · J+12 dernière relance ; chaque relance est écrite pour la personne, naturelle, dans le même fil, sans insister si elle a fermé la porte. Filtres : canal (email, linkedin, instagram, whatsapp), étape (J+5…), jusqu'à une date. Une adresse en erreur n'est jamais proposée pour un mail. Pour chaque contact : ce qu'il faut faire, la créatrice proposée et l'historique. Rien n'est envoyé.`,
  inputSchema: {
    type: "object",
    properties: {
      canal: { type: "string", enum: ["email", "linkedin", "instagram", "whatsapp"] },
      etape: { type: "string", enum: ETAPES.map((e) => e.etape) },
      jusqua: { type: "string", description: "AAAA-MM-JJ (défaut : aujourd'hui)" },
      limite: { type: "number", description: "Nombre maximum (défaut 30)" },
    },
    additionalProperties: false,
  },
  founder: true,
  run: async (sb, _c, a) => {
    const jusqua = /^\d{4}-\d{2}-\d{2}$/.test(str(a.jusqua)) ? str(a.jusqua) : today();
    const { data, error } = await sb.from("contacts").select("*").eq("sequence->>statut", "en_cours").lte("sequence->>prochaine", jusqua).limit(1000);
    if (colonneAbsente(error)) return fail(SQL_MANQUANT);
    if (error) return fail(`Lecture impossible : ${error.message}`);
    const limite = Math.max(1, Math.min(200, Number(a.limite) || 30));
    const rows = aRelancer((data as Json[] | null) ?? [], jusqua, { canal: str(a.canal) || undefined, etape: str(a.etape) || undefined });
    if (!rows.length) return ok(`Aucun contact à relancer jusqu'au ${frDay(jusqua)}${a.canal ? ` sur ${a.canal}` : ""}.`);
    const quoi = (e: string | null) => ETAPES.find((x) => x.etape === e)?.quoi ?? "";
    return ok([
      `# ${rows.length} contact(s) à relancer jusqu'au ${frDay(jusqua)}${rows.length > limite ? ` (les ${limite} premiers)` : ""}`,
      ...rows.slice(0, limite).map((r) => {
        const s = r.seq;
        const dernier = (Array.isArray(r.touches) ? (r.touches as Json[]) : [])[0];
        const canal = s.canal === "linkedin" ? String(r.linkedin ?? "") : s.canal === "instagram" ? String(r.instagram ?? r.ig ?? "") : s.canal === "whatsapp" ? String(r.phone ?? "") : String(r.email ?? "");
        return `- ${r.brand}${r.person ? ` (${r.person})` : ""} · id ${r.id}\n  ${s.etape} ${s.canal} prévu le ${frDay(s.prochaine!)} : ${quoi(s.etape)} · ${canal || "coordonnée manquante"}${s.createur ? ` · créatrice : ${s.createur}` : ""} · commencée le ${frDay(s.debut)}${dernier ? ` · dernier échange ${String(dernier.date ?? "").slice(0, 10)} ${dernier.canal}` : ""}`;
      }),
      "Après un message LinkedIn, Instagram ou WhatsApp envoyé à la main : sequence_contact (action etape_faite). Les mails partis par envoyer_mail ou envoyer_brouillon avancent tout seuls.",
    ].join("\n"));
  },
};

const sequenceContact: AdminTool = {
  name: "sequence_contact",
  title: "Séquence d'un contact",
  description:
    "Lit ou change la séquence de prospection d'un contact (fiche du carnet). Actions : voir ; demarrer (J0 fait aujourd'hui, ou le jour donné) ; etape_faite (la prochaine étape, ou celle donnée, ex. après une invitation LinkedIn envoyée à la main) ; arreter (retrait demandé, plus d'intérêt) ; reponse_positive ou reponse_negative (après lecture de la réponse). La séquence s'arrête toute seule à la première réponse ou à un rebond (gmail-poll).",
  inputSchema: {
    type: "object",
    properties: {
      contact: { type: "string", description: "Id du contact ou son adresse mail" },
      action: { type: "string", enum: ["voir", "demarrer", "etape_faite", "arreter", "reponse_positive", "reponse_negative"] },
      etape: { type: "string", enum: ETAPES.map((e) => e.etape) },
      date: { type: "string", description: "demarrer : AAAA-MM-JJ du J0 (défaut aujourd'hui)" },
      createur: { type: "string", description: "demarrer : créatrice proposée dans la séquence" },
      raison: { type: "string" },
    },
    required: ["contact", "action"],
    additionalProperties: false,
  },
  write: true,
  founder: true,
  run: async (sb, _c, a) => {
    const key = str(a.contact, 200);
    const isId = /^[0-9a-f-]{36}$/i.test(key);
    const c = isId ? ((await sb.from("contacts").select("*").eq("id", key).limit(1)).data as Json[] | null)?.[0] ?? null : await contactParEmail(sb, key);
    if (!c) return fail(`Aucun contact « ${key} » (id ou adresse mail).`);
    if (!("sequence" in c)) return fail(SQL_MANQUANT);
    const now = new Date();
    const seq = lireSequence(c.sequence);
    const check = lireEmailCheck(c.email_check);
    const action = str(a.action);
    const dire = (s: Sequence | null) =>
      !s ? "pas de séquence" : `${s.statut === "en_cours" ? `en cours, prochaine étape ${s.etape} (${s.canal}) le ${frDay(s.prochaine!)}` : s.statut === "finie" ? "terminée" : `arrêtée (${s.raison ?? "—"})`} · faites : ${s.faites.join(", ")} · réponse : ${s.reponse}${s.createur ? ` · créatrice : ${s.createur}` : ""}`;
    if (action === "voir") return ok(`${c.brand} : ${dire(seq)}${check ? ` · adresse ${check.statut === "erreur" ? `EN ERREUR (${check.raison})` : "bonne"}` : ""}`);
    let next: Sequence | null = null;
    if (action === "demarrer") {
      if (seq && seq.statut === "en_cours") return fail(`${c.brand} a déjà une séquence en cours : ${dire(seq)}.`);
      const jour = /^\d{4}-\d{2}-\d{2}$/.test(str(a.date)) ? str(a.date) : today();
      next = demarrerSequence(c, jour, now, str(a.createur, 80) || undefined);
    } else if (!seq) return fail(`${c.brand} n'a pas de séquence (action demarrer).`);
    else if (action === "etape_faite") next = etapeFaite(seq, c, now, str(a.etape) || undefined);
    else if (action === "arreter") next = arreter(seq, str(a.raison, 200) || "arrêtée à la main", now);
    else if (action === "reponse_positive" || action === "reponse_negative") {
      next = { ...arreter(seq, action === "reponse_positive" ? "réponse positive" : "réponse négative", now, action === "reponse_positive" ? "positive" : "negative") };
    }
    if (!next) return fail(`Rien à changer : ${dire(seq)}.`);
    const { error } = await sb.from("contacts").update({ sequence: next }).eq("id", c.id);
    if (error) return fail(`Séquence non enregistrée : ${error.message}`);
    return ok(`✓ ${c.brand} : ${dire(next)}.`);
  },
};

export const PROSPECTION_TOOLS: AdminTool[] = [contactsARelancer, sequenceContact];
