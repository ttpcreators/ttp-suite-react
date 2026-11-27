// ============================================================================
// ttp-mcp/envois.ts : la file d'envoi des mails de prospection et la liste
// « ne plus contacter » (audit du 24 novembre 2026, points M16 à M20).
// ----------------------------------------------------------------------------
//   programmer_envoi : après le « oui » de Gianni pour une liste de brouillons, chacun reçoit
//      une heure d'envoi (heures de bureau, quelques minutes d'écart, plafond par jour) ;
//   file_envoi / annuler_envoi : voir et retirer ce qui est prévu ;
//   ne_plus_contacter : refus, demandes d'arrêt, rebonds (aucune mention dans les mails) ;
//   traiterFile : appelé chaque minute par pg_cron (route /file-envoi de index.ts, CRON_SECRET),
//      envoie au plus un mail par boîte, après les dernières vérifications ;
//   bloquant / journaliserEnvoi : aussi utilisés par envoyer_mail, envoyer_brouillon(s) et
//      creer_brouillon_mail (admin.ts, tools.ts).
// Règles pures : _shared/fileEnvoi.ts. Tables : SQL 2026-11-25-file-envoi.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { AdminTool } from "./admin.ts";
import { lireEntetesBrouillon, parseMailBox, sendDraft, type BrouillonLu, type MailBox } from "./gmail.ts";
import { verifierBrouillon } from "./kitGarde.ts";
import { adressesInvalides, suiviApresEnvoi } from "./prospection.ts";
import { instantParis } from "../_shared/rdv.ts";
import { modifieApres } from "../_shared/verrouAgent.ts";
import { colonneAuteurAbsente, idDejaJournalise, lignesEnvoi, nomAuteur, sansAuteur, sansIdGmail, type Auteur } from "../_shared/auteurEnvoi.ts";
import { couper, str, texteSur } from "../_shared/texteSur.ts";
import {
  MAX_PROGRAMMES, REGLES, adresses, cleSociete, dansLaFenetre, etatPalier, jourParis, ligneFile, planifier, quandCourt, raisonDeBloquer,
  type EnvoiRecent, type EtatPalier, type LigneFile, type NePlusContacter,
} from "../_shared/fileEnvoi.ts";
import { makePayload, sendTo } from "../_shared/push.ts";

type Json = Record<string, unknown>;
const ok = (text: string) => ({ text });
const fail = (text: string) => ({ text, isError: true });
const AGENCE = (Deno.env.get("AGENCY_MAIL_DOMAIN") ?? "ttpcreators.pro").toLowerCase();
const SQL_MANQUANT = "La file d'envoi n'est pas encore installée (SQL 2026-11-25-file-envoi à lancer).";

/** La table n'existe pas encore (SQL pas lancé). */
const tableAbsente = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|could not find the table/i.test(e.message ?? ""));

// Valeurs de filtre .or() : toujours entre guillemets (JSON.stringify), pour qu'une virgule ou
// une parenthèse dans une adresse ne casse pas le filtre ni n'y ajoute une condition.
const echappe = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** La liste « ne plus contacter » ; [] si la table n'existe pas encore. Lève une erreur si la lecture échoue. */
async function lireListe(sb: SupabaseClient): Promise<NePlusContacter[]> {
  const { data, error } = await sb.from("ne_plus_contacter").select("email, domaine, raison").limit(5000);
  if (tableAbsente(error)) return [];
  if (error) throw new Error(`liste illisible : ${error.message}`);
  return (data as NePlusContacter[] | null) ?? [];
}

/** Adresses marquées « en erreur » sur leur fiche contact. */
async function adressesEnErreur(sb: SupabaseClient, emails: string[]): Promise<string[]> {
  if (!emails.length) return [];
  const { data, error } = await sb.from("contacts").select("email, email_check").or(emails.slice(0, 20).map((e) => `email.ilike.${JSON.stringify(echappe(e))}`).join(","));
  if (error) return [];
  return ((data as Json[] | null) ?? [])
    .filter((c) => (c.email_check as Json | null)?.statut === "erreur")
    .map((c) => String(c.email ?? "").toLowerCase());
}

