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
// Depuis le 27/11 (enquête du 27/11 sur la file d'envoi) : les rebonds sont aussi lus dans le
// journal des mails reçus, pour les adresses sans fiche contact (coupe-circuit et contrôle d'avant
// envoi), et un brouillon programmé par un agent ne part que si sa validation tient encore
// (verrou.ts). Chaque ligne garde la connexion qui l'a programmée, relue avant l'envoi : cochée
// « agent autonome » depuis, une ligne sans validation ne part pas.
// Règles pures : _shared/fileEnvoi.ts. Tables : SQL 2026-11-25-file-envoi, puis
// 2026-11-27-verrou-connexions (envoi_file.proposition et grant_id).
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { AdminTool } from "./admin.ts";
import { lireEntetesBrouillon, parseMailBox, sendDraft, type BrouillonLu, type MailBox } from "./gmail.ts";
import { verifierBrouillon } from "./kitGarde.ts";
import { adressesInvalides, suiviApresEnvoi } from "./prospection.ts";
import { connexionDeLaFile, validationToujoursLa } from "./verrou.ts";
import { instantParis } from "../_shared/rdv.ts";
import { modifieApres, raisonConnexionFile } from "../_shared/verrouAgent.ts";
import { colonneAuteurAbsente, idDejaJournalise, lignesEnvoi, nomAuteur, sansAuteur, sansIdGmail, type Auteur } from "../_shared/auteurEnvoi.ts";
import { couper, str, texteSur } from "../_shared/texteSur.ts";
import {
  MAX_PROGRAMMES, REGLES, adresses, cleSociete, coupeCircuit, dansLaFenetre, journalDesAdresses, jourParis, ligneFile, planifier, quandCourt, raisonDeBloquer, rebondsDuJournal,
  rebondsQuiComptent, texteListe, type EnvoiRecent, type FicheVerifiee, type LigneFile, type MailRecu, type NePlusContacter,
} from "../_shared/fileEnvoi.ts";

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

/**
 * Les fiches contact de ces adresses : celles marquées « en erreur », et la date de la dernière
 * vérification de chaque adresse (email_check.le). Lecture ratée : rien (comme avant).
 */
async function fichesDes(sb: SupabaseClient, emails: string[]): Promise<{ enErreur: string[]; verifiees: FicheVerifiee[] }> {
  if (!emails.length) return { enErreur: [], verifiees: [] };
  const { data, error } = await sb.from("contacts").select("email, email_check").or(emails.slice(0, 20).map((e) => `email.ilike.${JSON.stringify(echappe(e))}`).join(","));
  if (error) return { enErreur: [], verifiees: [] };
  const fiches = (data as Json[] | null) ?? [];
  return {
    enErreur: fiches.filter((c) => (c.email_check as Json | null)?.statut === "erreur").map((c) => String(c.email ?? "").toLowerCase()),
    verifiees: fiches.map((c) => ({ email: String(c.email ?? ""), le: typeof (c.email_check as Json | null)?.le === "string" ? String((c.email_check as Json).le) : null })),
  };
}

/**
 * Coupe-circuit : tous les rebonds lus dans le journal des mails reçus depuis `depuis` (message
 * d'un robot qui cite l'adresse refusée), surtout utiles pour les adresses sans fiche contact, que
 * gmail-poll ne peut pas marquer. [] si la lecture échoue, noté dans les journaux de la fonction
 * (le coupe-circuit garde alors les fiches en erreur).
 */
async function rebondsLus(sb: SupabaseClient, depuis: string): Promise<EnvoiRecent[]> {
  const robots = ["%mailer-daemon%", "%postmaster%"].map((m) => `contact_email.ilike.${JSON.stringify(m)}`).concat(`contact_name.ilike.${JSON.stringify("%mail delivery%")}`);
  const { data, error } = await sb.from("email_activity").select("contact_email, contact_name, subject, snippet, created_at")
    .eq("direction", "in").gte("created_at", depuis).or(robots.join(",")).order("created_at", { ascending: false }).limit(300);
  if (error) {
    console.warn("ttp-mcp coupe-circuit : rebonds du journal illisibles", error.message);
    return [];
  }
  return rebondsDuJournal((data as MailRecu[] | null) ?? [], AGENCE);
}

