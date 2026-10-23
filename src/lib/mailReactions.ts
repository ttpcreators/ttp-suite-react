/*
 * Réactions emoji aux mails (page Mails agence), au format Gmail : règles PURES, testées par
 * mailReactions.test.ts. Le serveur (gmail-send `reaction`, gmail-thread `reaction`) construit
 * et lit le format ; ici on décide QUAND proposer une réaction, À QUI l'envoyer, et comment
 * regrouper les réactions d'un fil sous le message visé.
 *
 * Recommandations Gmail (doc « Email reactions ») : pas de réaction sur un message de liste
 * de diffusion, ni si To + Cc dépassent 20 destinataires, ni si notre adresse n'est pas en
 * To / Cc (on était en Cci) ; la réaction répond au message visé (In-Reply-To).
 */

export const QUICK_REACTIONS = ["❤️", "👍", "😂", "😮", "🙏", "🎉"] as const;

export type ReactionMsg = {
  id: string; from: string; to?: string; cc?: string; replyTo?: string; direction: "in" | "out";
  messageIdHeader?: string; inReplyTo?: string; references?: string;
  /** Emoji si ce message EST une réaction (gmail-thread, 2026-10-23). */
  reaction?: string;
  /** Message d'une liste de diffusion (en-tête List-Id). */
  list?: boolean;
};

export type ReactionPill = { emoji: string; who: string; mine: boolean; count: number };

const ADDR_RE = /[^\s<>"',;:()]+@[^\s<>"',;:()]+\.[^\s<>"',;:()]+/g;
const addrs = (v?: string | null) => (v?.match(ADDR_RE) ?? []).map((a) => a.toLowerCase());
const firstId = (v?: string | null) => (v ?? "").match(/<[^<>\s]+>/)?.[0] ?? (v ?? "").trim();

/** « Marc Maher <marc@…> » → « Marc » ; une adresse seule → la partie avant @. */
export function reactorName(from: string): string {
  const name = from.replace(/<[^>]*>/g, "").replace(/"/g, "").trim();
  const base = name && !name.includes("@") ? name : (addrs(from)[0] ?? "").split("@")[0];
  const first = base.split(/\s+/)[0] ?? "";
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : "";
}

/**
 * Sépare les réactions des vrais messages : une réaction dont le message visé est dans le
 * fil devient une pastille sous ce message ; sinon elle reste affichée comme un mail
 * (comme Gmail). Pastilles groupées par emoji (« ❤️ 2 »), « mine » si l'agence a réagi.
 */
export function splitReactions<T extends ReactionMsg>(msgs: T[]): { shown: T[]; pills: Map<string, ReactionPill[]> } {
  const byHeader = new Map<string, T>();
  for (const m of msgs) {
    const h = firstId(m.messageIdHeader);
    if (h) byHeader.set(h, m);
  }
  const pills = new Map<string, ReactionPill[]>();
  const shown: T[] = [];
  for (const m of msgs) {
    const target = m.reaction ? byHeader.get(firstId(m.inReplyTo)) : undefined;
    if (!m.reaction || !target || target === m) {
      shown.push(m);
      continue;
    }
    const list = pills.get(target.id) ?? [];
    const mine = m.direction === "out";
    const who = mine ? "Toi" : reactorName(m.from);
    const same = list.find((p) => p.emoji === m.reaction);
    if (same) {
      same.count += 1;
      same.mine ||= mine;
      if (!same.who.split(", ").includes(who)) same.who = `${same.who}, ${who}`;
    } else list.push({ emoji: m.reaction, who, mine, count: 1 });
    pills.set(target.id, list);
  }
  return { shown, pills };
}

/** Destinataires d'une réaction : l'expéditeur (ou son Reply-To), puis les autres en copie. */
export function reactionRecipients(m: ReactionMsg, agencyDomain: string): { to: string; cc: string[] } {
  const isAgency = (a: string) => a.endsWith("@" + agencyDomain.toLowerCase());
  const to = addrs(m.replyTo)[0] ?? addrs(m.from)[0] ?? "";
  const cc = [...new Set([...addrs(m.to), ...addrs(m.cc)])].filter((a) => a !== to && !isAgency(a));
  return { to, cc };
}

/** Peut-on proposer une réaction sur ce message (règles Gmail + limites d'envoi de l'app) ? */
export function canReact(m: ReactionMsg, agencyDomain: string): boolean {
  if (m.direction !== "in" || m.reaction || m.list) return false;
  if (!firstId(m.messageIdHeader)) return false;
  const rcpt = new Set([...addrs(m.to), ...addrs(m.cc)]);
  if (rcpt.size > 20) return false;
  // Notre boîte doit être en To ou Cc (pas en Cci).
  if (![...rcpt].some((a) => a.endsWith("@" + agencyDomain.toLowerCase()))) return false;
  const { to, cc } = reactionRecipients(m, agencyDomain);
  return !!to && cc.length <= 10;
}

/** Message d'erreur d'un envoi de réaction (codes de gmail-send). */
export function reactionErrorText(code?: string | null): string {
  if (code === "contenu_requis" || code === "ancienne_version") return "Réactions pas encore activées : mise à jour serveur nécessaire (gmail-send).";
  if (code === "google_non_connecte" || code === "gmail_scope_manquant") return "Reconnecte Google (droits Gmail) dans l'app.";
  if (code === "limite_gmail") return "Gmail limite les envois, réessaie dans une minute.";
  if (code === "reseau") return "Réaction non confirmée (connexion) : vérifie le fil avant de recommencer.";
  return "Réaction non envoyée, réessaie.";
}
