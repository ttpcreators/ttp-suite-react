// ============================================================================
// _shared/oauthRetour.ts : les adresses de retour (redirect_uri) du connecteur ttp-mcp.
// Règles PURES, testées par oauthRetour.test.ts, partagées par le serveur (ttp-mcp/oauth.ts)
// et par la page d'accord (src/connecteur/main.tsx).
//   • adresseRetourAutorisee : Claude (claude.ai, claude.com : seulement son rappel
//     /api/mcp/auth_callback, depuis le 2026-11-28), ChatGPT (seulement ses deux
//     adresses de rappel officielles pour les connecteurs) et les agents en local (Claude Code).
//   • destinationRetour : ce que la page d'accord affiche, tiré de l'adresse de retour réelle et
//     jamais du nom que l'application se donne elle même à l'enregistrement.
// ============================================================================

const CLAUDE = ["claude.ai", "claude.com", "www.claude.ai", "www.claude.com"];
const LOCAL = ["localhost", "127.0.0.1"];
/** Rappel stable des connecteurs ChatGPT (doc OpenAI, Apps SDK › Authentication). */
export const CHATGPT_RAPPEL = "https://chatgpt.com/connector_platform_oauth_redirect";
/** Rappel propre à une connexion ChatGPT : https://chatgpt.com/connector/oauth/{callback_id}. */
const CHATGPT_PAR_CONNEXION = /^\/connector\/oauth\/[A-Za-z0-9_-]{1,128}$/;

function lire(u: string): URL | null {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

/** Rappel des connecteurs de Claude (claude.ai, claude.com). */
export const CLAUDE_RAPPEL = "/api/mcp/auth_callback";

/** Rappel de Claude, au caractère près : https, hôte de Claude, chemin officiel, rien d'autre. */
function rappelClaude(x: URL): boolean {
  if (x.protocol !== "https:" || !CLAUDE.includes(x.hostname) || x.port || x.username || x.password || x.search || x.hash) return false;
  return x.pathname === CLAUDE_RAPPEL;
}

/** Adresse de rappel officielle d'un connecteur ChatGPT, au caractère près (rien d'autre sur chatgpt.com). */
function rappelChatgpt(x: URL): boolean {
  if (x.protocol !== "https:" || x.hostname !== "chatgpt.com" || x.port || x.username || x.password || x.search || x.hash) return false;
  return x.pathname === "/connector_platform_oauth_redirect" || CHATGPT_PAR_CONNEXION.test(x.pathname);
}

/** Adresses de retour acceptées : Claude (web, ordinateur, téléphone), ChatGPT (rappels officiels) et les agents en local. */
export function adresseRetourAutorisee(u: string): boolean {
  const x = lire(u);
  if (!x) return false;
  if (CLAUDE.includes(x.hostname)) return rappelClaude(x);
  if (x.hostname === "chatgpt.com") return rappelChatgpt(x);
  if (x.protocol === "http:" && LOCAL.includes(x.hostname)) return true;
  return false;
}

export type Destination = {
  /** Où le code de connexion repart vraiment (hôte, et port pour une adresse locale). */
  hote: string;
  /** Phrase courte pour la page d'accord. */
  texte: string;
  /** Adresse locale : une application lancée sur l'ordinateur qui a ouvert la page. */
  locale: boolean;
};

/** Ce que la page d'accord montre de l'adresse de retour (null : adresse refusée). */
export function destinationRetour(u: string): Destination | null {
  if (!adresseRetourAutorisee(u)) return null;
  const x = new URL(u);
  if (LOCAL.includes(x.hostname)) {
    const hote = `${x.hostname}${x.port ? `:${x.port}` : ""}`;
    return { hote, texte: `une application lancée sur cet ordinateur (${hote}), par exemple Claude Code`, locale: true };
  }
  if (x.hostname === "chatgpt.com") return { hote: x.hostname, texte: "ChatGPT (chatgpt.com)", locale: false };
  return { hote: x.hostname, texte: `Claude (${x.hostname})`, locale: false };
}

/**
 * Alerte envoyée aux fondateurs à chaque nouvelle connexion (ttp-mcp/oauth.ts, approve) :
 * qui l'a autorisée, où le code repart, et si c'est une connexion d'agent.
 */
export function alerteNouvelleConnexion(nom: string, redirect: string, agent: boolean): { titre: string; texte: string } {
  const qui = nom.trim().slice(0, 40) || "Un compte de l'agence";
  const ou = destinationRetour(redirect)?.texte ?? "une adresse inconnue";
  return {
    titre: "Nouvelle connexion Claude",
    texte: `${qui} vient d'autoriser une connexion vers ${ou}${agent ? " (agent autonome)" : ""}. Si ce n'est pas vous, coupez-la dans Paramètres › Connexions Claude.`,
  };
}

/** Marge pendant laquelle un jeton de renouvellement tout juste remplacé peut être présenté de nouveau (deux appels en même temps). */
export const MARGE_REUTILISATION_MS = 30_000;

/**
 * Un jeton de renouvellement déjà remplacé est présenté de nouveau : vol probable (le voleur ou
 * Claude a encore l'ancien), toute la connexion est coupée. Pas dans les 30 s qui suivent le
 * remplacement : deux renouvellements partis en même temps.
 */
export function reutilisationSuspecte(revoqueLe: string | null | undefined, maintenant = Date.now()): boolean {
  if (!revoqueLe) return false;
  const t = Date.parse(revoqueLe);
  return Number.isFinite(t) && maintenant - t > MARGE_REUTILISATION_MS;
}
