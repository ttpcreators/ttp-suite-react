// ============================================================================
// _shared/synchroAgenda.ts : la synchro Google Agenda sans réseau ni base. Les décisions (quoi
// envoyer, quoi marquer, que faire d'une réponse de Google) et le passage lui-même (envoi puis
// lecture d'un rendez-vous), qui reçoit la base et Google en paramètres.
// ----------------------------------------------------------------------------
// Utilisé par runSyncCycle (_shared/google.ts, qui fournit la vraie base et le vrai Google), testé
// par synchroAgenda.test.ts avec une base et un Google simulés.
//
// Boucle arrêtée le 27/11/2026 : après un envoi réussi, le code écrivait updated_at =
// last_synced_at, mais le déclencheur touch_updated_at remet updated_at à now() pour toute
// écriture serveur dont sync_source n'est pas 'google'. Les rendez-vous de l'app restaient donc
// « à envoyer » : ils repartaient vers Google à chaque passage, chaque envoi relançait le webhook,
// et ainsi de suite (des dizaines de milliers d'appels par jour). Maintenant, un envoi réussi
// passe sync_source à 'google' : le déclencheur garde l'updated_at écrit et la ligne sort de la
// file. Une modification de l'app ou d'Alfred la remet à 'agence' (src/lib/db.ts, ttp-mcp), donc
// elle repart. L'app et le connecteur relancent un passage juste après (sinon le cron horaire).
//
// Course : une modification faite pendant un passage (entre la lecture et l'écriture qui suit)
// ne doit jamais être marquée synchronisée sans être partie. Toute écriture qui marque une ligne
// se fait donc SOUS CONDITION que updated_at n'ait pas bougé depuis la lecture. Si elle a bougé,
// on garde seulement l'id et l'etag donnés par Google, et la ligne repart au passage suivant avec
// sa nouvelle version.
//
// 404 ou 410 sur une modification : le rendez-vous n'est plus chez Google (supprimé là-bas avant
// que la lecture l'ait vu, purgé, ou un autre compte Google après une reconnexion). Comme avant :
// l'id Google est effacé sans marquer la ligne, et le passage suivant la recrée une fois chez
// Google. « La recréer une fois ou ne plus jamais la recréer » : question posée à Marc le
// 27/11/2026, rien ne change tant qu'il n'a pas répondu.
//
// 412 sur une modification : Google a changé depuis notre dernier etag. Le rendez-vous est relu
// tout de suite, sans attendre que la lecture du passage le croise (elle ne le croisait jamais si
// ce changement avait déjà été lu : 412 à chaque passage). La version la plus récente gagne ; si
// c'est celle de l'app, elle repart dans le même passage avec l'etag relu, une seule fois.
// ============================================================================

/** Les champs d'une ligne `events` qui comptent pour la synchro. */
export interface LigneSync {
  google_event_id: string | null;
  google_etag: string | null;
  updated_at: string;
  last_synced_at: string | null;
  sync_source: string | null;
  deleted: boolean;
}

/** Une ligne `events` lue par la synchro (les autres colonnes passent telles quelles). */
export interface LigneEvent extends LigneSync {
  id: string;
}

/** Des colonnes de `events` à écrire. */
export type Champs = Record<string, unknown>;

const instant = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : Number.NaN);
const reussi = (statut: number) => statut >= 200 && statut < 300;
/** Les 8 premiers caractères d'un id, pour le journal. */
const idCourt = (id: string | null | undefined) => String(id ?? "").slice(0, 8);
/** Un message d'erreur raccourci, pour le journal. */
const court = (message: string) => message.slice(0, 200);

/** À envoyer vers Google : écrite par l'app ou par Alfred ('agence') depuis le dernier envoi réussi. */
export function aEnvoyer(r: Pick<LigneSync, "sync_source" | "updated_at" | "last_synced_at">): boolean {
  if (r.sync_source !== "agence") return false;
  if (!r.last_synced_at) return true;
  return instant(r.updated_at) > instant(r.last_synced_at);
}

/** Ce qu'on demande à Google pour une ligne à envoyer. */
export type ActionGoogle = "creer" | "modifier" | "supprimer" | "aucune";

export function actionGoogle(r: Pick<LigneSync, "deleted" | "google_event_id">): ActionGoogle {
  // Supprimée avant d'avoir jamais été envoyée : rien à faire chez Google.
  if (r.deleted) return r.google_event_id ? "supprimer" : "aucune";
  return r.google_event_id ? "modifier" : "creer";
}