/** Premiers mails partis depuis `jours` jours vers les mêmes sociétés (journal des mails et file). */
async function envoisRecents(sb: SupabaseClient, emails: string[], jours: number): Promise<EnvoiRecent[]> {
  const depuis = new Date(Date.now() - jours * 86_400_000).toISOString();
  const filtres = [...new Set(emails.map(cleSociete))].slice(0, 10).map((k) => (k.includes("@") ? echappe(k) : `%@${echappe(k)}`));
  if (!filtres.length) return [];
  const [journal, file] = await Promise.all([
    sb.from("email_activity").select("contact_email, created_at").eq("direction", "out").gte("created_at", depuis).or(filtres.map((f) => `contact_email.ilike.${JSON.stringify(f)}`).join(",")).limit(200),
    sb.from("envoi_file").select("destinataires, envoye_at").eq("statut", "envoye").gte("envoye_at", depuis).or(filtres.map((f) => `destinataires.ilike.${JSON.stringify(`%${f.replace(/^%/, "")}%`)}`).join(",")).limit(200),
  ]);
  const out: EnvoiRecent[] = [];
  for (const r of (journal.data as Json[] | null) ?? []) for (const e of adresses(r.contact_email)) out.push({ email: e, at: String(r.created_at) });
  if (!tableAbsente(file.error)) for (const r of (file.data as Json[] | null) ?? []) for (const e of adresses(r.destinataires)) out.push({ email: e, at: String(r.envoye_at) });
  return out;
}

/**
 * Raison de ne pas écrire à ces adresses, ou null. `doublon` : appliquer aussi la règle
 * « pas de nouveau premier mail à la même société depuis 30 jours » (file de prospection
 * seulement : un envoi direct de Marc, une facture ou une réponse ne sont jamais bloqués par elle).
 */
export async function bloquant(sb: SupabaseClient, destinataires: string[], reponse: boolean, doublon = false): Promise<string | null> {
  if (!destinataires.length) return null;
  const [liste, enErreur, recents] = await Promise.all([
    lireListe(sb),
    adressesEnErreur(sb, destinataires),
    doublon && !reponse ? envoisRecents(sb, destinataires, REGLES.doublonJours) : Promise.resolve([] as EnvoiRecent[]),
  ]);
  return raisonDeBloquer({ destinataires, reponse: reponse || !doublon, liste, enErreur, recents, maintenant: new Date(), agence: AGENCE });
}

/** Le contrôle d'un brouillon juste avant l'envoi : liste, adresse en erreur, puis media kit. */
export function verifierAvantEnvoi(sb: SupabaseClient, createur?: string, doublon = false) {
  const kit = verifierBrouillon(sb, createur);
  return async (b: BrouillonLu): Promise<string | null> => {
    const raison = await bloquant(sb, adresses(`${b.to}, ${b.cc}`), b.reponse, doublon);
    if (raison) return `Rien n'est parti : ${raison}.`;
    return await kit(b);
  };
}

/**
 * Journal des mails envoyés par Claude (email_activity, direction « out ») : une ligne par
 * destinataire. `messageId` (id Gmail du mail parti) et `auteur` (qui de l'équipe a lancé
 * l'envoi) servent à la mention « Envoyé par » de la page Mails (_shared/auteurEnvoi.ts).
 * Base pas encore migrée ou id déjà journalisé : on réessaie sans, le journal ne se perd pas.
 */
export async function journaliserEnvoi(sb: SupabaseClient, m: { box: string; to: string; subject: string; threadId?: string; source: string; messageId?: string; auteur?: Auteur | null }): Promise<void> {
  let lignes = lignesEnvoi(adresses(m.to), { subject: m.subject, snippet: "Mail envoyé par Claude", source: m.source, threadId: m.threadId, box: m.box, messageId: m.messageId, auteur: m.auteur });
  if (!lignes.length) return;
  for (let essai = 0; essai < 3; essai++) {
    const { error } = await sb.from("email_activity").insert(lignes);
    if (!error) return;
    if (colonneAuteurAbsente(error) && lignes.some((l) => "envoye_par" in l)) lignes = sansAuteur(lignes);
    else if (idDejaJournalise(error) && lignes.some((l) => "gmail_message_id" in l)) lignes = sansIdGmail(lignes);
    else return console.error("journal des envois", error.message);
  }
}

// ── Outils ──────────────────────────────────────────────────────────────────

