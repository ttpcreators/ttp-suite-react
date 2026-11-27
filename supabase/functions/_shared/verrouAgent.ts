// ============================================================================
// _shared/verrouAgent.ts : le verrou des agents autonomes sur le connecteur ttp-mcp.
// Règles PURES, testées par verrouAgent.test.ts ; l'accès à la base est dans ttp-mcp/verrou.ts.
// ----------------------------------------------------------------------------
// Une connexion marquée « agent » (Alfred, colonne mcp_grants.agent) n'envoie rien et ne fait
// rien d'irréversible sans une validation faite par un compte agence dans l'app :
//   • brouillons (envoyer_brouillon, envoyer_brouillons_valides, programmer_envoi) : chaque id
//     doit figurer dans une proposition « brouillon_mail » validée dans la page Agents, et le
//     brouillon ne doit pas avoir changé depuis la validation ;
//   • outils à valider (versement, facture, suppression, réglages, invitation Google à une
//     adresse hors de l'agence) : une proposition validée qui porte EXACTEMENT cet appel
//     (proposer_action avec `outil`), utilisée une seule fois ;
//   • envoyer_mail et envoyer_dm : jamais pour un agent (brouillon validé, ou Marc envoie lui même).
// Les connexions de Marc et de l'équipe ne passent jamais par ici.
// ============================================================================

import { str } from "./texteSur.ts";

type Args = Record<string, unknown>;

export type Besoin =
  | { genre: "brouillon"; ids: string[] }
  | { genre: "outil" }
  | { genre: "interdit"; raison: string }
  | null;

/** Une validation garde sa valeur 7 jours (au delà, la situation a pu changer : on repropose). */
export const VALIDATION_JOURS = 7;

/** Outils qu'un agent ne lance qu'avec un appel validé (proposer_action avec `outil`). */
export const OUTILS_A_VALIDER = ["noter_reversement", "modifier_element", "supprimer_element", "reglages_app", "preparer_facture", "creer_meet", "inviter_rdv"] as const;

// Les textes reçus sont lus par str (_shared/texteSur.ts), la même lecture que les outils
// (tools.ts, admin.ts, envois.ts) : un écart ouvrirait une porte.
const ID_BROUILLON = /^[A-Za-z0-9_-]+$/;

function idsBrouillons(v: unknown): string[] {
  return [...new Set((Array.isArray(v) ? v : []).map((x) => str(x, 64)).filter((x) => ID_BROUILLON.test(x)))];
}

const EMAIL = /[^\s<>,;"'()]+@[^\s<>,;"'()]+\.[^\s<>,;"'()]+/g;

/** Au moins une adresse hors du domaine de l'agence (ou illisible : comptée comme externe). */
export function inviteExterne(invites: unknown, agence: string): boolean {
  const dom = agence.toLowerCase().replace(/^@/, "");
  for (const brut of Array.isArray(invites) ? invites : []) {
    const t = String(brut ?? "").trim();
    if (!t) continue;
    const adresses = t.match(EMAIL) ?? [];
    if (!adresses.length) return true;
    if (adresses.some((a) => a.toLowerCase().split("@").pop() !== dom)) return true;
  }
  return false;
}

/** Ce qu'un appel d'agent demande avant de partir (null : rien, l'outil tourne comme d'habitude). */
export function besoinValidation(nom: string, a: Args, agence: string): Besoin {
  switch (nom) {
    case "envoyer_brouillon": {
      const id = str(a.brouillon, 64);
      return { genre: "brouillon", ids: ID_BROUILLON.test(id) ? [id] : [] };
    }
    case "envoyer_brouillons_valides":
    case "programmer_envoi":
      return { genre: "brouillon", ids: idsBrouillons(a.brouillons) };
    case "envoyer_mail":
      return { genre: "interdit", raison: "un agent n'envoie un mail que depuis un brouillon validé : creer_brouillon_mail, puis proposer_action (type brouillon_mail, « brouillon <id> · boîte <boîte> » dans contexte) ; Marc le valide dans la page Agents, puis envoyer_brouillon" };
    case "envoyer_dm":
      return { genre: "interdit", raison: "un agent n'envoie pas de DM : proposer_action (type instagram) avec le texte exact, Marc l'envoie depuis la page Agents" };
    case "noter_reversement":
    case "supprimer_element":
      return { genre: "outil" };
    case "modifier_element":
      return str(a.table, 40) === "invoices" ? { genre: "outil" } : null;
    case "reglages_app":
      return str(a.action) === "lire" ? null : { genre: "outil" };
    case "preparer_facture": {
      // Une nouvelle facture en brouillon reste libre ; modifier une facture ou changer un statut, non.
      const statut = str(a.statut);
      return str(a.id) || str(a.ref) || (statut && statut !== "brouillon") ? { genre: "outil" } : null;
    }
    case "creer_meet":
      return a.inviter === true && inviteExterne(a.invites, agence) ? { genre: "outil" } : null;
    case "inviter_rdv":
      return a.envoyer === true && inviteExterne(a.invites, agence) ? { genre: "outil" } : null;
    default:
      return null;
  }
}

/** JSON stable (clés triées) : deux appels identiques donnent le même texte. */
export function canonique(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canonique(x))).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonique(o[k])}`).join(",")}}`;
}

export type OutilPropose = { nom: string; arguments: Args };

/** L'outil d'une proposition (colonne agent.actions.outil), ou null s'il est illisible. */
export function lireOutil(v: unknown): OutilPropose | null {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  if (!o || typeof o.nom !== "string") return null;
  const args = o.arguments && typeof o.arguments === "object" && !Array.isArray(o.arguments) ? (o.arguments as Args) : {};
  return { nom: o.nom, arguments: args };
}