/** Ce que Google renvoie d'utile après une création ou une modification. */
export interface ReponseGoogle {
  id?: string;
  etag?: string;
}

/**
 * Ce que veut dire la réponse de Google :
 * - « envoye » : Google a pris la version de l'app (ou le rendez-vous à supprimer n'y est déjà plus) ;
 * - « absent » : 404 ou 410 sur une modification, plus chez Google : id effacé, recréé au passage suivant ;
 * - « conflit » : 412, modifié des deux côtés depuis le dernier passage : relu tout de suite, le plus récent gagne ;
 * - « refus » : autre réponse (403, 429 ou 5xx après les essais…), ou création acceptée sans id lisible :
 *   rien n'est marqué, réessayé au passage suivant.
 */
export type IssueEnvoi = "envoye" | "absent" | "conflit" | "refus";

export function issueEnvoi(action: ActionGoogle, statut: number, reponse: ReponseGoogle = {}): IssueEnvoi {
  if (action === "aucune") return "envoye";
  // Création acceptée mais sans id lisible : rien ne peut être marqué. Réessayée au passage suivant, elle
  // risque un doublon chez Google, mais sans id on ne peut pas mieux faire (le journal le signale).
  if (reussi(statut)) return action === "creer" && !reponse.id ? "refus" : "envoye";
  if (statut === 404 || statut === 410) {
    if (action === "supprimer") return "envoye";
    if (action === "modifier") return "absent";
  }
  if (statut === 412 && action === "modifier") return "conflit";
  return "refus";
}

/**
 * Les écritures en base après la réponse de Google (null : rien à écrire).
 * - `marquer` : à écrire SOUS CONDITION que updated_at n'ait pas bougé depuis la lecture.
 *   updated_at = last_synced_at = maintenant et sync_source = 'google', sinon le déclencheur
 *   remet updated_at à now() et la ligne repart (la boucle).
 * - `sinon` : à écrire sans condition quand `marquer` est vide ou n'a pas pu s'écrire (ligne
 *   modifiée pendant l'envoi). Ne marque jamais la ligne : elle repart au passage suivant.
 */
export interface Ecritures {
  marquer: Champs | null;
  sinon: Champs | null;
}

export function ecrituresApresEnvoi(
  action: ActionGoogle,
  issue: IssueEnvoi,
  maintenant: string,
  ligne: Pick<LigneSync, "google_etag">,
  g: ReponseGoogle = {},
): Ecritures {
  if (issue === "conflit" || issue === "refus") return { marquer: null, sinon: null };
  // Plus chez Google : id effacé sans marquer, le passage suivant la recrée une fois (comportement d'avant).
  if (issue === "absent") return { marquer: null, sinon: { google_event_id: null, google_etag: null } };
  const synchronise = { last_synced_at: maintenant, updated_at: maintenant, sync_source: "google" };
  switch (action) {
    case "creer": {
      // Sans id, la création n'est pas reconnue : rien n'est marqué (issueEnvoi la compte en refus).
      if (!g.id) return { marquer: null, sinon: null };
      // L'id est gardé même si la ligne a bougé : sinon le passage suivant créerait un doublon chez Google.
      const ids = { google_event_id: g.id, google_etag: g.etag ?? null };
      return { marquer: { ...ids, ...synchronise }, sinon: ids };
    }
    case "modifier":
      // Le nouvel etag est gardé même si la ligne a bougé : sinon le prochain envoi tomberait sur un 412.
      return {
        marquer: { google_etag: g.etag ?? ligne.google_etag, ...synchronise },
        sinon: g.etag ? { google_etag: g.etag } : null,
      };
    case "supprimer":
      // Déjà parti de Google. Si la ligne a été restaurée entre-temps, l'id effacé la fait recréer
      // une fois, avec la version de l'app.
      return { marquer: synchronise, sinon: { google_event_id: null, google_etag: null } };
    case "aucune":
      return { marquer: synchronise, sinon: null };
  }
}

/**
 * Ce que la lecture de Google fait d'un rendez-vous déjà connu de l'app (hors suppression) :
 * - « rien » : même etag que la dernière version synchronisée (notre propre envoi qui revient) ;
 * - « garder_app » : la version de l'app est la plus récente. On garde ses champs mais on retient
 *   l'etag de Google, pour que le prochain envoi passe (sinon 412 à chaque passage et la
 *   modification de l'app n'arrive jamais chez Google) ;
 * - « prendre_google » : la version de Google est la plus récente (dernier modifié gagne), écrite
 *   SOUS CONDITION que la ligne n'ait pas bougé depuis la lecture.
 */
