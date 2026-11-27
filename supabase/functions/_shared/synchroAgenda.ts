// ============================================================================
// _shared/synchroAgenda.ts : les décisions de la synchro Google Agenda (quoi envoyer, quoi
// marquer, que faire d'une réponse de Google), sans réseau ni base.
// ----------------------------------------------------------------------------
// Utilisé par runSyncCycle (_shared/google.ts), testé par synchroAgenda.test.ts.
//
// Boucle arrêtée le 27/11/2026 : après un envoi réussi, le code écrivait updated_at =
// last_synced_at, mais le déclencheur touch_updated_at remet updated_at à now() pour toute
// écriture serveur dont sync_source n'est pas 'google'. Les rendez-vous de l'app restaient donc
// « à envoyer » : ils repartaient vers Google à chaque passage, chaque envoi relançait le webhook,
// et ainsi de suite (des dizaines de milliers d'appels par jour). Maintenant, un envoi réussi
// passe sync_source à 'google' : le déclencheur garde l'updated_at écrit et la ligne sort de la
// file. Une modification de l'app ou d'Alfred la remet à 'agence' (src/lib/db.ts, ttp-mcp), donc
// elle repart.
//
// Course : une modification faite pendant un passage (entre la lecture et l'écriture qui suit)
// ne doit jamais être marquée synchronisée sans être partie. Toute écriture qui marque une ligne
// se fait donc SOUS CONDITION que updated_at n'ait pas bougé depuis la lecture. Si elle a bougé,
// on garde seulement l'id et l'etag donnés par Google, et la ligne repart au passage suivant avec
// sa nouvelle version.
//
// 404 ou 410 sur une modification : le rendez-vous n'existe plus chez Google (supprimé là-bas, ou
// un autre agenda). Avant, l'id Google était effacé et le passage suivant le recréait. Il n'est
// plus jamais recréé tout seul : la ligne garde son id, sort de la file et le journal le dit. Si
// Google annonce la suppression, la lecture le marque supprimé dans l'app.
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

const instant = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : Number.NaN);

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

/**
 * Ce que veut dire la réponse de Google :
 * - « envoye » : Google a pris la version de l'app (ou le rendez-vous à supprimer n'y est déjà plus) ;
 * - « absent » : 404 ou 410 sur une modification, plus chez Google, jamais recréé tout seul ;
 * - « conflit » : 412, modifié des deux côtés depuis le dernier passage, la lecture de Google tranche ;
 * - « refus » : autre réponse (403, 429 ou 5xx après les essais…), rien n'est marqué, réessayé au
 *   passage suivant.
 */
export type IssueEnvoi = "envoye" | "absent" | "conflit" | "refus";

export function issueEnvoi(action: ActionGoogle, statut: number): IssueEnvoi {
  if (action === "aucune") return "envoye";
  if (statut >= 200 && statut < 300) return "envoye";
  if (statut === 404 || statut === 410) {
    if (action === "supprimer") return "envoye";
    if (action === "modifier") return "absent";
  }
  if (statut === 412 && action === "modifier") return "conflit";
  return "refus";
}

/** Ce que Google renvoie d'utile après une création ou une modification. */
export interface ReponseGoogle {
  id?: string;
  etag?: string;
}

/**
 * Les écritures en base après la réponse de Google (null : rien à écrire).
 * - `marquer` : à écrire SOUS CONDITION que updated_at n'ait pas bougé depuis la lecture.
 *   updated_at = last_synced_at = maintenant et sync_source = 'google', sinon le déclencheur
 *   remet updated_at à now() et la ligne repart (la boucle).
 * - `siModifiee` : à écrire si cette condition a échoué (ligne modifiée pendant l'envoi). Garde
 *   seulement ce que Google vient de donner, sans marquer : la ligne repart au passage suivant.
 */
export interface Ecritures {
  marquer: Record<string, unknown> | null;
  siModifiee: Record<string, unknown> | null;
}

export function ecrituresApresEnvoi(
  action: ActionGoogle,
  issue: IssueEnvoi,
  maintenant: string,
  ligne: Pick<LigneSync, "google_etag">,
  g: ReponseGoogle = {},
): Ecritures {
  if (issue === "conflit" || issue === "refus") return { marquer: null, siModifiee: null };
  const synchronise = { last_synced_at: maintenant, updated_at: maintenant, sync_source: "google" };
  // L'id Google est gardé : la lecture pourra encore marquer le rendez-vous supprimé si Google l'annonce.
  if (issue === "absent") return { marquer: synchronise, siModifiee: null };
  switch (action) {
    case "creer": {
      // Sans id, la création n'est pas reconnue : rien n'est marqué (réponse de Google illisible).
      if (!g.id) return { marquer: null, siModifiee: null };
      // L'id est gardé même si la ligne a bougé : sinon le passage suivant créerait un doublon chez Google.
      const ids = { google_event_id: g.id, google_etag: g.etag ?? null };
      return { marquer: { ...ids, ...synchronise }, siModifiee: ids };
    }
    case "modifier":
      // Le nouvel etag est gardé même si la ligne a bougé : sinon le prochain envoi tomberait sur un 412.
      return {
        marquer: { google_etag: g.etag ?? ligne.google_etag, ...synchronise },
        siModifiee: g.etag ? { google_etag: g.etag } : null,
      };
    case "supprimer":
      // Déjà parti de Google. Si la ligne a été restaurée entre-temps, l'id effacé la fait recréer
      // une fois, avec la version de l'app.
      return { marquer: synchronise, siModifiee: { google_event_id: null, google_etag: null } };
    case "aucune":
      return { marquer: synchronise, siModifiee: null };
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
  /** 412 à l'envoi : la lecture de Google a tranché. */
  conflits: number;
  /** 404 ou 410 à une modification : plus chez Google, pas recréé. */
  absents: number;
  /** Autres refus de Google à l'envoi, réessayés au passage suivant (statuts dans statutsRefus). */
  refus: number;
  statutsRefus: number[];
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
    ms,
  };
}

/** La même ligne quand le passage a échoué (message raccourci). */
export function ligneErreur(contexte: Contexte, e: unknown, ms: number): Record<string, unknown> {
  const message = e instanceof Error ? e.message : String(e);
  return { ...contexte, erreur: message.slice(0, 300), ms };
}

const DECLENCHEURS = ["cron", "webhook", "renew", "manual"];

/** Qui a lancé google-sync, pour le journal : valeur connue de `trigger`, sinon l'app ou « inconnu ». */
export function declencheurSync(trigger: unknown, via: "cron" | "agency" | undefined): string {
  if (typeof trigger === "string" && DECLENCHEURS.includes(trigger)) return trigger;
  return via === "agency" ? "app" : "inconnu";
}
