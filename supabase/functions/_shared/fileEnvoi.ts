// ============================================================================
// _shared/fileEnvoi.ts : la file d'envoi des mails de prospection (connecteur Claude).
// ----------------------------------------------------------------------------
// Audit du 24 novembre 2026, points M16 à M20. Avant, un lot validé partait d'un coup
// (11 mails en une minute le 20/11) et rien côté serveur n'empêchait d'écrire deux fois à la
// même société ou à quelqu'un qui avait dit non. Maintenant :
//   - Gianni dit « oui » pour une liste de brouillons, Claude les met dans la file
//     (outil programmer_envoi) : chaque mail reçoit une heure d'envoi ;
//   - une tâche planifiée (pg_cron, chaque minute) en envoie au plus un par boîte, seulement
//     en semaine aux heures de bureau, avec un écart de quelques minutes, et un plafond par
//     jour et par boîte ;
//   - juste avant chaque envoi, on revérifie : liste « ne plus contacter », adresse en erreur,
//     déjà écrit à cette société depuis 30 jours (premier mail seulement, pas une réponse) ;
//   - coupe-circuit : trop de rebonds sur 24 h, la file s'arrête.
// Depuis le 27/11 (enquête du 27/11 sur la file d'envoi) : un rebond compte aussi quand l'adresse
// n'a pas de fiche contact (une bonne part des destinataires de la file). Il est lu dans le journal
// des mails reçus (email_activity : message d'un robot qui cite l'adresse), sans rien écrire nulle
// part, et bloque l'adresse tant qu'elle n'a pas donné signe de vie depuis : un mail reçu d'elle,
// ou sa fiche revérifiée.
// Règles PURES (heure de Paris), testées par fileEnvoi.test.ts.
// ============================================================================

import { instantParis, paris } from "./rdv.ts";
import { adresseEnRebond } from "./sequence.ts";

export type Regles = {
  /** Mails au plus par jour et par boîte. */
  parJour: number;
  /** Écart entre deux mails d'une même boîte, en minutes (tiré au hasard entre les deux). */
  ecartMin: number;
  ecartMax: number;
  /** Heures d'envoi, heure de Paris, et jours (1 = lundi … 7 = dimanche). */
  debut: string;
  fin: string;
  jours: number[];
  /** Jours sans nouveau premier mail à une même société. */
  doublonJours: number;
  /** Coupe-circuit : rebonds sur 24 h (au moins `rebondsMin`, et plus de `rebondsPart` des envois). */
  rebondsMin: number;
  rebondsPart: number;
  /** Jours pendant lesquels un rebond lu dans le journal des mails bloque l'adresse (sauf signe de vie depuis). */
  rebondJours: number;
  /**
   * Un rebond lu dans le journal des mails bloque aussi une réponse dans un fil existant (true :
   * comportement du 27/11). Décision de Marc en attente : false laisserait partir les réponses (la
   * fiche « adresse en erreur » les bloquerait toujours).
   */
  rebondBloqueReponse: boolean;
  /**
   * Raisons de la liste « ne plus contacter » qui laissent passer une réponse dans un fil
   * existant. Vide : la liste bloque tout, réponses comprises (comportement du 25/11). La règle
   * est une décision de Marc (enquête du 27/11) : par exemple ["refus", "autre"] pour que seules
   * les raisons « arret » et « rebond » bloquent aussi les réponses.
   */
  reponseMalgreListe: readonly string[];
};

export const REGLES: Regles = {
  parJour: 40,
  ecartMin: 3,
  ecartMax: 7,
  debut: "08:30",
  fin: "18:30",
  jours: [1, 2, 3, 4, 5],
  doublonJours: 30,
  rebondsMin: 3,
  rebondsPart: 0.05,
  rebondJours: 90,
  rebondBloqueReponse: true,
  reponseMalgreListe: [],
};

/** Brouillons au plus dans un appel de programmer_envoi. */
export const MAX_PROGRAMMES = 50;

const minutes = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

/** Le moment est-il dans les heures d'envoi (jour ouvré, entre début et fin, à Paris) ? */
export function dansLaFenetre(t: Date, r: Regles = REGLES): boolean {
  const p = paris(t);
  const m = minutes(p.heure);
  return r.jours.includes(p.semaine) && m >= minutes(r.debut) && m < minutes(r.fin);
}

