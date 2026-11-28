/**
 * File « À valider » de la page Agents (table `agent.actions`) : logique pure.
 *
 * - Ce que « Valider » déclenche pour chaque proposition (inchangé depuis le 17/11/2026) :
 *   un mail d'Alfred passe en « valide » (Alfred l'envoie dans la minute), tout autre message
 *   passe en « envoye » (Marc l'a copié et envoyé lui même). Nouveau type « avancer_collab » :
 *   l'app fait avancer la collab, puis la proposition passe en « envoye ». Un appel d'outil
 *   proposé par un agent (colonne `outil`, verrou des agents du connecteur) passe en « valide » :
 *   l'agent le fait ensuite, et le serveur le marque « envoye ». Depuis le 27/11, un mail
 *   déposé par une connexion cochée « agent autonome » (Paramètres › Connexions Claude) passe
 *   aussi en « valide », comme un mail d'Alfred : sans cela, le serveur ne trouverait jamais la
 *   validation qu'il exige de cette connexion.
 * - Ce que « Modifier » permet : le texte en ligne pour un message à copier (WhatsApp,
 *   Instagram, LinkedIn) ; un brouillon Gmail ou Spark s'ouvre là où il vit (son circuit
 *   d'envoi ne change pas) ; le reste ne se modifie pas.
 * - Les raccourcis clavier de la file, et la trace avant / après d'un texte modifié, que
 *   l'agent relit (outil `a_valider` avec `modifications`).
 */
import { STEP_COUNT } from "./collabs";
import { couper } from "../../supabase/functions/_shared/texteSur.ts";