export type ChoixLecture = "rien" | "garder_app" | "prendre_google";

export function choixLecture(
  ligne: Pick<LigneSync, "google_etag" | "updated_at">,
  g: { etag?: string; updated?: string },
  maintenant: string,
): ChoixLecture {
  if (g.etag && g.etag === ligne.google_etag) return "rien";
  return instant(g.updated ?? maintenant) > instant(ligne.updated_at) ? "prendre_google" : "garder_app";
}

// ----------------------------------------------------------------------------
// Bilan d'un passage et ligne de journal
// ----------------------------------------------------------------------------

/** Bilan d'un passage, rendu par runSyncCycle et renvoyé à l'app par google-sync. */
export interface BilanSync {
  pulled: number;
  pushed: number;
  deleted: number;
  resynced: boolean;
  /** 412 à l'envoi : rendez-vous relu, le plus récent a gagné. */
  conflits: number;
  /** 404 ou 410 à une modification : plus chez Google, id effacé, recréé au passage suivant. */
  absents: number;
  /** Autres refus de Google à l'envoi, réessayés au passage suivant (statuts dans statutsRefus). */
  refus: number;
  statutsRefus: number[];
  /** Verrou perdu après l'envoi (passage trop long, repris par un autre) : la lecture de Google n'a pas eu lieu. */
  verrouPerdu?: boolean;
}

export function bilanVide(): BilanSync {
  return { pulled: 0, pushed: 0, deleted: 0, resynced: false, conflits: 0, absents: 0, refus: 0, statutsRefus: [] };
}

/** Compte la réponse de Google pour une ligne envoyée. */
export function noterEnvoi(bilan: BilanSync, action: ActionGoogle, issue: IssueEnvoi, statut: number): void {
  if (issue === "envoye") {
    if (action === "supprimer") bilan.deleted++;
    else if (action !== "aucune") bilan.pushed++;
  } else if (issue === "absent") bilan.absents++;
  else if (issue === "conflit") bilan.conflits++;
  else {
    bilan.refus++;
    if (!bilan.statutsRefus.includes(statut) && bilan.statutsRefus.length < 5) bilan.statutsRefus.push(statut);
  }
}

type Contexte = Record<string, string | number | boolean | null>;

/** Une ligne de journal par passage (écrite en JSON après le nom de la fonction). */
export function ligneJournal(contexte: Contexte, resultat: BilanSync | { skipped: string }, ms: number): Record<string, unknown> {
  if ("skipped" in resultat) {
    return { ...contexte, saute: resultat.skipped === "locked" ? "verrou" : resultat.skipped, ms };
  }
  return {
    ...contexte,
    envoyes: resultat.pushed,
    recus: resultat.pulled,
    supprimes: resultat.deleted,
    ...(resultat.conflits ? { conflits: resultat.conflits } : {}),
    ...(resultat.absents ? { absents: resultat.absents } : {}),
    ...(resultat.refus ? { refus: resultat.refus, statuts_refus: resultat.statutsRefus } : {}),
    ...(resultat.resynced ? { resync: true } : {}),
    ...(resultat.verrouPerdu ? { verrou_perdu: true } : {}),
    ms,
  };
}

/** La même ligne quand le passage a échoué (message raccourci). */
export function ligneErreur(contexte: Contexte, e: unknown, ms: number): Record<string, unknown> {
  const message = e instanceof Error ? e.message : String(e);
  return { ...contexte, erreur: message.slice(0, 300), ms };
}

const DECLENCHEURS = ["cron", "webhook", "renew", "manual"];

/**
 * Le déclencheur de google-sync, pour le journal : l'étiquette envoyée par l'appelant si elle est
 * connue, sinon « app » (compte agence) ou « inconnu ». C'est une étiquette, pas une preuve de
 * l'origine : la correspondance (cron horaire, connecteur, rdv, meet-invite, app) est dans
 * l'en-tête de google-sync/index.ts.
 */
export function declencheurSync(trigger: unknown, via: "cron" | "agency" | undefined): string {
  if (typeof trigger === "string" && DECLENCHEURS.includes(trigger)) return trigger;
  return via === "agency" ? "app" : "inconnu";
}

// ----------------------------------------------------------------------------
// Le passage : envoi vers Google, puis lecture d'un rendez-vous de Google. La base et Google sont
// des paramètres : _shared/google.ts fournit les vrais (Supabase et l'API Google Agenda), les
// tests de faux objets.
// ----------------------------------------------------------------------------