/** Le premier moment d'envoi possible à partir de `t` (lui-même s'il est dans la fenêtre). */
export function prochainCreneau(t: Date, r: Regles = REGLES): Date {
  if (dansLaFenetre(t, r)) return t;
  const p = paris(t);
  // Aujourd'hui avant l'heure de début, sinon un des jours suivants.
  for (let j = 0; j < 9; j++) {
    const jour = new Date(Date.parse(`${p.jour}T12:00:00Z`) + j * 86_400_000).toISOString().slice(0, 10);
    const debut = new Date(instantParis(jour, r.debut));
    if (debut.getTime() >= t.getTime() && dansLaFenetre(debut, r)) return debut;
  }
  return t;
}

/** Jour de Paris (AAAA-MM-JJ) d'un instant. */
export const jourParis = (t: Date) => paris(t).jour;

/**
 * Heures d'envoi de `n` nouveaux mails d'une boîte. `deja` = heures déjà prévues ou déjà
 * envoyées pour cette boîte (pour l'écart et le plafond du jour). Chaque mail part au moins
 * `ecartMin` minutes après le précédent, dans les heures d'envoi, sans dépasser le plafond du
 * jour : au-delà, le jour ouvré suivant.
 */
export function planifier(n: number, maintenant: Date, deja: readonly Date[], r: Regles = REGLES, alea: () => number = Math.random): Date[] {
  const parJour = new Map<string, number>();
  for (const d of deja) parJour.set(jourParis(d), (parJour.get(jourParis(d)) ?? 0) + 1);
  const dernier = deja.reduce((m, d) => Math.max(m, d.getTime()), 0);
  let t = new Date(Math.max(maintenant.getTime() + 60_000, dernier ? dernier + r.ecartMin * 60_000 : 0));
  const out: Date[] = [];
  for (let i = 0; i < n; i++) {
    for (let garde = 0; garde < 40; garde++) {
      t = prochainCreneau(t, r);
      const j = jourParis(t);
      if ((parJour.get(j) ?? 0) < r.parJour) break;
      // Plafond atteint ce jour-là : le lendemain à minuit, prochainCreneau trouve le début.
      t = new Date(Date.parse(`${j}T12:00:00Z`) + 86_400_000);
      t = new Date(instantParis(t.toISOString().slice(0, 10), "00:00"));
    }
    out.push(t);
    parJour.set(jourParis(t), (parJour.get(jourParis(t)) ?? 0) + 1);
    const ecart = r.ecartMin + Math.round(alea() * Math.max(0, r.ecartMax - r.ecartMin));
    t = new Date(t.getTime() + ecart * 60_000);
  }
  return out;
}

/** Messageries grand public : l'adresse ne dit rien de la société. */
const PUBLICS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.fr", "outlook.com", "outlook.fr", "live.com", "live.fr",
  "yahoo.com", "yahoo.fr", "icloud.com", "me.com", "orange.fr", "free.fr", "sfr.fr", "laposte.net", "wanadoo.fr", "proton.me", "protonmail.com",
]);

/** Adresses e-mail d'un champ « Nom <a@b.fr>, c@d.fr », en minuscules, sans doublon. */
export function adresses(v: unknown): string[] {
  return [...new Set([...String(v ?? "").matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) => m[0].toLowerCase()))];
}

/** Ce qui identifie une société : son domaine, ou l'adresse entière pour une messagerie grand public. */
export function cleSociete(email: string): string {
  const e = email.trim().toLowerCase();
  const d = e.split("@")[1] ?? "";
  return d && !PUBLICS.has(d) ? d : e;
}

export type NePlusContacter = { email: string | null; domaine: string | null; raison: string };
export type EnvoiRecent = { email: string; at: string };

/**
 * Raison de ne pas envoyer, ou null. `reponse` = le mail répond à un fil existant : la règle
 * des 30 jours ne compte pas, et la liste « ne plus contacter » le laisse passer seulement pour
 * les raisons de `reponseMalgreListe` (aucune par défaut). L'adresse en erreur (fiche) bloque
 * toujours ; un rebond du journal (`rebonds`, déjà passés par rebondsQuiComptent) aussi, réponse
 * comprise tant que `rebondBloqueReponse` le dit.
 * `doublon` = false : pas de règle des 30 jours non plus (envoi direct, brouillon). `agence` =
 * adresses de l'agence, jamais bloquées.
 */