const programmerEnvoi: AdminTool = {
  name: "programmer_envoi",
  title: "Programmer l'envoi de brouillons validés",
  description:
    `Met dans la file d'envoi une liste de brouillons Gmail préparés par Claude (ids de creer_brouillon_mail), ${MAX_PROGRAMMES} au plus. À n'appeler qu'après le « oui » explicite de l'utilisateur pour CETTE liste d'ids. Rien ne part tout de suite : chaque mail reçoit une heure d'envoi, en semaine de 8 h 30 à 18 h 30 (heure de Paris), avec 3 à 7 minutes d'écart et ${REGLES.parJour} mails au plus par jour et par boîte. Juste avant chaque envoi, le mail est revérifié (liste « ne plus contacter », adresse en erreur, déjà un premier mail chez la même société depuis ${REGLES.doublonJours} jours, media kit) et annulé si besoin. Pour les mails de prospection ; une réponse urgente part avec envoyer_brouillon. Suivre avec file_envoi, retirer avec annuler_envoi.`,
  inputSchema: {
    type: "object",
    properties: {
      boite: { type: "string", description: "partnerships, talent, ou l'adresse d'une boîte de créateur connectée" },
      brouillons: { type: "array", items: { type: "string" }, maxItems: MAX_PROGRAMMES, description: "Ids des brouillons validés par l'utilisateur" },
      demarrer_sequence: { type: "boolean", description: "true : premiers mails de prospection, la séquence de chaque contact commence (J0) à l'envoi" },
      createur: { type: "string", description: "Facultatif : le créateur proposé, commun à toute la liste (media kit revérifié avant l'envoi)" },
      lot: { type: "string", description: "Nom court du lot (ex. « prospection 25/11 »), pour le retrouver ou l'annuler" },
    },
    required: ["boite", "brouillons"],
    additionalProperties: false,
  },
  write: true,
  founder: true,
  run: async (sb, ctx, a) => {
    const pb = await parseMailBox(sb, a.boite);
    if ("error" in pb) return fail(pb.error);
    const box: MailBox = pb.box;
    const ids = [...new Set((Array.isArray(a.brouillons) ? a.brouillons : []).map((x) => str(x, 64)).filter((x) => /^[A-Za-z0-9_-]+$/.test(x)))];
    if (!ids.length) return fail("Aucun id de brouillon valable.");
    if (ids.length > MAX_PROGRAMMES) return fail(`${MAX_PROGRAMMES} brouillons au plus par appel : coupe la liste.`);
    const probe = await sb.from("envoi_file").select("id").limit(1);
    if (tableAbsente(probe.error)) return fail(SQL_MANQUANT);
    if (probe.error) return fail(`File illisible : ${probe.error.message}`);
    const { data: dejaLa } = await sb.from("envoi_file").select("brouillon").eq("boite", String(box)).in("statut", ["en_attente", "en_cours"]).in("brouillon", ids);
    const enFile = new Set(((dejaLa as Json[] | null) ?? []).map((r) => String(r.brouillon)));

    const refus: string[] = [];
    const bons: { id: string; to: string; subject: string; reponse: boolean }[] = [];
    const societes = new Set<string>();
    for (const id of ids) {
      if (enFile.has(id)) {
        refus.push(`- ${id} : déjà dans la file`);
        continue;
      }
      try {
        const b = await lireEntetesBrouillon(sb, box, id);
        if (!b.claude) {
          refus.push(`- ${id} : pas préparé par Claude, à envoyer depuis Gmail ou l'app`);
          continue;
        }
        const dest = adresses(`${b.to}, ${b.cc}`);
        if (!dest.length) {
          refus.push(`- ${id} : aucun destinataire`);
          continue;
        }
        const raison = await bloquant(sb, dest, b.reponse, true);
        if (raison) {
          refus.push(`- ${id} (${b.to}) : ${raison}`);
          continue;
        }
        // Deux premiers mails à la même société dans le même lot : seul le premier est gardé.
        const cles = b.reponse ? [] : dest.filter((e) => e.split("@")[1] !== AGENCE).map(cleSociete);
        const doublon = cles.find((k) => societes.has(k));
        if (doublon) {
          refus.push(`- ${id} (${b.to}) : un autre brouillon de ce lot écrit déjà à ${doublon}`);
          continue;
        }
        cles.forEach((k) => societes.add(k));
        bons.push({ id, to: b.to, subject: b.subject, reponse: b.reponse });
      } catch (e) {
        const m = (e as Error).message ?? "";
        refus.push(`- ${id} : ${/gmail_404/.test(m) ? "introuvable (déjà envoyé ou supprimé)" : /not_connected|invalid_grant/.test(m) ? "boîte non connectée" : m.slice(0, 120)}`);
      }
    }
    if (!bons.length) return fail(["Rien n'a été programmé :", ...refus].join("\n"));

    const maintenant = new Date();
    const { data: prevus } = await sb.from("envoi_file").select("prevu_a, envoye_at, statut").eq("boite", String(box))
      .or(`statut.in.(en_attente,en_cours),envoye_at.gte.${new Date(maintenant.getTime() - 3 * 86_400_000).toISOString()}`).limit(500);
    const deja = ((prevus as Json[] | null) ?? []).map((r) => new Date(String(r.statut === "envoye" ? r.envoye_at : r.prevu_a))).filter((d) => Number.isFinite(d.getTime()));
    const heures = planifier(bons.length, maintenant, deja);
    const lot = str(a.lot, 60) || `lot du ${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" })}`;
    const lignes = bons.map((b, i) => ({
      boite: String(box), brouillon: b.id, destinataires: couper(b.to, 500), objet: couper(b.subject, 300), reponse: b.reponse,
      createur: str(a.createur, 80) || null, demarrer_sequence: a.demarrer_sequence === true, lot, statut: "en_attente",
      prevu_a: heures[i].toISOString(), cree_par: ctx.userId,
      // Programmé par un agent (verrou.ts) : la date de validation, revérifiée juste avant l'envoi.
      ...(ctx.agent && ctx.validations?.[b.id] ? { valide_le: ctx.validations[b.id] } : {}),
    }));
    const { error } = await sb.from("envoi_file").insert(lignes);
    if (error) return fail(`Rien n'a été programmé : ${error.message}`);
    return ok([
      `# ${bons.length} mail(s) programmé(s) · ${lot}`,
      `Premier envoi ${quandCourt(heures[0])}, dernier ${quandCourt(heures[heures.length - 1])}. Rien n'est encore parti.`,
      ...bons.map((b, i) => `- ${quandCourt(heures[i])} → ${b.to} · « ${b.subject} »`),
      refus.length ? `\nPas programmés (${refus.length}) :\n${refus.join("\n")}` : "",
      "Suivre : file_envoi. Retirer : annuler_envoi (un mail ou tout le lot).",
    ].filter(Boolean).join("\n"));
  },
};