export type PropositionLite = {
  id: string;
  type: string;
  cible: string | null;
  contexte: string | null;
  contenu: string | null;
  lien_spark: string | null;
  agent_id?: string | null;
  /** Appel d'outil exact proposé par un agent (SQL 2026-11-27-securite-alfred). */
  outil?: unknown;
  /**
   * Déposée par une connexion du connecteur cochée « agent autonome » (calculé par la page
   * Agents d'après grant_id et connexions_claude(), SQL 2026-11-27-verrou-connexions).
   */
  connexion_agent?: boolean;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Seul hôte accepté pour un lien « avancer la collab » (celui que construit proposer_action). */
export const HOTE_APP = "app.ttpcreators.pro";

/**
 * Proposition « avancer la collab » : type `avancer_collab`, ou `alerte` déposée avant le SQL
 * du 23/11/2026 (la base refusait encore ce type). Dans les deux cas, le lien porte la collab
 * et l'étape : `…/?open=view&view=collabs&item=<id>&avancer=1&etape=<n>` (outil proposer_action).
 */
export function avanceCollabOf(a: Pick<PropositionLite, "type" | "lien_spark">): { collabId: string; etape: number } | null {
  if (a.type !== "avancer_collab" && a.type !== "alerte") return null;
  if (!a.lien_spark) return null;
  let u: URL;
  try {
    u = new URL(a.lien_spark);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== HOTE_APP) return null;
  const q = u.searchParams;
  if (q.get("avancer") !== "1" || q.get("view") !== "collabs") return null;
  const collabId = q.get("item") ?? "";
  const etape = Number(q.get("etape"));
  if (!UUID_RE.test(collabId) || !Number.isInteger(etape) || etape < 1 || etape > STEP_COUNT) return null;
  return { collabId, etape };
}

/** Type affiché (une alerte de repli qui avance une collab s'affiche comme telle). */
export function typeAffiche(a: Pick<PropositionLite, "type" | "lien_spark">): string {
  return avanceCollabOf(a) ? "avancer_collab" : a.type;
}

export type GesteValider =
  /** Mail d'Alfred ou d'une connexion « agent autonome » : statut « valide », l'agent l'envoie. */
  | "alfred_envoie"
  /** Appel d'outil proposé par un agent : statut « valide », l'agent le fait. */
  | "alfred_fait"
  /** L'app fait avancer la collab, puis statut « envoye ». */
  | "avancer_collab"
  /** Message à copier (WhatsApp, DM, LinkedIn) : copié, statut « envoye ». */
  | "copier_envoye"
  /** Le reste (alerte, mail d'un autre agent) : statut « envoye », comme « Marquer envoyé ». */
  | "marquer_envoye";

const A_COPIER = ["whatsapp", "instagram", "linkedin"];

export function gesteValider(a: PropositionLite, alfredId: string | null): GesteValider {
  if (avanceCollabOf(a)) return "avancer_collab";
  // Un mail : le serveur range lui même le brouillon dans `outil` (verrou des agents, 28/11) ;
  // c'est toujours un mail que l'agent envoie, pas un appel d'outil.
  if (a.type === "brouillon_mail" && ((!!alfredId && a.agent_id === alfredId) || a.connexion_agent === true)) return "alfred_envoie";
  if (a.outil != null && a.type !== "brouillon_mail") return "alfred_fait";
  if (A_COPIER.includes(a.type) && !!a.contenu?.trim()) return "copier_envoye";
  return "marquer_envoye";
}

/** Statut écrit en base pour ce geste (avancer_collab : après l'avance réussie). */
export function statutApresValidation(g: GesteValider): "valide" | "envoye" {
  return g === "alfred_envoie" || g === "alfred_fait" ? "valide" : "envoye";
}

export type ModeModifier = "texte" | "lien" | null;

/**
 * « Modifier » : le texte en ligne pour un message à copier ; un brouillon de mail (Gmail ou
 * Spark) ou une collab s'ouvre par son lien, sans toucher au circuit d'envoi ; sinon rien.
 */
export function modeModifier(a: PropositionLite): ModeModifier {
  if (avanceCollabOf(a)) return a.lien_spark ? "lien" : null;
  if (A_COPIER.includes(a.type)) return "texte";
  if (a.type === "brouillon_mail") return a.lien_spark ? "lien" : null;
  return null;
}

const norm = (s: string | null | undefined) => (s ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

/** Le texte a vraiment changé (espaces et retours en trop ignorés). */
export function texteModifie(avant: string | null | undefined, apres: string | null | undefined): boolean {
  return norm(avant) !== norm(apres);
}

// Coupe sans casser d'emoji : la trace va dans agent.journal, qui refuse une moitié seule (_shared/texteSur.ts).
const coupe = (s: string, max: number) => (s.length > max ? `${couper(s, max - 1)}…` : s);

/**
 * Entrée du journal des agents (`marc_modifie`) : ce que l'agent avait écrit et ce que Marc a
 * validé. L'agent la relit pour apprendre (outil `a_valider`, `modifications`).
 */
export function detailModification(a: Pick<PropositionLite, "id" | "type" | "cible">, avant: string, apres: string, max = 1500): string {
  return [
    `${a.type}${a.cible ? ` · ${a.cible}` : ""} [proposition ${a.id}]`,
    `Avant : ${coupe(norm(avant), max)}`,
    `Après : ${coupe(norm(apres), max)}`,
  ].join("\n");
}

/**
 * Nouvelle étape d'une collab validée depuis la file : jamais en arrière ni sur place, jamais
 * une collab perdue ou archivée (null).
 * La dernière étape passe une collab en cours à « gagnée », comme dans la page Collabs.
 */
export function patchEtape(cur: { step: number; status: string | null }, etape: number): { step: number; status?: string } | null {
  if (cur.status === "perdue" || cur.status === "archivee") return null;
  const step = Math.min(STEP_COUNT, Math.max(1, Math.round(etape)));
  if (!Number.isFinite(step) || step <= cur.step) return null;
  return step === STEP_COUNT && cur.status === "active" ? { step, status: "gagnee" } : { step };
}

/**
 * En-tête d'un mail dont le serveur a lu le brouillon (proposer_action, 28/11) : De, Objet, À,
 * Cc, Cci, tels que le serveur les a écrits dans contexte. Toujours affichés en entier en tête de
 * la carte. Vide pour une autre proposition (le texte d'un agent n'est jamais présenté ainsi).
 */
export function lignesMail(a: Pick<PropositionLite, "type" | "contexte" | "outil">): string[] {
  const o = a.outil && typeof a.outil === "object" ? (a.outil as { nom?: unknown }) : null;
  if (a.type !== "brouillon_mail" || o?.nom !== "envoyer_brouillon" || !a.contexte) return [];
  return a.contexte.split(" · ").filter((x) => /^(De|Objet|À|Cc|Cci) : /.test(x));
}

export type Geste = "valider" | "modifier" | "ecarter" | "suivante" | "precedente" | "cocher" | "valider_selection";

/**
 * Raccourcis de la file : V valider, M modifier, E écarter, flèches (ou J / K) pour passer
 * d'une proposition à l'autre, Espace ou X pour cocher, Maj + V pour valider la sélection.
 * Rien quand on écrit dans un champ ou avec Ctrl, Cmd ou Alt.
 */
export function gesteClavier(e: { key: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; dansUnChamp?: boolean }): Geste | null {
  if (e.dansUnChamp || e.ctrlKey || e.metaKey || e.altKey) return null;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === "v") return e.shiftKey ? "valider_selection" : "valider";
  if (e.shiftKey) return null;
  switch (k) {
    case "m": return "modifier";
    case "e": return "ecarter";
    case "ArrowDown": case "j": return "suivante";
    case "ArrowUp": case "k": return "precedente";
    case " ": case "x": return "cocher";
    default: return null;
  }
}

/** Position suivante / précédente, bornée à la liste (pas de tour complet). */
export function positionVoisine(i: number, n: number, sens: 1 | -1): number {
  if (n <= 0) return 0;
  return Math.min(n - 1, Math.max(0, i + sens));
}

/**
 * Propositions cochées que « Valider (n) » peut traiter d'un coup : jamais celles dont la
 * validation copie un texte (WhatsApp, DM, LinkedIn), ni un mail qu'un agent enverra, ni un
 * appel d'outil d'un agent : chacun se lit en entier et se valide seul.
 */
const PAS_EN_LOT: GesteValider[] = ["copier_envoye", "alfred_envoie", "alfred_fait"];
export function validablesEnLot<T extends PropositionLite>(cochees: T[], alfredId: string | null): T[] {
  return cochees.filter((a) => !PAS_EN_LOT.includes(gesteValider(a, alfredId)));
}

/**
 * Position de la proposition courante, retrouvée par son id (une nouvelle proposition arrivée
 * en tête ne change pas de cible). Disparue (validée, écartée) : celle qui a pris sa place.
 */
export function positionCourante(ids: string[], courantId: string | null, dernierePosition: number): number {
  if (!ids.length) return 0;
  const k = courantId ? ids.indexOf(courantId) : -1;
  if (k >= 0) return k;
  return Math.min(ids.length - 1, Math.max(0, dernierePosition));
}
