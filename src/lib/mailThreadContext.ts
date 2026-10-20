/**
 * Contexte complet d'un échange de mails, à donner à Claude ou à un agent en un seul
 * geste (bouton « Rédiger avec Claude » de la zone de réponse) : qui a écrit, quand,
 * à qui, et le texte de chaque message, sans les citations répétées.
 * Logique PURE (testée sous Node) : aucun accès au DOM.
 */

export type ContextMessage = {
  from: string;
  fromEmail?: string;
  fromAgency: boolean;
  to?: string;
  cc?: string;
  ts: number;
  html?: string;
  text?: string;
};

const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&rsquo;": "’", "&eacute;": "é", "&egrave;": "è", "&agrave;": "à", "&ccedil;": "ç" };

/** HTML d'un mail → texte lisible (paragraphes et retours gardés, balises retirées). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;|&#\d+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? (/^&#\d+;$/.test(e) ? String.fromCharCode(Number(e.slice(2, -1))) : " "))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Retire la partie citée en bas d'un message (« Le 12 oct. 2026, X a écrit : »,
 * « On … wrote: », lignes « > ») : elle répète les messages précédents du fil.
 */
export function stripQuoted(text: string): string {
  const lines = text.split("\n");
  const cut = lines.findIndex((l, i) => {
    const t = l.trim();
    if (/^(le|on) .{4,120} (a écrit|wrote)\s*:?\s*$/i.test(t)) return true;
    if (/^-{2,}\s*(message (d'origine|transféré)|original message|forwarded message)/i.test(t)) return true;
    if (/^(de|from)\s*:/i.test(t) && /^(envoyé|sent|date)\s*:/i.test((lines[i + 1] ?? "").trim())) return true;
    return t.startsWith(">") && lines.slice(i).every((x) => !x.trim() || x.trim().startsWith(">"));
  });
  return (cut > 0 ? lines.slice(0, cut) : lines).join("\n").trim();
}

const fmtWhen = (ts: number) =>
  ts ? new Date(ts).toLocaleString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "date inconnue";

/** Plafond du fil copié : au-delà, les plus anciens messages sont résumés en une ligne. */
export const CONTEXT_MAX_CHARS = 14000;

/** Fil complet en texte, du plus ancien au plus récent. */
export function threadTranscript(subject: string, box: string, messages: readonly ContextMessage[], max = CONTEXT_MAX_CHARS): string {
  const ordered = [...messages].sort((a, b) => a.ts - b.ts);
  const blocks = ordered.map((m, i) => {
    const raw = m.text?.trim() ? m.text : htmlToText(m.html ?? "");
    const body = stripQuoted(raw) || "(message vide)";
    const who = `${m.from || m.fromEmail || "Inconnu"}${m.fromEmail && m.from !== m.fromEmail ? ` <${m.fromEmail}>` : ""}${m.fromAgency ? " (TTP Creators)" : ""}`;
    const head = [`Message ${i + 1} sur ${ordered.length}, ${fmtWhen(m.ts)}`, `De : ${who}`, m.to ? `À : ${m.to}` : "", m.cc ? `Cc : ${m.cc}` : ""].filter(Boolean).join("\n");
    return `${head}\n\n${body}`;
  });
  // Trop long : on garde les messages les plus récents en entier.
  const kept: string[] = [];
  let size = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (kept.length && size + blocks[i].length > max) {
      kept.unshift(`(${i + 1} message${i ? "s" : ""} plus ancien${i ? "s" : ""} non repris, voir le fil complet dans la boîte ${box}@)`);
      break;
    }
    kept.unshift(blocks[i]);
    size += blocks[i].length;
  }
  return [`Objet : ${subject || "sans objet"}`, `Boîte : ${box}@ttpcreators.pro`, "", ...kept.flatMap((b) => [b, "\n────────\n"])].join("\n").replace(/\n────────\n$/, "").trim();
}

/** Demande complète pour Claude (seul, ou en jouant un agent de TTP). */
export function contextPrompt(opts: { transcript: string; threadId: string; box: string; agent?: string | null; consigne?: string; draft?: string }): string {
  const { transcript, threadId, box, agent, consigne, draft } = opts;
  return [
    agent
      ? `Tu joues l'agent « ${agent} » de TTP Creators. Si le connecteur TTP Suite est branché, lis d'abord tes consignes avec lire_agent (${agent}) et applique-les.`
      : "Tu aides l'agence de talents TTP Creators à répondre à un mail.",
    "Voici tout l'échange, du plus ancien au plus récent :",
    "",
    "«««",
    transcript,
    "»»»",
    "",
    `Rédige la réponse de TTP Creators au dernier message${consigne?.trim() ? `, en suivant cette consigne : ${consigne.trim()}` : ""}.`,
    "Règles : en français sauf si l'échange est dans une autre langue ; ton professionnel et chaleureux ; n'invente aucun prix, date ou engagement absent de l'échange (mets [à compléter]) ; pas de signature, l'app l'ajoute.",
    draft?.trim() ? `Pars de ce brouillon déjà commencé : « ${draft.trim().slice(0, 1500)} »` : "",
    `Si le connecteur TTP Suite est branché, dépose la réponse dans l'app avec preparer_reponse_mail (fil ${threadId}, boîte ${box}) et n'envoie rien. Sinon, donne-moi simplement la réponse prête à copier.`,
  ].filter((l) => l !== "").join("\n");
}

/** Lien claude.ai : la demande entière si elle tient dans l'adresse, sinon une consigne de collage. */
export function claudeUrl(prompt: string, maxEncoded = 7000): { url: string; full: boolean } {
  const enc = encodeURIComponent(prompt);
  if (enc.length <= maxEncoded) return { url: `https://claude.ai/new?q=${enc}`, full: true };
  const short = "Je viens de copier un échange de mails complet avec ma demande : je le colle juste ici (Cmd+V).";
  return { url: `https://claude.ai/new?q=${encodeURIComponent(short)}`, full: false };
}
