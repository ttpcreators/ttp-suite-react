// ============================================================================
// _shared/verrouAgent.ts : le verrou des agents autonomes sur le connecteur ttp-mcp.
// Règles PURES, testées par verrouAgent.test.ts ; l'accès à la base est dans ttp-mcp/verrou.ts.
// ----------------------------------------------------------------------------
// Une connexion marquée « agent » (Alfred, colonne mcp_grants.agent) n'envoie rien et ne fait
// rien d'irréversible sans une validation faite par un compte agence dans l'app :
//   • brouillons (envoyer_brouillon, envoyer_brouillons_valides, programmer_envoi) : chaque id
//     doit avoir sa proposition « brouillon_mail » validée dans la page Agents. Le serveur a lu
//     lui même ce brouillon à la proposition (destinataires, objet, texte, pièces jointes) et
//     gardé son empreinte (outil = { nom: "envoyer_brouillon", arguments: { boite, brouillon },
//     empreinte }) : à l'envoi, le brouillon doit avoir la même empreinte (un seul brouillon par
//     proposition, ni l'id cité dans un texte ni le lien ne comptent) ;
//   • outils à valider (argent, accès, consignes durables des agents, pages publiques, crédits,
//     suppression, réglages, invitation Google à une adresse hors de l'agence) : une proposition
//     validée qui porte EXACTEMENT cet appel (proposer_action avec `outil`) ;
//   • une validation ne vaut que pour la connexion qui l'a proposée (grant_id) et ne sert qu'une
//     fois : elle est consommée (statut « envoye ») avant que l'outil tourne ;
//   • envoyer_mail et envoyer_dm : jamais pour un agent (brouillon validé, ou Marc envoie lui même).
// Les connexions de Marc et de l'équipe ne passent jamais par ici.
// Depuis le 27/11 (SQL 2026-11-27-verrou-connexions) :
//   • valideur de la connexion (mcp_grants.valideur, réglé par un fondateur dans Paramètres ›
//     Connexions Claude) : seule sa validation compte ; sans valideur, tout compte agence (avant) ;
//   • juste avant un envoi de la file, la validation doit tenir encore (validationTient) : pas
//     retirée, pas écartée, toujours d'un compte agence, et du valideur d'aujourd'hui ;
//   • la connexion qui a programmé l'envoi est relue (raisonConnexionFile) : cochée « agent
//     autonome » après la programmation, une ligne sans validation ne part pas.
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
// À garder égal à valides_app de agents/alfred/alfred.sh (CLAUDE.md, « Alfred »).
export const OUTILS_A_VALIDER = [
  "noter_reversement", "modifier_element", "supprimer_element", "reglages_app", "preparer_facture", "creer_meet", "inviter_rdv",
  // Depuis le 28/11 : argent, accès d'un créateur, consignes durables, pages publiques, crédits.
  "avancer_collab", "creer_element", "noter_droits", "noter_lecon", "ajouter_modele", "memoire_createur",
  "lien_boite_createur", "lien_connexion_instagram", "maj_chiffres_mediakit",
  "trouver_emails_marque", "trouver_email_personne", "scanner_base_createurs", "importer_historique_instagram",
] as const;

/** Outils qui envoient des brouillons (validation : une proposition brouillon_mail par id). */
export const OUTILS_BROUILLONS = ["envoyer_brouillon", "envoyer_brouillons_valides", "programmer_envoi"] as const;

/** Tables où toute création ou modification par un agent se valide (argent, accès, pages publiques, agenda). */
export const TABLES_A_VALIDER = ["invoices", "creators", "documents", "creator_mail_settings", "creator_roadmap", "agency_mediakit", "events", "email_sequences"] as const;

/** Collabs et prospects : les champs d'argent ou d'avancement qui se valident. */
const CHAMPS_A_VALIDER: Record<string, string[]> = {
  collabs: ["cachet", "step", "status"],
  prospects: ["value", "proposal", "status"],
};
/** À la création d'une collab ou d'un prospect : seulement quand un montant est posé. */
const MONTANTS_A_LA_CREATION: Record<string, string[]> = { collabs: ["cachet"], prospects: ["value", "proposal"] };

