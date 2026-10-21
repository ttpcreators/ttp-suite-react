import { supabase } from "@/lib/supabase";
import { readDraftRaw, writeDraft, type DraftBase, type MailBox } from "@/lib/mailSend";

/*
 * Dossier « Brouillons » de la page Mails :
 *   - brouillons Gmail des deux boîtes (gmail-history `folder: "drafts"`), dont ceux
 *     préparés par Claude (connecteur) ;
 *   - brouillons de l'app gardés sur cet appareil (réponse dans un fil, nouveau mail).
 * Un brouillon Gmail s'ouvre dans la zone de réponse de son fil (réponse) ou dans la
 * fenêtre « Nouveau mail » (nouveau message). Après l'envoi depuis l'app, il est
 * supprimé de Gmail (gmail-thread `draft-delete`). Rien n'est jamais envoyé tout seul.
 */

/** Brouillon Gmail, tel que renvoyé par gmail-history (dossier « drafts »). */
export type GmailDraftRow = {
  draftId: string; messageId: string; threadId: string; box: MailBox;
  subject: string; name: string; email: string; snippet: string; ts: number;
  to: string[]; cc: string[]; bcc: string[];
  reply: boolean; inReplyTo: string; references: string; byClaude: boolean;
  html: string; text: string; bodyCut?: boolean; attachments: string[];
};
/** Lien vers un brouillon Gmail (gardé avec la copie locale pour le supprimer après l'envoi). */
export type GmailDraftRef = { id: string; box: MailBox };

/** Brouillon de réponse gardé sur l'appareil (clé `replyDraftKey(boîte, fil)`). */
export type ReplyDraft = DraftBase & {
  text: string; cc: string; bcc: string; replyAll: boolean;
  /** Repris d'un brouillon Gmail : supprimé de Gmail après l'envoi. */
  gdraft?: GmailDraftRef;
  /** Pour l'afficher dans « Brouillons » sans recharger le fil. */
  subject?: string; toLabel?: string;
};

export type DraftsParsed =
  | { kind: "error"; error: string }
  | { kind: "old" }
  | { kind: "ok"; rows: GmailDraftRow[]; partial: boolean; failedBoxes: MailBox[] };

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 20) : []);
const isBox = (v: unknown): v is MailBox => v === "partnerships" || v === "talent";

/**
 * Réponse de gmail-history pour le dossier « drafts ». Sans l'écho `folder: "drafts"`,
 * c'est une ancienne version (elle a renvoyé la boîte de réception) : `old`.
 */