const fileEnvoi: AdminTool = {
  name: "file_envoi",
  title: "File d'envoi des mails",
  description: "La file d'envoi des mails de prospection : ce qui est prévu, ce qui est parti, ce qui a été annulé et pourquoi, le nombre de mails partis aujourd'hui par boîte, et le coupe-circuit (contrôle des rebonds au 30e mail du jour puis tous les 10 mails, pause pour la journée au-delà de 5 %). Lecture seule.",
  inputSchema: {
    type: "object",
    properties: {
      lot: { type: "string", description: "Ne montrer qu'un lot" },
      jours: { type: "integer", minimum: 1, maximum: 30, description: "Jours d'historique (défaut 2)" },
    },
    additionalProperties: false,
  },
  founder: true,
  run: async (sb, _c, a) => {
    const jours = Math.max(1, Math.min(30, Number(a.jours) || 2));
    const depuis = new Date(Date.now() - jours * 86_400_000).toISOString();
    let q = sb.from("envoi_file").select("id, boite, destinataires, objet, statut, prevu_a, envoye_at, erreur, lot")
      .or(`statut.in.(en_attente,en_cours),prevu_a.gte.${depuis},envoye_at.gte.${depuis}`).order("prevu_a", { ascending: true }).limit(300);
    if (str(a.lot, 60)) q = q.eq("lot", str(a.lot, 60));
    const { data, error } = await q;
    if (tableAbsente(error)) return fail(SQL_MANQUANT);
    if (error) return fail(`File illisible : ${error.message}`);
    const rows = (data as LigneFile[] | null) ?? [];
    const aujourdhui = new Date(instantParis(jourParis(new Date()), "00:00")).toISOString();
    const partisAuj = new Map<string, number>();
    for (const r of rows) if (r.statut === "envoye" && r.envoye_at && r.envoye_at >= aujourdhui) partisAuj.set(r.boite, (partisAuj.get(r.boite) ?? 0) + 1);
    const palier = await etatCoupeCircuit(sb);
    const prevus = rows.filter((r) => r.statut === "en_attente" || r.statut === "en_cours");
    const autres = rows.filter((r) => r.statut !== "en_attente" && r.statut !== "en_cours").reverse();
    return ok([
      `# File d'envoi · ${prevus.length} prévu(s)`,
      palier.etat === "pause" ? `⛔ ${palier.message}` : palier.etat === "observation" ? `⏸️ ${palier.message}` : "",
      `Coupe-circuit : ${palier.envoyes} mail(s) parti(s) aujourd'hui, ${palier.rebonds} rebond(s). Contrôle au ${palier.prochain}e mail du jour (pause au-delà de 5 % de rebonds).`,
      [...partisAuj].length ? `Partis aujourd'hui : ${[...partisAuj].map(([b, n]) => `${b.includes("@") ? b : `${b}@`} ${n}/${REGLES.parJour}`).join(" · ")}.` : "Aucun mail parti aujourd'hui.",
      dansLaFenetre(new Date()) ? "" : "Hors des heures d'envoi (semaine, 8 h 30 à 18 h 30) : la file reprendra au prochain créneau.",
      ...prevus.slice(0, 60).map(ligneFile),
      autres.length ? `\nDerniers jours (${autres.length}) :` : "",
      ...autres.slice(0, 60).map(ligneFile),
    ].filter(Boolean).join("\n"));
  },
};