export function memeAppel(p: OutilPropose, nom: string, a: Args): boolean {
  return p.nom === nom && canonique(p.arguments) === canonique(a);
}

/** L'id d'un brouillon cité tel quel (mot entier) dans un texte. */
export function citeBrouillon(texte: unknown, id: string): boolean {
  if (!id || typeof texte !== "string") return false;
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_-])${esc}([^A-Za-z0-9_-]|$)`).test(texte);
}

export type Validation = {
  id: string;
  type: string;
  contexte: string | null;
  lien_spark: string | null;
  outil: unknown;
  valide_par: string | null;
  valide_le: string | null;
};

/** Validation encore valable : faite par un compte agence connu, il y a moins de 7 jours. */
export function validationValable(v: Validation, comptesAgence: Set<string>, maintenant: number): boolean {
  if (!v.valide_par || !comptesAgence.has(v.valide_par) || !v.valide_le) return false;
  const t = Date.parse(v.valide_le);
  return Number.isFinite(t) && t <= maintenant + 60_000 && maintenant - t <= VALIDATION_JOURS * 86_400_000;
}

/** La validation d'un brouillon : une proposition « brouillon_mail » qui cite son id. */
export function validationBrouillon(vs: Validation[], id: string, comptesAgence: Set<string>, maintenant: number): Validation | null {
  return vs.find((v) => v.type === "brouillon_mail" && (citeBrouillon(v.contexte, id) || citeBrouillon(v.lien_spark, id)) && validationValable(v, comptesAgence, maintenant)) ?? null;
}

/** La validation d'un appel d'outil : une proposition qui porte exactement cet appel. */
export function validationOutil(vs: Validation[], nom: string, a: Args, comptesAgence: Set<string>, maintenant: number): Validation | null {
  return vs.find((v) => {
    const p = lireOutil(v.outil);
    return !!p && memeAppel(p, nom, a) && validationValable(v, comptesAgence, maintenant);
  }) ?? null;
}

/** Le brouillon a changé après la validation (date du message Gmail plus récente). */
export function modifieApres(dateBrouillon: number, valideLe: string): boolean {
  const v = Date.parse(valideLe);
  if (!Number.isFinite(dateBrouillon) || dateBrouillon <= 0 || !Number.isFinite(v)) return true;
  return dateBrouillon > v;
}

const ENTETE = "Verrou agent : rien n'est parti, rien n'a été fait.";

export function refusInterdit(nom: string, raison: string): string {
  return `${ENTETE} ${nom} : ${raison}.`;
}

export function refusBrouillons(nom: string, manquants: { id: string; pourquoi: string }[]): string {
  return [
    `${ENTETE} ${nom} demande que chaque brouillon soit validé par Marc dans l'app.`,
    ...manquants.map((m) => `- ${m.id} : ${m.pourquoi}`),
    "Pour chacun : proposer_action (type brouillon_mail, « brouillon <id> · boîte <boîte> » dans contexte), Marc le valide dans la page Agents, puis tu l'envoies. Un « oui » sur Telegram ne suffit pas pour ce connecteur.",
  ].join("\n");
}

export function refusOutil(nom: string, a: Args): string {
  return [
    `${ENTETE} ${nom} demande une validation de Marc dans l'app pour cet appel précis.`,
    `Dépose-le avec proposer_action : type « alerte », outil = { "nom": "${nom}", "arguments": ${canonique(a)} }, et en contenu pourquoi (avec la preuve).`,
    "Marc le valide dans la page Agents, puis tu rappelles l'outil avec exactement les mêmes arguments (une seule fois). Un « oui » sur Telegram ne suffit pas pour ce connecteur.",
  ].join("\n");
}

/** Le texte que Marc lit dans la page Agents : l'appel exact, écrit par le serveur (jamais par l'agent). */
export function texteOutil(p: OutilPropose, titre: string, note: string): string {
  const lignes = Object.keys(p.arguments).sort().map((k) => {
    const v = p.arguments[k];
    // Une valeur sur plusieurs lignes ne peut pas imiter une autre ligne de la liste.
    return `- ${k} : ${typeof v === "string" ? v.replace(/[\r\n]+/g, " ⏎ ") : canonique(v)}`;
  });
  return [`Action demandée : ${titre} (${p.nom})`, ...(lignes.length ? lignes : ["- (sans paramètre)"]), ...(note ? ["", `Pourquoi : ${note}`] : [])].join("\n");
}

/**
 * Un appel proposé par un agent (proposer_action avec `outil`) : un outil à valider, des
 * paramètres de cet outil seulement (une clé inventée pourrait tromper la lecture de Marc).
 * Renvoie la raison d'un refus, ou null.
 */
export function problemeOutilPropose(p: OutilPropose | null, proprietes: string[] | null): string | null {
  if (!p) return "outil illisible : { \"nom\": \"…\", \"arguments\": { … } }";
  if (!(OUTILS_A_VALIDER as readonly string[]).includes(p.nom)) {
    return `« ${p.nom} » ne se valide pas ainsi (outils : ${OUTILS_A_VALIDER.join(", ")} ; un mail passe par un brouillon validé)`;
  }
  if (!proprietes) return `outil ${p.nom} introuvable`;
  const inconnues = Object.keys(p.arguments).filter((k) => !proprietes.includes(k));
  if (inconnues.length) return `paramètres inconnus de ${p.nom} : ${inconnues.join(", ")}`;
  if (canonique(p.arguments).length > 4000) return "paramètres trop longs (4 000 caractères au plus)";
  return null;
}