export function raisonDeBloquer(p: {
  destinataires: readonly string[];
  reponse: boolean;
  doublon?: boolean;
  liste: readonly NePlusContacter[];
  enErreur: readonly string[];
  rebonds?: readonly EnvoiRecent[];
  recents: readonly EnvoiRecent[];
  maintenant: Date;
  agence?: string;
  r?: Regles;
}): string | null {
  const r = p.r ?? REGLES;
  const agence = (p.agence ?? "ttpcreators.pro").toLowerCase();
  const erreurs = new Set(p.enErreur.map((e) => e.toLowerCase()));
  const limite = p.maintenant.getTime() - r.doublonJours * 86_400_000;
  for (const email of p.destinataires.map((e) => e.toLowerCase())) {
    const domaine = email.split("@")[1] ?? "";
    if (domaine === agence) continue;
    const npc = p.liste.find((x) => (x.email && x.email.toLowerCase() === email) || (x.domaine && x.domaine.toLowerCase().replace(/^@/, "") === domaine));
    if (npc && !(p.reponse && r.reponseMalgreListe.includes(npc.raison))) return `${email} est dans la liste « ne plus contacter » (${npc.raison})`;
    if (erreurs.has(email)) return `${email} est marquée « adresse en erreur » sur sa fiche`;
    const rebond = (p.rebonds ?? []).filter((x) => x.email.toLowerCase() === email).sort((a, b) => b.at.localeCompare(a.at))[0];
    if (rebond && !(p.reponse && !r.rebondBloqueReponse)) {
      const t = Date.parse(rebond.at);
      const quand = Number.isFinite(t) ? ` le ${new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" })}` : "";
      // La sortie est dite : sans elle, l'adresse reste bloquée 90 jours sans que personne sache pourquoi.
      return `${email} a renvoyé un rebond${quand} (adresse refusée par son serveur, pas revérifiée depuis). Si l'adresse est bonne : écris depuis Gmail ; le blocage tombe dès qu'un mail d'elle arrive ou que sa fiche contact est revérifiée (email_check)`;
    }
    if (p.reponse || p.doublon === false) continue;
    const cle = cleSociete(email);
    const deja = p.recents
      .filter((x) => cleSociete(x.email) === cle && Date.parse(x.at) >= limite && Date.parse(x.at) <= p.maintenant.getTime())
      .sort((a, b) => b.at.localeCompare(a.at))[0];
    if (deja) {
      const quand = new Date(deja.at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" });
      return `un premier mail est déjà parti chez ${cle} le ${quand} (${deja.email}) : pas de nouveau premier mail à la même société avant ${r.doublonJours} jours`;
    }
  }
  return null;
}

/** Coupe-circuit : la file s'arrête si les rebonds des dernières 24 h dépassent le seuil. */
export function coupeCircuit(envoyes24h: number, rebonds24h: number, r: Regles = REGLES): string | null {
  if (rebonds24h < r.rebondsMin) return null;
  if (envoyes24h > 0 && rebonds24h / envoyes24h <= r.rebondsPart) return null;
  return `${rebonds24h} rebond(s) sur ${envoyes24h} mail(s) envoyé(s) en 24 h : la file est en pause. Elle reprend seule quand les rebonds des dernières 24 h repassent sous le seuil ; vérifier les adresses en attendant (annuler_envoi pour retirer un mail prévu).`;
}

/** Une ligne du journal des mails reçus (email_activity), telle que la base la rend. */
export type MailRecu = { contact_email?: unknown; contact_name?: unknown; subject?: unknown; snippet?: unknown; created_at?: unknown };

/**
 * Les rebonds lus dans le journal des mails reçus : un message d'un robot (mailer-daemon,
 * postmaster) qui annonce un échec et cite l'adresse refusée (même règle que gmail-poll,
 * adresseEnRebond). Sert surtout aux adresses sans fiche contact, que gmail-poll ne peut pas marquer.
 */
export function rebondsDuJournal(lignes: readonly MailRecu[], agence: string): EnvoiRecent[] {
  const out: EnvoiRecent[] = [];
  for (const l of lignes) {
    const from = `${String(l.contact_name ?? "").trim()} <${String(l.contact_email ?? "").trim()}>`;
    const email = adresseEnRebond({ from, subject: String(l.subject ?? ""), snippet: String(l.snippet ?? "") }, agence);
    if (email) out.push({ email, at: String(l.created_at ?? "") });
  }
  return out;
}

/**
 * Ce que le journal des mails reçus dit de ces adresses (`vises`) : leurs rebonds (message d'un
 * robot qui cite l'adresse) et les mails venus d'elles (`recus` : l'adresse marche).
 */
export function journalDesAdresses(lignes: readonly MailRecu[], vises: readonly string[], agence: string): { rebonds: EnvoiRecent[]; recus: EnvoiRecent[] } {
  const v = new Set(vises.map((e) => e.trim().toLowerCase()));
  const recus: EnvoiRecent[] = [];
  for (const l of lignes) {
    const de = String(l.contact_email ?? "").trim().toLowerCase();
    if (v.has(de)) recus.push({ email: de, at: String(l.created_at ?? "") });
  }
  return { rebonds: rebondsDuJournal(lignes, agence).filter((r) => v.has(r.email)), recus };
}

/** La date de la dernière vérification de l'adresse notée sur sa fiche contact (email_check.le), si elle existe. */
export type FicheVerifiee = { email: string; le: string | null };

/**
 * Les rebonds du journal qui comptent encore pour bloquer un envoi : ceux d'une adresse sans
 * fiche contact, ou dont la fiche n'a pas été revérifiée depuis le rebond (email_check plus
 * récent : la fiche fait foi). Une fiche créée après le rebond, sans vérification, ne l'efface pas.
 * Un mail reçu de l'adresse après le rebond (`recus`) l'efface : elle marche (boîte pleine
 * vidée, filtre anti-spam passé, la personne nous a écrit).
 */
export function rebondsQuiComptent(rebonds: readonly EnvoiRecent[], fiches: readonly FicheVerifiee[], recus: readonly EnvoiRecent[] = []): EnvoiRecent[] {
  const verif = new Map(fiches.map((f) => [f.email.trim().toLowerCase(), f.le]));
  return rebonds.filter((r) => {
    const email = r.email.toLowerCase();
    const quand = Date.parse(r.at);
    const le = verif.get(email);
    const t = le ? Date.parse(le) : Number.NaN;
    if (Number.isFinite(t) && t >= quand) return false;
    return !recus.some((m) => m.email.trim().toLowerCase() === email && Date.parse(m.at) > quand);
  });
}

/** Ce que bloque la liste « ne plus contacter » (description de l'outil, toujours d'accord avec raisonDeBloquer). */
export function texteListe(r: Regles = REGLES): string {
  return r.reponseMalgreListe.length
    ? `Une adresse ou un domaine de la liste bloque les brouillons et les envois ; une réponse dans un fil existant passe seulement pour la raison ${r.reponseMalgreListe.join(" ou ")}.`
    : "Une adresse ou un domaine de la liste bloque les brouillons et les envois, réponses dans un fil existant comprises.";
}

/** « mer. 25 nov. à 9 h 42 » à Paris. */
export function quandCourt(t: Date | string): string {
  const d = typeof t === "string" ? new Date(t) : t;
  const p = paris(d);
  const jour = d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Paris" });
  return `${jour} à ${Number(p.heure.slice(0, 2))} h ${p.heure.slice(3, 5)}`;
}

export type LigneFile = { id: string; boite: string; destinataires: string; objet: string; statut: string; prevu_a: string; envoye_at: string | null; erreur: string | null; lot: string | null };

const ETATS: Record<string, string> = { en_attente: "prévu", en_cours: "en cours d'envoi", envoye: "parti", annule: "annulé", echec: "échec" };

/** Une ligne de la file, lisible. */
export function ligneFile(l: LigneFile): string {
  const etat = ETATS[l.statut] ?? l.statut;
  const quand = l.statut === "envoye" && l.envoye_at ? quandCourt(l.envoye_at) : quandCourt(l.prevu_a);
  return `- ${etat} · ${quand} · ${l.boite.includes("@") ? l.boite : `${l.boite}@`} → ${l.destinataires} · « ${l.objet} »${l.erreur ? ` · ${l.erreur}` : ""}${l.lot ? ` · lot ${l.lot}` : ""} [${l.id.slice(0, 8)}]`;
}
