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
//   - coupe-circuit par paliers (décision de Gianni du 27/11) : rien avant le 30e mail du
//     jour ; au 30e, puis à chaque palier de 10 (40, 50…), la file attend un quart d'heure
//     que les rebonds arrivent, puis calcule le taux de rebonds sur tous les mails du jour.
//     Au-delà de 5 %, plus rien ne part de la journée ; sinon la file repart pour 10 mails.
// Règles PURES (heure de Paris), testées par fileEnvoi.test.ts.
// ============================================================================

import { instantParis, paris } from "./rdv.ts";

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
  /** Coupe-circuit : premier contrôle au `premierPalier`-ième mail du jour, puis tous les `pasPalier` mails. */
  premierPalier: number;
  pasPalier: number;
  /** Au-delà de cette part de rebonds parmi les mails du jour, la file s'arrête pour la journée. */
  rebondsPart: number;
  /** À chaque palier, minutes d'attente après le dernier envoi pour laisser arriver les rebonds. */
  observationMin: number;
};

export const REGLES: Regles = {
  parJour: 40,
  ecartMin: 3,
  ecartMax: 7,
  debut: "08:30",
  fin: "18:30",
  jours: [1, 2, 3, 4, 5],
  doublonJours: 30,
  premierPalier: 30,
  pasPalier: 10,
  rebondsPart: 0.05,
  observationMin: 15,
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
 * Raison de ne pas envoyer, ou null. `reponse` = le mail répond à un fil : seule la liste
 * « ne plus contacter » et l'adresse en erreur comptent alors (on ne bloque jamais une réponse
 * à quelqu'un qui nous a écrit). `agence` = adresses de l'agence, jamais bloquées.
 */
export function raisonDeBloquer(p: {
  destinataires: readonly string[];
  reponse: boolean;
  liste: readonly NePlusContacter[];
  enErreur: readonly string[];
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
    if (npc) return `${email} est dans la liste « ne plus contacter » (${npc.raison})`;
    if (erreurs.has(email)) return `${email} est marquée « adresse en erreur » sur sa fiche`;
    if (p.reponse) continue;
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

export type EtatPalier = {
  /** libre : la file envoie ; observation : on attend les rebonds avant de passer le palier ; pause : plus rien aujourd'hui. */
  etat: "libre" | "observation" | "pause";
  /** Mails qui peuvent encore partir avant le prochain contrôle (0 en observation ou en pause). */
  restant: number;
  /** Le prochain palier contrôlé (30, 40, 50…). */
  prochain: number;
  message: string | null;
};

const pourcent = (x: number) => `${(Math.round(x * 1000) / 10).toLocaleString("fr-FR")} %`;

/**
 * Coupe-circuit par paliers (décision de Gianni du 27/11). `envoyes` et `rebonds` : mails partis
 * par la file aujourd'hui (heure de Paris, toutes boîtes : même nom de domaine) et rebonds reçus
 * pour ces mails. `minutesDepuisDernier` : depuis le dernier mail parti.
 *   - avant le premier palier (30) : la file envoie, sans dépasser le palier ;
 *   - sur un palier (30, 40, 50…) : au-delà de 5 % de rebonds, pause pour la journée ; sinon,
 *     un quart d'heure d'observation après le dernier envoi, puis 10 mails de plus ;
 *   - entre deux paliers : la file envoie jusqu'au palier suivant.
 */
export function etatPalier(envoyes: number, rebonds: number, minutesDepuisDernier: number, r: Regles = REGLES): EtatPalier {
  const n = Math.max(0, Math.floor(envoyes));
  if (n < r.premierPalier) return { etat: "libre", restant: r.premierPalier - n, prochain: r.premierPalier, message: null };
  const audela = (n - r.premierPalier) % r.pasPalier;
  if (audela !== 0) {
    const prochain = n - audela + r.pasPalier;
    return { etat: "libre", restant: prochain - n, prochain, message: null };
  }
  const prochain = n + r.pasPalier;
  const taux = rebonds / n;
  if (taux > r.rebondsPart) {
    return {
      etat: "pause", restant: 0, prochain,
      message: `${rebonds} rebond(s) sur les ${n} mails partis aujourd'hui (${pourcent(taux)}, au-delà de ${pourcent(r.rebondsPart)}) : plus aucun envoi aujourd'hui, pour protéger le nom de domaine. La file repart au prochain jour ouvré, compteur remis à zéro. D'ici là, retirer les adresses en erreur (ne_plus_contacter).`,
    };
  }
  if (minutesDepuisDernier < r.observationMin) {
    return {
      etat: "observation", restant: 0, prochain,
      message: `Palier de ${n} mails atteint : contrôle des rebonds dans ${Math.ceil(r.observationMin - minutesDepuisDernier)} min avant les ${r.pasPalier} suivants (${rebonds} rebond(s) pour l'instant, ${pourcent(taux)}).`,
    };
  }
  return { etat: "libre", restant: r.pasPalier, prochain, message: null };
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