const objet = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const rempli = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";

/** Outils qui, appelés par un agent, se valident toujours (sans regarder les paramètres). */
const TOUJOURS = new Set([
  "noter_reversement", "supprimer_element", "noter_lecon", "ajouter_modele", "lien_boite_createur", "lien_connexion_instagram",
  "maj_chiffres_mediakit", "trouver_emails_marque", "trouver_email_personne", "scanner_base_createurs", "importer_historique_instagram",
]);

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
      return { genre: "interdit", raison: "un agent n'envoie un mail que depuis un brouillon validé : creer_brouillon_mail, puis proposer_action (type brouillon_mail, « brouillon <id> · boîte <boîte> » dans contexte) ; une fois validé dans la page Agents, envoyer_brouillon" };
    case "envoyer_dm":
      return { genre: "interdit", raison: "un agent n'envoie pas de DM : proposer_action (type instagram) avec le texte exact, Marc l'envoie depuis la page Agents" };
    case "modifier_element": {
      const table = str(a.table, 40);
      if ((TABLES_A_VALIDER as readonly string[]).includes(table)) return { genre: "outil" };
      const champs = Object.keys(objet(a.champs));
      return (CHAMPS_A_VALIDER[table] ?? []).some((c) => champs.includes(c)) ? { genre: "outil" } : null;
    }
    case "creer_element": {
      const table = str(a.table, 40);
      if ((TABLES_A_VALIDER as readonly string[]).includes(table)) return { genre: "outil" };
      const champs = objet(a.champs);
      return (MONTANTS_A_LA_CREATION[table] ?? []).some((c) => rempli(champs[c])) ? { genre: "outil" } : null;
    }
    case "avancer_collab": {
      // Facture envoyée, paiement reçu, créateur payé, bilan ; et tout retour en arrière.
      const etape = Number(a.etape);
      return !Number.isFinite(etape) || etape >= 8 || a.revenir === true ? { genre: "outil" } : null;
    }
    case "noter_droits":
      return rempli(a.prix) || a.clos !== undefined ? { genre: "outil" } : null;
    case "memoire_createur":
      return str(a.info) ? { genre: "outil" } : null;
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
      // Un invité externe ajouté sans mail serait prévenu par un second appel « envoyer » qui
      // n'ajoute qu'une adresse interne : l'ajout d'un externe se valide aussi, et tout envoi.
      return a.envoyer === true || inviteExterne(a.invites, agence) ? { genre: "outil" } : null;
    default:
      return TOUJOURS.has(nom) ? { genre: "outil" } : null;
  }
}

/** JSON stable (clés triées) : deux appels identiques donnent le même texte. */
export function canonique(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canonique(x))).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonique(o[k])}`).join(",")}}`;
}

export type OutilPropose = { nom: string; arguments: Args; empreinte?: string };

/** L'outil d'une proposition (colonne agent.actions.outil), ou null s'il est illisible. */
export function lireOutil(v: unknown): OutilPropose | null {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  if (!o || typeof o.nom !== "string") return null;
  const args = o.arguments && typeof o.arguments === "object" && !Array.isArray(o.arguments) ? (o.arguments as Args) : {};
  return { nom: o.nom, arguments: args, ...(typeof o.empreinte === "string" && o.empreinte ? { empreinte: o.empreinte } : {}) };
}

/** Nom de l'outil rangé par le serveur dans une proposition de mail (jamais proposable par un agent). */
export const OUTIL_BROUILLON = "envoyer_brouillon";

export type BrouillonPropose = { boite: string; brouillon: string; empreinte: string };

/** Le brouillon rangé par le serveur dans une proposition brouillon_mail, ou null (ancienne proposition, ou autre chose). */
export function brouillonDe(v: { type: string; outil: unknown }): BrouillonPropose | null {
  if (v.type !== "brouillon_mail") return null;
  const p = lireOutil(v.outil);
  if (!p || p.nom !== OUTIL_BROUILLON || !p.empreinte) return null;
  const boite = typeof p.arguments.boite === "string" ? p.arguments.boite : "";
  const brouillon = typeof p.arguments.brouillon === "string" ? p.arguments.brouillon : "";
  return boite && ID_BROUILLON.test(brouillon) ? { boite, brouillon, empreinte: p.empreinte } : null;
}