const annulerEnvoi: AdminTool = {
  name: "annuler_envoi",
  title: "Annuler des envois prévus",
  description: "Retire de la file d'envoi des mails pas encore partis : par numéro (les 8 caractères entre crochets donnés par file_envoi), ou tout un lot. Le brouillon reste dans Gmail. Demander l'accord avant.",
  inputSchema: {
    type: "object",
    properties: {
      envois: { type: "array", items: { type: "string" }, description: "Numéros des envois (8 caractères ou plus)" },
      lot: { type: "string", description: "Annuler tout ce lot" },
    },
    additionalProperties: false,
  },
  write: true,
  founder: true,
  run: async (sb, _c, a) => {
    const nums = (Array.isArray(a.envois) ? a.envois : []).map((x) => str(x, 40).toLowerCase()).filter((x) => /^[0-9a-f-]{8,36}$/.test(x));
    const lot = str(a.lot, 60);
    if (!nums.length && !lot) return fail("Donne des numéros d'envoi ou un lot.");
    const { data, error } = await sb.from("envoi_file").select("id, destinataires, objet, lot").eq("statut", "en_attente").limit(1000);
    if (tableAbsente(error)) return fail(SQL_MANQUANT);
    if (error) return fail(`File illisible : ${error.message}`);
    const cibles = ((data as Json[] | null) ?? []).filter((r) => (lot && r.lot === lot) || nums.some((n) => String(r.id).startsWith(n)));
    if (!cibles.length) return fail("Aucun envoi prévu ne correspond (déjà parti, déjà annulé, ou numéro inconnu).");
    const { error: e2 } = await sb.from("envoi_file").update({ statut: "annule", erreur: "annulé à la demande" }).in("id", cibles.map((r) => r.id)).eq("statut", "en_attente");
    if (e2) return fail(`Rien n'a été annulé : ${e2.message}`);
    return ok([`✓ ${cibles.length} envoi(s) retiré(s) de la file (les brouillons restent dans Gmail) :`, ...cibles.map((r) => `- ${r.destinataires} · « ${r.objet} »`)].join("\n"));
  },
};