/** Un rendez-vous tel que Google le donne (lecture, ou réponse à un envoi). */
export interface EvenementGoogle extends ReponseGoogle {
  status?: string;
  updated?: string;
}

/** La table `events` vue par la synchro (écritures avec la clé service : le déclencheur touch_updated_at s'applique). */
export interface BaseAgenda<L extends LigneEvent> {
  /** Les lignes écrites par l'app ou par Alfred (sync_source 'agence'). Lève une erreur si la lecture rate. */
  lignesAgence(): Promise<L[]>;
  /** La ligne de ce rendez-vous Google, ou null. Lève une erreur si la lecture rate. */
  parIdGoogle(idGoogle: string): Promise<L | null>;
  /** Écrit `champs` seulement si updated_at n'a pas bougé depuis la lecture de `ligne`. */
  ecrireSiInchangee(ligne: Pick<L, "id" | "updated_at">, champs: Champs): Promise<{ ecrite: boolean; erreur: string | null }>;
  /** Écrit `champs` sans condition. Renvoie le message d'erreur, ou null. */
  ecrire(id: string, champs: Champs): Promise<string | null>;
  /** Ajoute un rendez-vous venu de Google (sans doublon sur google_event_id). Renvoie le message d'erreur, ou null. */
  ajouter(champs: Champs): Promise<string | null>;
}

/** Google Agenda vu par la synchro. */
export interface GoogleAgenda<L extends LigneEvent> {
  /** Envoie la ligne : création, modification (If-Match avec son etag) ou suppression. */
  envoyer(action: Exclude<ActionGoogle, "aucune">, ligne: L): Promise<{ statut: number; g: EvenementGoogle }>;
  /** Relit un rendez-vous chez Google (après un 412). g est null si la lecture a raté. */
  lire(idGoogle: string): Promise<{ statut: number; g: EvenementGoogle | null }>;
  /** Les colonnes `events` d'un rendez-vous Google (titre, date, heure, type…). */
  champs(g: EvenementGoogle): Champs;
}

/** Une ligne de journal de la synchro (refus, absence, conflit, écriture refusée…). */
export type Journal = (quoi: Record<string, unknown>) => void;

/** Une écriture qui ne rate que sur une panne : on arrête le passage, le curseur n'avance pas et le suivant relit. */
function ecrireOuArreter(erreur: string | null): void {
  if (erreur) throw new Error(`events_write_failed:${erreur}`);
}

/**
 * Ce que la lecture a fait d'un rendez-vous de Google. « garde » : la version de l'app, plus récente, reste
 * (etag de Google retenu, elle repartira).
 */
export type ResultatLecture = "pulled" | "deleted" | "garde" | null;

/**
 * Applique un rendez-vous lu chez Google (lecture du passage, ou relecture après un 412). Une lecture, une
 * écriture de l'etag ou une suppression ratée lève une erreur : le passage s'arrête sans avancer le
 * curseur (syncToken) et le suivant relit ce changement. Un rendez-vous refusé par la base pour ses
 * données est journalisé et laissé de côté, pour ne pas bloquer tous les autres.
 */
export async function appliquerLecture<L extends LigneEvent>(
  base: BaseAgenda<L>,
  google: GoogleAgenda<L>,
  g: EvenementGoogle,
  maintenant: string,
  journal: Journal,
): Promise<ResultatLecture> {
  if (!g.id) return null;
  // Surtout pas d'ajout à l'aveugle si la lecture rate : il écraserait une modification de l'app pas encore envoyée.
  const existante = await base.parIdGoogle(g.id);

  if (g.status === "cancelled") {
    if (!existante || existante.deleted) return null;
    ecrireOuArreter(await base.ecrire(existante.id, {
      deleted: true,
      deleted_at: maintenant,
      sync_source: "google",
      last_synced_at: maintenant,
      updated_at: g.updated ?? maintenant,
    }));
    return "deleted";
  }

  const champs = google.champs(g);
  if (!existante) {
    const erreur = await base.ajouter({
      ...champs,
      google_event_id: g.id,
      google_etag: g.etag ?? null,
      sync_source: "google",
      updated_at: g.updated ?? maintenant,
      last_synced_at: maintenant,
      deleted: false,
    });
    if (erreur) {
      journal({ nouveau_refuse: idCourt(g.id), erreur: court(erreur) });
      return null;
    }
    return "pulled";
  }

  const choix = choixLecture(existante, g, maintenant);
  if (choix === "rien") return null;
  if (choix === "garder_app") {
    if (g.etag && g.etag !== existante.google_etag) ecrireOuArreter(await base.ecrire(existante.id, { google_etag: g.etag }));
    return "garde";
  }
  // Dernier modifié gagne (Google), sous condition que la ligne n'ait pas bougé depuis la lecture.
  const r = await base.ecrireSiInchangee(existante, {
    ...champs,
    google_etag: g.etag ?? existante.google_etag,
    sync_source: "google",
    updated_at: g.updated ?? maintenant,
    last_synced_at: maintenant,
    deleted: false,
    deleted_at: null,
  });
  if (r.erreur) {
    journal({ lecture_refusee: idCourt(existante.id), erreur: court(r.erreur) });
    return null;
  }
  if (r.ecrite) return "pulled";
  // Modifiée dans l'app pendant la lecture : sa version est la plus récente et repartira. On retient
  // l'etag de Google pour que cet envoi passe.
  if (g.etag) ecrireOuArreter(await base.ecrire(existante.id, { google_etag: g.etag }));
  return "garde";
}