/** Même boîte (« partnerships », « talent » ou adresse d'une boîte de créateur), sans casse ni espaces. */
export const memeBoite = (a: unknown, b: unknown) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

/**
 * Le brouillon qu'un agent fait valider (proposer_action, type brouillon_mail) : le paramètre
 * `brouillon`, sinon le seul « brouillon <id> » de contexte. Plusieurs ids : refus (un brouillon
 * par proposition). La boîte : le paramètre `boite`, sinon « boîte <boîte> » de contexte.
 */
export function brouillonCite(a: Args): { brouillon: string; boite: string } | { erreur: string } {
  const contexte = str(a.contexte, 1000);
  const ids = [...new Set([...contexte.matchAll(/brouillon\s+([A-Za-z0-9_-]+)/gi)].map((m) => m[1]))];
  const donne = str(a.brouillon, 64);
  if (donne && !ID_BROUILLON.test(donne)) return { erreur: "id de brouillon illisible" };
  if (!donne && ids.length > 1) return { erreur: `un seul brouillon par proposition (contexte en cite ${ids.length} : ${ids.join(", ")})` };
  const brouillon = donne || ids[0] || "";
  if (!brouillon) return { erreur: "donne l'id du brouillon (paramètre brouillon, ou « brouillon <id> · boîte <boîte> » dans contexte)" };
  const boite = str(a.boite, 120) || (/bo[iî]te\s+([^\s·,;]+)/i.exec(contexte)?.[1] ?? "");
  if (!boite) return { erreur: "donne la boîte du brouillon (paramètre boite : partnerships, talent ou l'adresse d'une boîte de créateur)" };
  return { brouillon, boite };
}

/** Un brouillon tel que le serveur le lit dans Gmail (verrou des agents). */
export type BrouillonComplet = {
  message: string; // id Gmail du message : une modification du brouillon en crée un nouveau
  from: string; to: string; cc: string; bcc: string; subject: string;
  corps: string[]; // chaque partie texte ou HTML, décodée, dans l'ordre du message
  texte: string; // le texte lisible montré dans la page Agents
  pieces: { nom: string; type: string; taille: number }[];
  claude: boolean;
};

/**
 * Empreinte SHA-256 d'un brouillon : son message Gmail, ses en-têtes, ses parties et ses pièces
 * jointes. Deux lectures du même brouillon non modifié donnent la même empreinte.
 */
export async function empreinteBrouillon(b: BrouillonComplet): Promise<string> {
  const texte = canonique({ message: b.message, from: b.from, to: b.to, cc: b.cc, bcc: b.bcc, subject: b.subject, corps: b.corps, pieces: b.pieces });
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Ce que la page Agents montre d'un brouillon : écrit par le serveur d'après Gmail, jamais par l'agent. */
export function propositionBrouillon(b: BrouillonComplet, boite: string, brouillon: string): { cible: string; contexte: string; contenu: string } {
  // Sur une ligne, sans « · » : un objet ne peut pas imiter un autre champ de l'en-tête.
  const une = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/·/g, "•").trim();
  const dest = [`À : ${une(b.to) || "(personne)"}`, ...(b.cc ? [`Cc : ${une(b.cc)}`] : []), ...(b.bcc ? [`Cci : ${une(b.bcc)}`] : [])].join(" · ");
  const pieces = b.pieces.length ? `\n\nPièces jointes : ${b.pieces.map((p) => une(p.nom)).join(", ")}` : "";
  return {
    cible: dest.slice(0, 200),
    contexte: `brouillon ${brouillon} · boîte ${boite} · De : ${une(b.from) || boite} · Objet : ${une(b.subject) || "(sans objet)"} · ${dest}`.slice(0, 1000),
    contenu: `${b.texte || "(message vide)"}`.slice(0, 5800) + pieces,
  };
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
  /** Connexion qui a déposé la proposition (SQL 2026-11-27-verrou-connexions) ; absente avant. */
  grant_id?: string | null;
};