const RAISONS = ["refus", "arret", "rebond", "autre"];
const nePlusContacter: AdminTool = {
  name: "ne_plus_contacter",
  title: "Liste « ne plus contacter »",
  description: "La liste interne des adresses et des sociétés à qui on n'écrit plus : refus, demande d'arrêt, rebond, autre. action = ajouter (email OU domaine, raison, note), retirer, ou lister. Une adresse ou un domaine de la liste bloque les brouillons et les envois de prospection (pas une réponse dans un fil existant). Rien n'est jamais écrit à la personne. Demander l'accord avant d'ajouter ou de retirer.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["ajouter", "retirer", "lister"] },
      email: { type: "string" },
      domaine: { type: "string", description: "Toute la société (ex. marque.fr)" },
      raison: { type: "string", enum: RAISONS, description: "refus, arret (demande d'arrêt), rebond, autre" },
      note: { type: "string" },
    },
    required: ["action"],
    additionalProperties: false,
  },
  write: true,
  run: async (sb, ctx, a) => {
    const action = str(a.action, 10);
    const email = str(a.email, 200).toLowerCase();
    const domaine = str(a.domaine, 200).toLowerCase().replace(/^@/, "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    if (action === "lister") {
      const { data, error } = await sb.from("ne_plus_contacter").select("email, domaine, raison, note, created_at").order("created_at", { ascending: false }).limit(200);
      if (tableAbsente(error)) return fail(SQL_MANQUANT);
      if (error) return fail(`Liste illisible : ${error.message}`);
      const rows = (data as Json[] | null) ?? [];
      return ok([`# Ne plus contacter · ${rows.length}`, ...rows.map((r) => `- ${r.email || `@${r.domaine}`} · ${r.raison}${r.note ? ` · ${r.note}` : ""}`)].join("\n"));
    }
    if (email && !/^[^@\s<>,;"']+@[^@\s<>,;"']+\.[a-z]{2,}$/.test(email)) return fail("Adresse e-mail illisible.");
    if (domaine && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domaine)) return fail("Domaine illisible (ex. marque.fr).");
    if (!email === !domaine) return fail("Donne soit une adresse e-mail, soit un domaine.");
    if (domaine === AGENCE) return fail("Le domaine de l'agence ne peut pas être dans la liste.");
    const col = email ? "email" : "domaine";
    const val = email || domaine;
    const { data: ex, error: e0 } = await sb.from("ne_plus_contacter").select("id").ilike(col, echappe(val)).limit(1);
    if (tableAbsente(e0)) return fail(SQL_MANQUANT);
    if (e0) return fail(`Liste illisible : ${e0.message}`);
    if (action === "retirer") {
      if (!(ex as Json[] | null)?.length) return fail(`${val} n'est pas dans la liste.`);
      const { error } = await sb.from("ne_plus_contacter").delete().ilike(col, echappe(val));
      return error ? fail(`Rien n'a été retiré : ${error.message}`) : ok(`✓ ${val} retiré de la liste « ne plus contacter ».`);
    }
    if (action !== "ajouter") return fail("action : ajouter, retirer ou lister.");
    if ((ex as Json[] | null)?.length) return ok(`${val} est déjà dans la liste.`);
    const raison = RAISONS.includes(str(a.raison, 10)) ? str(a.raison, 10) : "autre";
    const { error } = await sb.from("ne_plus_contacter").insert({ [col]: val, raison, note: str(a.note, 300) || null, source: "claude", cree_par: ctx.userId });
    if (error) return fail(`Rien n'a été ajouté : ${error.message}`);
    // Les envois prévus vers cette adresse ou ce domaine sont retirés de la file tout de suite.
    const motif = `${email ? `%${echappe(email)}%` : `%@${echappe(domaine)}%`}`;
    const { data: retires } = await sb.from("envoi_file").update({ statut: "annule", erreur: `ne plus contacter (${raison})` }).eq("statut", "en_attente").ilike("destinataires", motif).select("id");
    const n = ((retires as Json[] | null) ?? []).length;
    return ok(`✓ ${val} ajouté à la liste « ne plus contacter » (${raison}).${n ? ` ${n} envoi(s) prévu(s) retiré(s) de la file.` : ""}`);
  },
};

export const ENVOI_TOOLS: AdminTool[] = [programmerEnvoi, fileEnvoi, annulerEnvoi, nePlusContacter];

// ── Traitement de la file (pg_cron, chaque minute) ─────────────────────────────

/**
 * Coupe-circuit par paliers (décision de Gianni du 27/11, règle dans _shared/fileEnvoi.ts) :
 * mails partis par la file aujourd'hui (heure de Paris, les deux boîtes : même nom de domaine)
 * et rebonds reçus pour ces mails. Un rebond est noté sur la ligne de la file par gmail-poll
 * (erreur « rebond : … »), créateurs compris ; on garde aussi les adresses du carnet marquées
 * en erreur aujourd'hui, au cas où gmail-poll tourne encore dans son ancienne version.
 */
async function etatCoupeCircuit(sb: SupabaseClient, now = new Date()): Promise<EtatPalier & { envoyes: number; rebonds: number }> {
  const debutJour = new Date(instantParis(jourParis(now), "00:00")).toISOString();
  const { data, error } = await sb.from("envoi_file").select("destinataires, envoye_at, erreur, statut")
    .or(`and(statut.eq.envoye,envoye_at.gte.${debutJour}),statut.eq.en_cours`).limit(500);
  const rows = error ? [] : ((data as Json[] | null) ?? []);
  const partis = rows.filter((r) => r.statut === "envoye");
  const emails = [...new Set(partis.flatMap((r) => adresses(r.destinataires)))];
  const enRebond = new Set<string>();
  for (const r of partis) if (/^rebond/i.test(String(r.erreur ?? ""))) for (const e of adresses(r.destinataires)) enRebond.add(e);
  if (emails.length) {
    const { data: err } = await sb.from("contacts").select("email").eq("email_check->>statut", "erreur").gte("email_check->>le", debutJour).limit(500);
    for (const c of ((err as Json[] | null) ?? [])) {
      const e = String(c.email ?? "").toLowerCase();
      if (emails.includes(e)) enRebond.add(e);
    }
  }
  const rebonds = partis.filter((r) => adresses(r.destinataires).some((e) => enRebond.has(e))).length;
  const dernier = partis.reduce((m, r) => Math.max(m, Date.parse(String(r.envoye_at ?? "")) || 0), 0);
  const minutes = dernier ? (now.getTime() - dernier) / 60_000 : Infinity;
  // Un envoi « en cours » compte déjà : il partira avant le contrôle.
  const envoyes = partis.length + rows.filter((r) => r.statut === "en_cours").length;
  return { ...etatPalier(envoyes, rebonds, minutes), envoyes, rebonds };
}

