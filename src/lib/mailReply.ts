/**
 * À qui part une réponse dans un fil (page Mails de l'agence). Module pur, testé.
 */
export type ReplyMsg = { from: string; to?: string; cc?: string; replyTo?: string; messageIdHeader?: string; references?: string };
export type ReplyPlan = { to: string; cc: string[]; inReplyTo?: string; references?: string };

const ADDR_RE = /[^\s<>"',;]+@[^\s<>"',;]+/g;
export const addrsOf = (v?: string | null) => (v?.match(ADDR_RE) ?? []).map((a) => a.toLowerCase());
export const addrOf = (v?: string | null) => addrsOf(v)[0] ?? "";

/**
 * Réponse à un fil : destinataire = Reply-To du dernier message reçu, sinon son
 * expéditeur ; « Répondre à tous » = ses To + Cc, sans les adresses de l'agence ni
 * le destinataire ; In-Reply-To / References = dernier message du fil.
 * Relance (le dernier message du fil est une réponse de l'agence à l'extérieur) : on
 * reprend SES destinataires, pour ne pas perdre les personnes que l'agence avait mises
 * en copie. Avec un Reply-To, l'expéditeur technique (« noreply ») ne passe pas en copie.
 */
export function replyPlan(msgs: ReplyMsg[], fallback: string, agencyDomain: string): ReplyPlan {
  const isAgency = (a: string) => a.endsWith(agencyDomain);
  const last = msgs[msgs.length - 1];
  const lastIn = [...msgs].reverse().find((m) => !isAgency(addrOf(m.from)));
  const base = lastIn ?? last;
  let to = lastIn ? addrOf(lastIn.replyTo) || addrOf(lastIn.from) : "";
  if (!to) to = fallback || addrsOf(base?.to).find((a) => !isAgency(a)) || "";
  let others = base ? [...(addrOf(base.replyTo) ? [] : addrsOf(base.from)), ...addrsOf(base.to), ...addrsOf(base.cc)] : [];
  if (last && lastIn && last !== lastIn && isAgency(addrOf(last.from))) {
    const sentTo = addrsOf(last.to).filter((a) => !isAgency(a));
    if (sentTo.length) {
      if (!sentTo.includes(to)) to = sentTo[0];
      others = [...sentTo, ...addrsOf(last.cc)];
    }
  }
  const cc = [...new Set(others.filter((a) => a !== to && !isAgency(a)))];
  const id = last?.messageIdHeader?.trim();
  const references = [last?.references?.trim(), id].filter(Boolean).join(" ").slice(-1900) || undefined;
  return { to, cc, inReplyTo: id || undefined, references: id ? references : undefined };
}