/** La proposition vient de cette connexion (une validation ne sert qu'à la connexion qui l'a proposée). */
export function memeConnexion(v: Validation, grantId: string | null | undefined): boolean {
  return !!grantId && !!v.grant_id && v.grant_id === grantId;
}

/**
 * Validation encore valable : faite par un compte agence connu, il y a moins de 7 jours, et par
 * le valideur de la connexion quand un fondateur en a choisi un (mcp_grants.valideur ; null =
 * tout compte agence, comme avant le 27/11).
 */
export function validationValable(v: Validation, comptesAgence: Set<string>, maintenant: number, valideur: string | null = null): boolean {
  if (!v.valide_par || !comptesAgence.has(v.valide_par) || !v.valide_le) return false;
  if (valideur && v.valide_par !== valideur) return false;
  const t = Date.parse(v.valide_le);
  return Number.isFinite(t) && t <= maintenant + 60_000 && maintenant - t <= VALIDATION_JOURS * 86_400_000;
}

/**
 * La validation d'un brouillon : la proposition « brouillon_mail » de CETTE connexion où le
 * serveur a rangé ce brouillon (et cette boîte). Un id cité dans un texte ou un lien ne compte pas.
 */
export function validationBrouillon(vs: Validation[], id: string, boite: unknown, comptesAgence: Set<string>, maintenant: number, valideur: string | null, grantId: string | null | undefined): Validation | null {
  return vs.find((v) => {
    const b = brouillonDe(v);
    return !!b && b.brouillon === id && memeBoite(b.boite, boite) && memeConnexion(v, grantId) && validationValable(v, comptesAgence, maintenant, valideur);
  }) ?? null;
}

/** La validation d'un appel d'outil : une proposition de cette connexion qui porte exactement cet appel. */
export function validationOutil(vs: Validation[], nom: string, a: Args, comptesAgence: Set<string>, maintenant: number, valideur: string | null, grantId: string | null | undefined): Validation | null {
  return vs.find((v) => {
    const p = lireOutil(v.outil);
    return !!p && p.nom !== OUTIL_BROUILLON && memeAppel(p, nom, a) && memeConnexion(v, grantId) && validationValable(v, comptesAgence, maintenant, valideur);
  }) ?? null;
}

/** Une proposition relue juste avant un envoi de la file (son statut compte en plus). */
export type PropositionRelue = Validation & { statut: string };

/**
 * Juste avant l'envoi d'un brouillon programmé par un agent : la validation tient-elle encore ?
 * null = oui ; sinon la raison. Statuts acceptés : « valide » (l'agent n'a encore rien dit) et
 * « envoye » (l'agent l'a marquée envoyée après l'avoir programmée). Remise « à valider »,
 * écartée (dans la page Agents, ou par l'agent lui même avec ecarter_proposition), envoyée à la
 * main après modification, supprimée, validée par un compte qui n'est plus de l'agence ou par un
 * autre que le valideur choisi aujourd'hui pour la connexion (`valideur`), ou qui ne cite plus ce
 * brouillon : le mail ne part pas. L'âge n'est pas revérifié ici : la file étale ses envois sur
 * plusieurs jours.
 */
export function validationTient(p: PropositionRelue | null, brouillon: string, comptesAgence: Set<string>, valideur: string | null = null): string | null {
  if (!p) return "validation introuvable dans la page Agents (proposition supprimée ?)";
  // Proposition du serveur (depuis le 28/11) : le brouillon rangé dans outil. Ligne de la file
  // programmée avant : l'id cité dans contexte (jamais le lien).
  const range = brouillonDe(p);
  const cite = range ? range.brouillon === brouillon : p.type === "brouillon_mail" && !lireOutil(p.outil) && citeBrouillon(p.contexte, brouillon);
  if (!cite) return "la proposition validée ne cite plus ce brouillon";
  if (p.statut === "ecarte") return "proposition écartée après sa validation (page Agents ou ecarter_proposition)";
  if (p.statut === "a_valider") return "validation retirée : la proposition attend de nouveau dans la page Agents";
  if (p.statut === "modifie_envoye") return "proposition déjà envoyée à la main après modification";
  if (p.statut !== "valide" && p.statut !== "envoye") return `proposition au statut « ${p.statut} »`;
  if (!p.valide_par || !p.valide_le) return "validation retirée dans la page Agents";
  if (!comptesAgence.has(p.valide_par)) return "validée par un compte qui n'est plus de l'agence";
  if (valideur && p.valide_par !== valideur) return "validée par un autre compte que le valideur choisi pour cette connexion (Paramètres › Connexions Claude)";
  return null;
}

