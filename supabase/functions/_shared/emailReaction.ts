// ============================================================================
// _shared/emailReaction.ts
// ----------------------------------------------------------------------------
// Réactions emoji aux mails, au format Gmail (logique PURE, testée par
// emailReaction.test.ts ; partagée par gmail-send, gmail-thread et creator-mail).
// Format (doc Google « Email reactions ») :
//   • une partie `text/vnd.google.email-reaction+json` contenant {"emoji":"❤️","version":1}
//     (version = 1 exactement, un seul emoji), placée ENTRE text/plain et text/html
//     dans un multipart/alternative ;
//   • en-tête In-Reply-To = Message-ID du message visé (un seul identifiant).
// Les messageries sans réactions affichent la partie text/html (ou text/plain) de repli.
// ============================================================================

export const REACTION_MIME = "text/vnd.google.email-reaction+json";

/** Réactions proposées dans l'app (ordre d'affichage). */
export const QUICK_REACTIONS = ["❤️", "👍", "😂", "😮", "🙏", "🎉"] as const;

const PICTO = /\p{Extended_Pictographic}/u;

/** Un seul emoji (avec variantes, teintes de peau, séquences ZWJ) : pas d'espace, pas de texte. */
export function isSingleEmoji(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const e = s.trim();
  if (!e || e.length > 32 || /\s/.test(e) || !PICTO.test(e)) return false;
  // Un seul graphème visible quand le moteur sait les découper (Deno et Node récents).
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(t: string): Iterable<unknown> } }).Segmenter;
  if (Seg) return [...new Seg(undefined, { granularity: "grapheme" }).segment(e)].length === 1;
  return true;
}

/** Contenu JSON d'une partie de réaction → emoji, ou null si la réaction est invalide. */
export function parseReactionJson(raw: string): string | null {
  try {
    const v = JSON.parse(raw) as { emoji?: unknown; version?: unknown };
    if (!v || typeof v !== "object" || v.version !== 1) return null;
    return isSingleEmoji(v.emoji) ? v.emoji.trim() : null;
  } catch {
    return null;
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/** Base64 standard en lignes de 76 caractères (norme MIME) d'un texte UTF-8. */
function b64Lines(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const flat = btoa(bin);
  const out: string[] = [];
  for (let i = 0; i < flat.length; i += 76) out.push(flat.slice(i, i + 76));
  return out.join("\r\n");
}

/** Texte de repli (messageries sans réactions) : « Marc a réagi avec ❤️ ». */
export function reactionFallback(emoji: string, sender: string): string {
  const who = sender.trim() || "TTP Creators";
  return `${who} a réagi avec ${emoji}`;
}

/**
 * Corps MIME d'une réaction (en-tête Content-Type compris), à placer après les en-têtes
 * du message (To, Subject, In-Reply-To, References…). `boundary` : choisi par l'appelant.
 */
export function reactionBody(emoji: string, sender: string, boundary: string): string {
  const text = reactionFallback(emoji, sender);
  const json = JSON.stringify({ emoji, version: 1 });
  const html = `<p style="font-family:system-ui,Arial,sans-serif;font-size:14px">${esc(text)}</p>`;
  return [
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64Lines(text),
    `--${boundary}`,
    `Content-Type: ${REACTION_MIME}; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
    "",
    b64Lines(json),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64Lines(html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** Objet d'une réaction : « Re: » + objet du message visé (sans doubler le « Re: »). */
export function reactionSubject(subject: string): string {
  const s = subject.replace(/[\r\n]+/g, " ").trim();
  return /^re\s*:/i.test(s) ? s : `Re: ${s || "(sans objet)"}`;
}
