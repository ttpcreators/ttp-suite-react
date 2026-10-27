// ============================================================================
// _shared/creatorReply.ts : réponse d'un créateur à une marque depuis son espace
// (fonction creator-mail, action « reply »). Logique pure, testée par creatorReply.test.ts.
// Le mail part de la boîte talent@ au nom du créateur ; son alias est en copie et en
// « Répondre à » : la suite de l'échange reste dans son espace.
// ============================================================================
import { encHeader } from "./backup.ts";

const EMAIL = /[^\s<>"',;]+@[^\s<>"',;]+\.[^\s<>"',;]+/;

/**
 * Adresse à qui répondre : « Reply-To », sinon « From », sinon (message envoyé par l'agence,
 * démarchage sans réponse) le premier destinataire « To » ; jamais une adresse de l'agence.
 */
export function replyRecipient(from: string, replyTo: string, agencyDomain: string, to = ""): string {
  const outside = (e: string) => !!e && !e.endsWith("@" + agencyDomain.toLowerCase());
  for (const v of [replyTo, from]) {
    const e = (EMAIL.exec(v ?? "")?.[0] ?? "").toLowerCase();
    if (outside(e)) return e;
  }
  for (const m of (to ?? "").matchAll(new RegExp(EMAIL.source, "g"))) {
    const e = m[0].toLowerCase();
    if (outside(e)) return e;
  }
  return "";
}

/** Objet de la réponse : « Re: » une seule fois. */
export const replySubject = (subject: string) => (/^\s*(re|réf?|aw|sv)\s*:/i.test(subject) ? subject.trim() : `Re: ${subject.trim() || "(sans objet)"}`);

/** En-tête References : celles du message + son Message-ID, sans doublon. */
export function replyReferences(references: string, messageId: string): string {
  const ids = `${references ?? ""} ${messageId ?? ""}`.match(/<[^<>\s]+>/g) ?? [];
  return [...new Set(ids)].join(" ");
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
/** Texte du créateur → HTML (retours à la ligne gardés, liens cliquables). */
export function replyHtml(text: string): string {
  const body = esc(text.trim()).replace(/\b(?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)]/gi, (u) =>
    `<a href="${/^www\./i.test(u) ? "https://" + u : u}">${u}</a>`);
  return `<div style="font-family:system-ui,Arial,sans-serif;font-size:14px;line-height:1.6;white-space:pre-line">${body}</div>`;
}

const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const cleanName = (s: string) => s.replace(/["\r\n\\<>]/g, "").trim();

/** Mail de réponse (MIME), encodé en base64url pour l'API Gmail (`raw`). */
export function replyRaw(o: {
  fromName: string; fromAddress: string; to: string; cc: string[]; replyTo: string;
  subject: string; inReplyTo: string; references: string; html: string;
}): string {
  const from = o.fromAddress ? `${encHeader(`"${cleanName(o.fromName)}"`)} <${o.fromAddress}>` : "";
  const head = [
    from && `From: ${from}`,
    `To: ${o.to}`,
    o.cc.length ? `Cc: ${o.cc.join(", ")}` : "",
    o.replyTo ? `Reply-To: ${o.replyTo}` : "",
    `Subject: ${encHeader(o.subject)}`,
    o.inReplyTo ? `In-Reply-To: ${o.inReplyTo}` : "",
    o.references ? `References: ${o.references}` : "",
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ].filter(Boolean);
  const raw = [...head, "", b64(o.html).replace(/(.{76})/g, "$1\r\n")].join("\r\n");
  return b64(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