/**
 * Contrôle d'avant envoi : ce que le journal des mails reçus dit de ces adresses depuis `depuis`,
 * leurs rebonds (robot qui cite l'adresse) et les mails venus d'elles (elle marche). La requête ne
 * vise que ces adresses (20 au plus) : la limite ne coupe jamais un vieux rebond. Lecture ratée :
 * rien, noté dans les journaux de la fonction (le contrôle garde ses autres règles).
 */
async function journalDes(sb: SupabaseClient, emails: string[], depuis: string): Promise<{ rebonds: EnvoiRecent[]; recus: EnvoiRecent[] }> {
  const vises = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  if (!vises.length) return { rebonds: [], recus: [] };
  const filtres = vises.flatMap((e) => [`snippet.ilike.${JSON.stringify(`%${echappe(e)}%`)}`, `contact_email.ilike.${JSON.stringify(echappe(e))}`]);
  const { data, error } = await sb.from("email_activity").select("contact_email, contact_name, subject, snippet, created_at")
    .eq("direction", "in").gte("created_at", depuis).or(filtres.join(",")).order("created_at", { ascending: false }).limit(300);
  if (error) {
    console.warn("ttp-mcp contrôle d'envoi : journal des mails illisible, rebonds non vérifiés", error.message);
    return { rebonds: [], recus: [] };
  }
  return journalDesAdresses((data as MailRecu[] | null) ?? [], vises, AGENCE);
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
 * Une adresse qui a renvoyé un rebond ces 90 jours (journal des mails) est bloquée comme une
 * adresse en erreur, même sans fiche contact, tant qu'elle n'a pas donné signe de vie depuis : un
 * mail reçu d'elle, ou sa fiche revérifiée (rebondsQuiComptent). Le refus dit comment en sortir.
 */
export async function bloquant(sb: SupabaseClient, destinataires: string[], reponse: boolean, doublon = false): Promise<string | null> {
  if (!destinataires.length) return null;
  const externes = destinataires.map((e) => e.toLowerCase()).filter((e) => e.split("@")[1] !== AGENCE);
  const [liste, fiches, recents, journal] = await Promise.all([
    lireListe(sb),
    fichesDes(sb, destinataires),
    doublon && !reponse ? envoisRecents(sb, destinataires, REGLES.doublonJours) : Promise.resolve([] as EnvoiRecent[]),
    externes.length ? journalDes(sb, externes, new Date(Date.now() - REGLES.rebondJours * 86_400_000).toISOString()) : Promise.resolve({ rebonds: [], recus: [] }),
  ]);
  const rebonds = rebondsQuiComptent(journal.rebonds, fiches.verifiees, journal.recus);
  return raisonDeBloquer({ destinataires, reponse, doublon, liste, enErreur: fiches.enErreur, rebonds, recents, maintenant: new Date(), agence: AGENCE });
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
    const lignes: Json[] = bons.map((b, i) => ({
      boite: String(box), brouillon: b.id, destinataires: couper(b.to, 500), objet: couper(b.subject, 300), reponse: b.reponse,
      createur: str(a.createur, 80) || null, demarrer_sequence: a.demarrer_sequence === true, lot, statut: "en_attente",
      prevu_a: heures[i].toISOString(), cree_par: ctx.userId,
      // La connexion qui programme, relue juste avant l'envoi (cochée « agent autonome » depuis :
      // une ligne sans validation ne part pas ; valideur choisi depuis : seule sa validation compte).
      grant_id: ctx.grantId,
      // Programmé par un agent (verrou.ts) : la date de validation et la proposition validée,
      // relues juste avant l'envoi (validation retirée ou écartée entre-temps : rien ne part).
      ...(ctx.agent && ctx.validations?.[b.id] ? { valide_le: ctx.validations[b.id] } : {}),
      ...(ctx.agent && ctx.propositions?.[b.id] ? { proposition: ctx.propositions[b.id] } : {}),
    }));
    let { error } = await sb.from("envoi_file").insert(lignes);
    // Avant le SQL 2026-11-27-verrou-connexions (colonnes proposition et grant_id absentes) : sans
    // elles, la file relira les propositions qui citent le brouillon, et la connexion ne sera pas relue.
    const NOUVELLES = ["proposition", "grant_id"];
    if (error && NOUVELLES.some((k) => (error?.message ?? "").includes(k)) && (error.code === "42703" || error.code === "PGRST204" || /column/i.test(error.message ?? ""))) {
      ({ error } = await sb.from("envoi_file").insert(lignes.map((l) => Object.fromEntries(Object.entries(l).filter(([k]) => !NOUVELLES.includes(k))))));
    }
    if (error) return fail(`Rien n'a été programmé : ${error.message}`);
    return ok([
      `# ${bons.length} mail(s) programmé(s) · ${lot}`,
      `Premier envoi ${quandCourt(heures[0])}, dernier ${quandCourt(heures[heures.length - 1])}. Rien n'est encore parti.`,
      ...bons.map((b, i) => `- ${quandCourt(heures[i])} → ${b.to} · « ${b.subject} »`),
      refus.length ? `\nPas programmés (${refus.length}) :\n${refus.join("\n")}` : "",
      "Suivre : file_envoi. Retirer : annuler_envoi (un mail ou tout le lot).",
      // Un agent qui écarte la proposition (statut par défaut d'ecarter_proposition) annulerait
      // son propre envoi : la file relit la validation juste avant de l'envoyer.
      ctx.agent ? "Marque ensuite ces propositions envoye (ecarter_proposition, statut envoye) : ecarte annule l'envoi." : "",
    ].filter(Boolean).join("\n"));
  },
};