/**
 * Envoie une ligne et écrit ce qui en découle. Renvoie true quand un 412 a été tranché pour l'app :
 * la ligne est à renvoyer tout de suite (avec l'etag relu).
 */
async function envoyerLigne<L extends LigneEvent>(
  base: BaseAgenda<L>,
  google: GoogleAgenda<L>,
  ligne: L,
  bilan: BilanSync,
  journal: Journal,
  horloge: () => string,
  trancher: boolean,
): Promise<boolean> {
  const action = actionGoogle(ligne);
  let statut = 0;
  let g: EvenementGoogle = {};
  if (action !== "aucune") ({ statut, g } = await google.envoyer(action, ligne));
  const issue = issueEnvoi(action, statut, g);
  noterEnvoi(bilan, action, issue, statut);
  const id = idCourt(ligne.id);

  if (issue === "conflit") {
    journal({ conflit: id, ...(trancher ? {} : { encore: true }) });
    // Second envoi encore en 412 (Google a rechangé entre-temps) : on s'arrête là, le passage suivant reprendra.
    if (!trancher || !ligne.google_event_id) return false;
    const relu = await google.lire(ligne.google_event_id);
    if (!relu.g || !reussi(relu.statut)) {
      journal({ conflit_non_relu: id, statut: relu.statut });
      return false;
    }
    const r = await appliquerLecture(base, google, relu.g, horloge(), journal);
    if (r === "pulled") bilan.pulled++;
    else if (r === "deleted") bilan.deleted++;
    return r === "garde";
  }
  if (issue === "absent") journal({ absent_de_google: id, statut, recree_au_passage_suivant: true });
  else if (issue === "refus") journal({ refus_google: id, action, statut, ...(reussi(statut) ? { reponse_sans_id: true } : {}) });

  const e = ecrituresApresEnvoi(action, issue, horloge(), ligne, g);
  if (e.marquer) {
    const r = await base.ecrireSiInchangee(ligne, e.marquer);
    if (r.ecrite) return false;
    if (r.erreur) journal({ ecriture_refusee: id, erreur: court(r.erreur) });
  }
  // Modifiée pendant l'envoi, écriture refusée, ou rien à marquer : on garde ce que Google vient de donner,
  // sans marquer ; la ligne reste « à envoyer » pour le passage suivant.
  if (e.sinon) {
    const erreur = await base.ecrire(ligne.id, e.sinon);
    if (erreur) journal({ ecriture_refusee: id, erreur: court(erreur) });
  }
  return false;
}

/**
 * Envoie vers Google les rendez-vous écrits par l'app ou par Alfred depuis leur dernier envoi, et note
 * chaque réponse dans le bilan. Une ligne dont le 412 a été tranché pour l'app repart une seule fois,
 * relue (updated_at et etag frais), à la fin.
 */
export async function envoyerVersGoogle<L extends LigneEvent>(
  base: BaseAgenda<L>,
  google: GoogleAgenda<L>,
  bilan: BilanSync,
  journal: Journal,
  horloge: () => string = () => new Date().toISOString(),
): Promise<void> {
  const aRenvoyer = new Set<string>();
  for (const ligne of (await base.lignesAgence()).filter(aEnvoyer)) {
    if (await envoyerLigne(base, google, ligne, bilan, journal, horloge, true)) aRenvoyer.add(ligne.id);
  }
  if (!aRenvoyer.size) return;
  for (const ligne of (await base.lignesAgence()).filter((l) => aRenvoyer.has(l.id) && aEnvoyer(l))) {
    await envoyerLigne(base, google, ligne, bilan, journal, horloge, false);
  }
}