export function parseDraftsRes(res: { ok?: boolean; error?: string; folder?: unknown; threads?: unknown; partial?: boolean; failedBoxes?: unknown }): DraftsParsed {
  if (!res.ok) return { kind: "error", error: res.error ?? "erreur" };
  if (res.folder !== "drafts") return { kind: "old" };
  const rows: GmailDraftRow[] = [];
  for (const raw of Array.isArray(res.threads) ? res.threads : []) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const draftId = str(r.draftId, 64);
    if (!draftId || !isBox(r.box)) continue;
    rows.push({
      draftId,
      messageId: str(r.messageId, 64),
      threadId: str(r.threadId, 64),
      box: r.box,
      subject: str(r.subject),
      name: str(r.name),
      email: str(r.email),
      snippet: str(r.snippet),
      ts: Number(r.ts) || 0,
      to: strs(r.to),
      cc: strs(r.cc),
      bcc: strs(r.bcc),
      reply: r.reply === true,
      inReplyTo: str(r.inReplyTo),
      references: str(r.references, 2000),
      byClaude: r.byClaude === true,
      html: str(r.html, 60_000),
      text: str(r.text, 60_000),
      ...(r.bodyCut === true ? { bodyCut: true } : {}),
      attachments: strs(r.attachments),
    });
  }
  rows.sort((a, b) => b.ts - a.ts);
  const failedBoxes = (Array.isArray(res.failedBoxes) ? res.failedBoxes : []).filter(isBox);
  return { kind: "ok", rows, partial: !!res.partial, failedBoxes };
}

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", ecirc: "ê", rsquo: "’", lsquo: "‘", hellip: "…", laquo: "«", raquo: "»" };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Texte propre : espaces de fin de ligne retirés, 2 lignes vides max, bords nettoyés. */
const tidy = (s: string) =>
  s.replace(/[\u00a0\u202f]/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/**
 * HTML d'un brouillon → texte modifiable dans l'app. La signature et le message cité
 * (réponse, transfert) sont retirés : l'app ajoute sa propre signature, et une réponse
 * reste dans son fil. Retours à la ligne gardés (paragraphes, <br>, listes).
 */
export function draftHtmlToText(html: string): string {
  let h = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(style|script|head|title)[^>]*>[\s\S]*?<\/\1>/gi, "");
  // Coupe à la signature ou au message cité (début de la balise qui les porte).
  const marks = [
    /class\s*=\s*["'][^"']*\bgmail_signature_prefix\b/i,
    /class\s*=\s*["'][^"']*\bgmail_signature\b/i,
    /class\s*=\s*["'][^"']*\bttp-signature\b/i,
    /class\s*=\s*["'][^"']*\bgmail_quote\b/i,
    /class\s*=\s*["'][^"']*\bgmail_attr\b/i,
    /<blockquote\b/i,
  ];
  let cut = h.length;
  for (const re of marks) {
    const m = re.exec(h);
    if (!m) continue;
    const at = m[0].startsWith("<") ? m.index : h.lastIndexOf("<", m.index);
    if (at >= 0 && at < cut) cut = at;
  }
  h = h.slice(0, cut);
  // Les retours à la ligne du code HTML ne comptent pas, sauf texte préformaté (corps de l'app).
  if (!/white-space\s*:\s*pre|<pre\b/i.test(h)) h = h.replace(/\s*\n\s*/g, " ").replace(/[ \t]{2,}/g, " ");
  h = h
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|tr|h[1-6]|ul|ol|table|pre)>/gi, "\n")
    .replace(/<(p|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return tidy(decodeEntities(h));
}

/** Texte brut d'un brouillon : sans signature (« -- ») ni message cité. */
export function draftPlainText(text: string): string {
  let t = text.replace(/\r\n?/g, "\n");
  const sig = t.search(/^-- ?$/m);
  if (sig >= 0) t = t.slice(0, sig);
  const quote = t.search(/^(Le .{3,160}a écrit\s*:|On .{3,160}wrote\s*:)\s*$/m);
  if (quote >= 0) t = t.slice(0, quote);
  else {
    const q = t.search(/^>/m);
    if (q > 0) t = t.slice(0, q);
  }
  return tidy(t);
}

/** Corps modifiable d'un brouillon Gmail : HTML converti s'il existe, sinon le texte. */
export function draftBodyText(d: { html: string; text: string }): string {
  const fromHtml = d.html ? draftHtmlToText(d.html) : "";
  return fromHtml || draftPlainText(d.text);
}

/** Pré-remplissage de « Nouveau mail » : un seul destinataire, les autres passent en copie. */
export function composerPrefill(d: GmailDraftRow): { to: string; cc: string; bcc: string; subject: string; body: string } {
  const [first = "", ...rest] = d.to;
  const cc = [...new Set([...rest, ...d.cc])].filter((a) => a !== first);
  return { to: first, cc: cc.join(", "), bcc: d.bcc.join(", "), subject: d.subject, body: draftBodyText(d) };
}

/** Réponse dans un fil existant : s'ouvre dans la zone de réponse du fil (garde le fil groupé). */
export const isReplyDraft = (d: GmailDraftRow) => d.reply && !!d.threadId;

/** Clé de la copie locale d'un brouillon Gmail ouvert dans « Nouveau mail ». */
export const gmailDraftLocalKey = (d: { box: MailBox; draftId: string }) => `gdraft:${d.box}:${d.draftId}`;

/** « reply:<boîte>:<fil> » → boîte et fil (null si la clé n'est pas une réponse). */
export function parseReplyDraftKey(key: string): { box: MailBox; threadId: string } | null {
  const m = /^reply:(partnerships|talent):(.+)$/.exec(key);
  return m ? { box: m[1] as MailBox, threadId: m[2] } : null;
}

/**
 * Prépare la zone de réponse d'un fil avec un brouillon Gmail. Une réponse déjà
 * commencée sur cet appareil n'est jamais écrasée (« kept ») ; le même brouillon déjà
 * repris garde ses modifications (« same »).
 */
export function seedReplyDraft(key: string, d: GmailDraftRow, meta: { subject?: string; toLabel?: string } = {}): "seeded" | "same" | "kept" {
  const cur = readDraftRaw<ReplyDraft>(key);
  if (cur?.text?.trim()) return cur.gdraft?.id === d.draftId && cur.gdraft.box === d.box ? "same" : "kept";
  const text = draftBodyText(d);
  if (!text) return "kept";
  const extra = d.to.slice(1);
  writeDraft(key, {
    text,
    cc: [...new Set([...extra, ...d.cc])].join(", "),
    bcc: d.bcc.join(", "),
    replyAll: false,
    at: Date.now(),
    gdraft: { id: d.draftId, box: d.box },
    ...(meta.subject ? { subject: meta.subject } : {}),
    ...(meta.toLabel ? { toLabel: meta.toLabel } : {}),
  } satisfies ReplyDraft);
  return "seeded";
}

/**
 * Supprime un brouillon Gmail (gmail-thread `draft-delete`). Vrai seulement si le serveur
 * confirme (`action` en écho) : une ancienne version déployée ne fait rien.
 */
export async function deleteGmailDraft(ref: GmailDraftRef): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke("gmail-thread", {
      body: { action: "draft-delete", draftId: ref.id, box: ref.box },
      timeout: 20_000,
    });
    let res = (data ?? {}) as { ok?: boolean; action?: string; error?: string };
    if (error) {
      const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
      res = ctx && typeof ctx.json === "function" ? (((await ctx.json().catch(() => null)) as typeof res) ?? { error: "reseau" }) : { error: "reseau" };
    }
    if (res.ok && res.action === "draft-delete") return { ok: true };
    return { ok: false, error: res.error === "action_inconnue" ? "ancienne_version" : res.error ?? "erreur" };
  } catch {
    return { ok: false, error: "reseau" };
  }
}

/** Texte d'erreur d'une suppression de brouillon. */
export function draftDeleteErrText(code?: string): string {
  if (code === "ancienne_version") return "Suppression pas encore disponible : la mise à jour des fonctions Gmail n'est pas encore déployée.";
  if (code === "google_non_connecte" || code === "gmail_scope_manquant") return "Reconnecte Google (droits Gmail) pour supprimer ce brouillon.";
  if (code === "talent_droit_manquant") return "Suppression depuis talent@ pas encore autorisée (admin.google.com, droit gmail.modify).";
  if (code === "limite_gmail") return "Gmail limite les demandes, réessaie dans une minute.";
  if (code === "reseau") return "Pas de réponse du serveur : brouillon non supprimé, réessaie.";
  return "Suppression du brouillon impossible, réessaie";
}