/** Pause : la note sur les mails en attente, et une seule alerte (push) aux fondateurs par pause. */
async function signalerPause(sb: SupabaseClient, message: string): Promise<void> {
  const jour = jourParis(new Date());
  const note = `en pause le ${jour} : ${message}`.slice(0, 300);
  const { data } = await sb.from("envoi_file").update({ erreur: note }).eq("statut", "en_attente")
    .or(`erreur.is.null,erreur.not.ilike.en pause le ${jour}*`).select("id");
  if (!(data as Json[] | null)?.length) return;
  await sendTo(sb, { agency: true, audience: "founders" }, makePayload({
    kind: "team", title: "Envois de prospection en pause", body: message, url: "/", tag: `ttp-coupe-circuit-${jour}`,
  })).catch(() => undefined);
}

type Ligne = { id: string; boite: string; brouillon: string; destinataires: string; objet: string; createur: string | null; demarrer_sequence: boolean; essais: number; prevu_a: string; cree_par?: string | null; valide_le?: string | null };

/** Un envoi de la file : vérifications, envoi, suivi. Renvoie ce qui s'est passé. */
async function envoyerUne(sb: SupabaseClient, row: Ligne): Promise<string> {
  const fin = async (statut: string, patch: Json = {}) => {
    // Les messages d'erreur sont coupés avec slice plus bas : nettoyés ici une fois pour toutes.
    const p = typeof patch.erreur === "string" ? { ...patch, erreur: texteSur(patch.erreur) } : patch;
    const { error } = await sb.from("envoi_file").update({ statut, ...p }).eq("id", row.id);
    if (error) console.warn("ttp-mcp envoi_file : statut refusé", row.id.slice(0, 8), statut, error.message);
    return `${row.id.slice(0, 8)} ${statut}${p.erreur ? ` : ${p.erreur}` : ""}`;
  };
  const pb = await parseMailBox(sb, row.boite);
  if ("error" in pb) return await fin("annule", { erreur: pb.error.slice(0, 300) });
  const box = pb.box;
  try {
    // Dernières vérifications : adresses du brouillon tel qu'il est maintenant (Gianni a pu le retoucher).
    const b = await lireEntetesBrouillon(sb, box, row.brouillon);
    if (!b.claude) return await fin("annule", { erreur: "le brouillon n'est plus marqué « préparé par Claude »" });
    // Programmé par un agent : un brouillon changé depuis sa validation dans la page Agents ne part pas.
    if (row.valide_le && modifieApres(b.date, row.valide_le)) return await fin("annule", { erreur: "brouillon modifié après sa validation dans la page Agents" });
    const dest = adresses(`${b.to}, ${b.cc}`);
    const raison = await bloquant(sb, dest, b.reponse, true);
    if (raison) return await fin("annule", { erreur: raison.slice(0, 300) });
    const invalide = await adressesInvalides(sb, dest);
    if (invalide) return await fin("annule", { erreur: invalide.slice(0, 300) });
    const r = await sendDraft(sb, box, row.brouillon, undefined, verifierAvantEnvoi(sb, row.createur || undefined, true));
    // Le mail est parti : le statut « envoyé » doit être écrit, même si les textes relus chez
    // Gmail sont refusés (sinon la ligne finirait en « échec » et le mail pourrait repartir).
    const envoyeAt = new Date().toISOString();
    const { error: majErr } = await sb.from("envoi_file").update({ statut: "envoye", envoye_at: envoyeAt, destinataires: couper(r.to, 500), objet: couper(r.subject, 300), erreur: null }).eq("id", row.id);
    if (majErr) {
      console.warn("ttp-mcp envoi_file : ligne envoyée refusée", row.id.slice(0, 8), majErr.message);
      const { error: e2 } = await sb.from("envoi_file").update({ statut: "envoye", envoye_at: envoyeAt, erreur: null }).eq("id", row.id);
      if (e2) console.warn("ttp-mcp envoi_file : statut envoyé refusé", row.id.slice(0, 8), e2.message);
    }
    // Auteur : la personne qui a programmé l'envoi (après son « oui »).
    await journaliserEnvoi(sb, { box: String(box), to: r.to, subject: r.subject, threadId: r.threadId, source: "claude-file", messageId: r.id, auteur: await nomAuteur(sb, row.cree_par) });
    await suiviApresEnvoi(sb, adresses(r.to), { demarrer: row.demarrer_sequence, createur: row.createur || undefined }).catch(() => "");
    return `${row.id.slice(0, 8)} envoyé`;
  } catch (e) {
    const m = (e as Error).message ?? "";
    if (/gmail_404/.test(m)) return await fin("annule", { erreur: "brouillon introuvable (envoyé ou supprimé à la main)" });
    if (m === "not_claude") return await fin("annule", { erreur: "brouillon pas préparé par Claude" });
    if (m.startsWith("kit_refuse: ")) return await fin("annule", { erreur: m.slice(12).replace(/\n/g, " ").slice(0, 300) });
    // Erreur passagère (réseau, Gmail) : nouvel essai dans 15 minutes, 3 essais au plus.
    if (row.essais < 3) return await fin("en_attente", { erreur: `nouvel essai : ${m.slice(0, 200)}`, prevu_a: new Date(Date.now() + 15 * 60_000).toISOString() });
    return await fin("echec", { erreur: m.slice(0, 300) });
  }
}