/** La connexion qui a programmé un envoi de la file, telle qu'elle est maintenant. */
export type ConnexionFile = { agent: boolean; valideur: string | null };

/**
 * Juste avant l'envoi d'une ligne de la file : ce que dit la connexion qui l'a programmée
 * (envoi_file.grant_id), relue maintenant. `connexion` : undefined = ligne sans connexion notée
 * (programmée avant le SQL du 27/11, comme avant), null = connexion introuvable. Cochée « agent
 * autonome » après la programmation : une ligne sans validation ne part pas (la case vaut aussi
 * pour ce qui était déjà dans la file). Le valideur se vérifie avec la validation (validationTient).
 * Renvoie la raison de ne pas envoyer, ou null.
 */
export function raisonConnexionFile(valideLe: string | null | undefined, connexion: ConnexionFile | null | undefined): string | null {
  if (connexion === undefined) return null;
  if (connexion === null) return "connexion du connecteur introuvable (compte supprimé ?) : rien n'est parti";
  if (!valideLe && connexion.agent) return "connexion passée en agent autonome après la programmation : à faire valider dans la page Agents, puis à programmer de nouveau";
  return null;
}

/**
 * Le brouillon d'aujourd'hui n'est plus celui que la page Agents a montré : empreinte différente.
 * `validee` absente (proposition d'avant le 28/11, file seulement) : pas de comparaison.
 */
export function empreinteChangee(validee: string | null | undefined, actuelle: string): boolean {
  return !!validee && validee !== actuelle;
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

/** Ligne ajoutée aux refus quand la connexion a un valideur (seule sa validation compte). */
export function noteValideur(nom: string | null | undefined): string | null {
  return nom ? `Pour cette connexion, seule une validation de ${nom} compte.` : null;
}

/**
 * Les refus nomment qui valide : le valideur choisi pour la connexion (`valideur`, son nom
 * affiché), sinon « un fondateur ». Jamais « Marc » en dur : l'agent demanderait la validation
 * à quelqu'un dont elle ne compterait pas.
 */
export function refusBrouillons(nom: string, manquants: { id: string; pourquoi: string }[], valideur: string | null = null): string {
  const choisi = valideur?.trim() || null;
  const qui = choisi ?? "un fondateur";
  const note = noteValideur(choisi);
  return [
    `${ENTETE} ${nom} demande que chaque brouillon soit validé dans l'app, par ${qui}.`,
    ...manquants.map((m) => `- ${m.id} : ${m.pourquoi}`),
    `Pour chacun : proposer_action (type brouillon_mail, un seul brouillon par proposition : paramètres brouillon et boite, ou « brouillon <id> · boîte <boîte> » dans contexte ; le serveur lit lui même le brouillon et le montre tel quel), ${qui} le valide dans la page Agents, puis tu l'envoies sans le modifier. Un « oui » sur Telegram ne suffit pas pour ce connecteur.`,
    ...(note ? [note] : []),
  ].join("\n");
}

export function refusOutil(nom: string, a: Args, valideur: string | null = null): string {
  const choisi = valideur?.trim() || null;
  const qui = choisi ?? "un fondateur";
  const note = noteValideur(choisi);
  return [
    `${ENTETE} ${nom} demande une validation dans l'app pour cet appel précis, par ${qui}.`,
    `Dépose-le avec proposer_action : type « alerte », outil = { "nom": "${nom}", "arguments": ${canonique(a)} }, et en contenu pourquoi (avec la preuve).`,
    `Quand ${qui} l'a validé dans la page Agents, tu rappelles l'outil avec exactement les mêmes arguments, une seule fois (la validation sert à cet appel, même s'il échoue : reproposer alors). Un « oui » sur Telegram ne suffit pas pour ce connecteur.`,
    ...(note ? [note] : []),
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