const fileEnvoi: AdminTool = {
  name: "file_envoi",
  title: "File d'envoi des mails",
  description: "La file d'envoi des mails de prospection : ce qui est prévu, ce qui est parti, ce qui a été annulé et pourquoi, le nombre de mails partis aujourd'hui par boîte, et si la file est en pause (trop de rebonds). Lecture seule.",
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
    const pause = await etatCoupeCircuit(sb);
    const prevus = rows.filter((r) => r.statut === "en_attente" || r.statut === "en_cours");
    const autres = rows.filter((r) => r.statut !== "en_attente" && r.statut !== "en_cours").reverse();
    return ok([
      `# File d'envoi · ${prevus.length} prévu(s)`,
      pause ? `⛔ ${pause}` : "",
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
  // La phrase sur les réponses vient de REGLES (_shared/fileEnvoi.ts) : toujours d'accord avec le contrôle.
  description: `La liste interne des adresses et des sociétés à qui on n'écrit plus : refus, demande d'arrêt, rebond, autre. action = ajouter (email OU domaine, raison, note), retirer, ou lister. ${texteListe()} Rien n'est jamais écrit à la personne. Demander l'accord avant d'ajouter ou de retirer.`,
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
 * Coupe-circuit : rebonds des dernières 24 h parmi les mails partis par la file. null = tout va
 * bien. Un rebond compte qu'il soit noté sur une fiche contact (gmail-poll) ou seulement dans le
 * journal des mails reçus : une bonne part des destinataires de la file n'avaient pas de fiche,
 * et leur rebond ne comptait pas (lecture seule, aucune fiche créée).
 */
async function etatCoupeCircuit(sb: SupabaseClient): Promise<string | null> {
  const depuis = new Date(Date.now() - 86_400_000).toISOString();
  const { data, error } = await sb.from("envoi_file").select("destinataires, envoye_at").eq("statut", "envoye").gte("envoye_at", depuis).limit(500);
  if (error) return null;
  const partis = (data as Json[] | null) ?? [];
  if (!partis.length) return null;
  const emails = new Set(partis.flatMap((r) => adresses(r.destinataires)));
  const [{ data: err }, journal] = await Promise.all([
    sb.from("contacts").select("email, email_check").eq("email_check->>statut", "erreur").gte("email_check->>le", depuis).limit(500),
    rebondsLus(sb, depuis),
  ]);
  const rebonds = new Set([
    ...((err as Json[] | null) ?? []).map((c) => String(c.email ?? "").trim().toLowerCase()),
    ...journal.map((r) => r.email),
  ].filter((e) => emails.has(e)));
  return coupeCircuit(partis.length, rebonds.size);
}

type Ligne = {
  id: string; boite: string; brouillon: string; destinataires: string; objet: string; createur: string | null; demarrer_sequence: boolean; essais: number; prevu_a: string;
  cree_par?: string | null; valide_le?: string | null; proposition?: string | null; grant_id?: string | null;
};

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
    // La connexion qui a programmé la ligne, relue maintenant (SQL 2026-11-27-verrou-connexions) :
    // cochée « agent autonome » depuis, une ligne sans validation ne part pas. Ligne sans connexion
    // notée (programmée avant ce SQL) : comme avant. Base illisible : erreur levée, nouvel essai.
    const cx = row.grant_id ? await connexionDeLaFile(sb, row.grant_id) : undefined;
    const parConnexion = raisonConnexionFile(row.valide_le, cx);
    if (parConnexion) return await fin("annule", { erreur: parConnexion });
    // Dernières vérifications : adresses du brouillon tel qu'il est maintenant (Gianni a pu le retoucher).
    const b = await lireEntetesBrouillon(sb, box, row.brouillon);
    if (!b.claude) return await fin("annule", { erreur: "le brouillon n'est plus marqué « préparé par Claude »" });
    // Programmé par un agent : la validation doit tenir encore (pas retirée ni écartée, toujours
    // d'un compte agence, et du valideur choisi aujourd'hui pour la connexion), et le brouillon ne
    // doit pas avoir changé depuis. Base illisible : erreur levée, nouvel essai dans 15 minutes
    // (jamais d'envoi à l'aveugle).
    if (row.valide_le) {
      const v = await validationToujoursLa(sb, { brouillon: row.brouillon, proposition: row.proposition ?? null }, cx?.agent ? cx.valideur : null);
      if (!v.ok) return await fin("annule", { erreur: v.raison.slice(0, 300) });
      if (modifieApres(b.date, v.valideLe)) return await fin("annule", { erreur: "brouillon modifié après sa validation dans la page Agents" });
    }
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
  const pause = await etatCoupeCircuit(sb);
  if (pause) return { ok: true, pause };
  // « * » : la colonne valide_le n'existe qu'après le SQL 2026-11-27-securite-alfred, et
  // proposition qu'après le SQL 2026-11-27-verrou-connexions.
  const { data, error } = await sb.from("envoi_file").select("*")
    .eq("statut", "en_attente").lte("prevu_a", now.toISOString()).order("prevu_a", { ascending: true }).limit(50);
  if (error) return { ok: false, raison: error.message };
  const dus = (data as Ligne[] | null) ?? [];
  if (!dus.length) return { ok: true, envoyes: 0 };
  const debutJour = new Date(instantParis(jourParis(now), "00:00")).toISOString();
  const faits: string[] = [];
  for (const boite of [...new Set(dus.map((r) => r.boite))]) {
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
    faits.push(await envoyerUne(sb, { ...row, essais: row.essais + 1 }));
  }
  return { ok: true, faits };
}