/** Un passage de la file : au plus un mail par boîte, s'il est l'heure, sous le plafond, après l'écart. */
export async function traiterFile(sb: SupabaseClient): Promise<Json> {
  const now = new Date();
  // Un envoi resté « en cours » plus de 10 minutes (fonction coupée) : on ne le renvoie jamais
  // à l'aveugle, il a pu partir. À vérifier dans les Envoyés de Gmail.
  const { error: e0 } = await sb.from("envoi_file").update({ statut: "echec", erreur: "envoi interrompu : regarder dans les Envoyés de Gmail avant de le refaire" })
    .eq("statut", "en_cours").lt("essai_at", new Date(now.getTime() - 10 * 60_000).toISOString());
  if (tableAbsente(e0)) return { ok: false, raison: "sql_manquant" };
  if (!dansLaFenetre(now)) return { ok: true, fenetre: false };
  const palier = await etatCoupeCircuit(sb, now);
  if (palier.etat === "pause") {
    await signalerPause(sb, palier.message ?? "trop de rebonds aujourd'hui");
    return { ok: true, pause: palier.message };
  }
  if (palier.etat === "observation") return { ok: true, observation: palier.message };
  let restant = palier.restant;
  // « * » : la colonne valide_le n'existe qu'après le SQL 2026-11-27-securite-alfred.
  const { data, error } = await sb.from("envoi_file").select("*")
    .eq("statut", "en_attente").lte("prevu_a", now.toISOString()).order("prevu_a", { ascending: true }).limit(50);
  if (error) return { ok: false, raison: error.message };
  const dus = (data as Ligne[] | null) ?? [];
  if (!dus.length) return { ok: true, envoyes: 0 };
  const debutJour = new Date(instantParis(jourParis(now), "00:00")).toISOString();
  const faits: string[] = [];
  for (const boite of [...new Set(dus.map((r) => r.boite))]) {
    // Jamais au-delà du prochain palier contrôlé, même avec deux boîtes dans le même passage.
    if (restant <= 0) break;
    const { data: auj } = await sb.from("envoi_file").select("envoye_at").eq("boite", boite).eq("statut", "envoye").gte("envoye_at", debutJour).order("envoye_at", { ascending: false }).limit(REGLES.parJour + 1);
    const partis = (auj as Json[] | null) ?? [];
    if (partis.length >= REGLES.parJour) continue;
    const dernier = partis[0] ? Date.parse(String(partis[0].envoye_at)) : 0;
    if (dernier && now.getTime() - dernier < REGLES.ecartMin * 60_000) continue;
    const row = dus.find((r) => r.boite === boite)!;
    // On prend la ligne : si un autre passage l'a déjà prise, on n'y touche pas.
    const { data: pris } = await sb.from("envoi_file").update({ statut: "en_cours", essais: row.essais + 1, essai_at: now.toISOString() })
      .eq("id", row.id).eq("statut", "en_attente").select("id");
    if (!(pris as Json[] | null)?.length) continue;
    restant--;
    faits.push(await envoyerUne(sb, { ...row, essais: row.essais + 1 }));
  }
  return { ok: true, faits };
}
