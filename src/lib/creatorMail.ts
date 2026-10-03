import DOMPurify from "dompurify";
import { supabase } from "@/lib/supabase";

/*
 * Client de la section « Mails » de l'Espace Créateur.
 * Tout passe par la fonction serveur creator-mail (filtrage par alias/libellé
 * CÔTÉ SERVEUR). Le navigateur ne reçoit que les fils de la créatrice.
 */

export type MailStatus = "nouvelle" | "negociation" | "valide" | "refuse";

export const MAIL_STATUS: { value: MailStatus; label: string; short: string; dot: string; badge: string }[] = [
  { value: "nouvelle", short: "Nouvelles", label: "Nouvelle demande", dot: "bg-sky-500", badge: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  { value: "negociation", short: "Négociation", label: "En négociation", dot: "bg-amber-500", badge: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  { value: "valide", short: "Validés", label: "Validé", dot: "bg-emerald-500", badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  { value: "refuse", short: "Refusés", label: "Refusé", dot: "bg-red-500", badge: "bg-red-500/10 text-red-600 dark:text-red-400" },
];
export const statusMeta = (s: string) => MAIL_STATUS.find((x) => x.value === s) ?? MAIL_STATUS[0];

/** Qui a pris la décision Validé / Refusé (null = pas encore décidé). */
export type Decision = { decidedBy: "creator" | "agency" | null; decidedAt: string | null };
export type MailThreadLite = Decision & {
  id: string; subject: string; brand: string; excerpt: string; ts: number;
  count: number; status: MailStatus; notes: number;
};
export type MailAttachment = { messageId: string; attachmentId: string; filename: string; mimeType: string; size: number };
export type MailMessage = {
  id: string; from: string; fromEmail: string; fromAgency: boolean; to: string; cc: string;
  ts: number; html: string; text: string; attachments: MailAttachment[];
};
export type MailNote = { id: string; body: string; created_at: string; agency_read_at: string | null };
export type MailThread = Decision & {
  id: string; subject: string; brand: string; status: MailStatus; messages: MailMessage[]; notes: MailNote[];
};
export type MailSettings = { creator: string; alias: string | null; label_id: string | null; label_name: string | null; enabled: boolean };

/** Rangement choisi à la main avec le grand sélecteur d'un échange. */
export type MailChoice = "encours" | "valide" | "refuse";
/** « Nouvelle demande » et « En négociation » sont tous deux « En cours ». */
export const choiceOf = (s: MailStatus): MailChoice => (s === "valide" || s === "refuse" ? s : "encours");
/** Statut automatique (comme le serveur) : « En négociation » dès que l'agence a répondu. */
export const autoStatusOf = (messages: Pick<MailMessage, "fromAgency">[]): MailStatus =>
  messages.slice(1).some((m) => m.fromAgency) ? "negociation" : "nouvelle";

/** Une ligne de l'historique : qui a rangé l'échange, où, quand, avec quel mot. */
export type MailStatusEvent = {
  id: string; status: MailChoice; by_role: "creator" | "agency"; comment: string | null; created_at: string;
};
/** Élément du suivi d'un échange : message de la créatrice ou changement de statut, dans l'ordre. */
export type FeedItem = { kind: "note"; at: number; note: MailNote } | { kind: "event"; at: number; event: MailStatusEvent };

/**
 * Suivi chronologique d'un échange. Une décision prise avant l'historique (aucune
 * ligne enregistrée) reste visible grâce à `legacy` (auteur + date de la décision).
 */
export function buildFeed(
  notes: MailNote[], events: MailStatusEvent[] | null,
  legacy?: { status: MailStatus; decidedBy: Decision["decidedBy"]; decidedAt: string | null },
): FeedItem[] {
  const evs = [...(events ?? [])];
  if (!evs.length && legacy?.decidedBy && legacy.decidedAt && (legacy.status === "valide" || legacy.status === "refuse")) {
    evs.push({ id: "decision", status: legacy.status, by_role: legacy.decidedBy, comment: null, created_at: legacy.decidedAt });
  }
  const items: FeedItem[] = [
    ...notes.map((n) => ({ kind: "note" as const, at: new Date(n.created_at).getTime(), note: n })),
    ...evs.map((e) => ({ kind: "event" as const, at: new Date(e.created_at).getTime(), event: e })),
  ];
  return items.sort((a, b) => a.at - b.at);
}

/**
 * Historique des statuts d'un échange (RLS : l'agence voit tout, la créatrice ses lignes).
 * null = historique pas encore activé (SQL à lancer) : l'écran fait sans.
 */
export async function getStatusHistory(creator: string, threadId: string): Promise<MailStatusEvent[] | null> {
  const { data, error } = await supabase.from("creator_mail_status_log")
    .select("id, status, by_role, comment, created_at")
    .eq("creator", creator).eq("thread_id", threadId).order("created_at");
  return error ? null : ((data ?? []) as MailStatusEvent[]);
}

const ERRORS: Record<string, string> = {
  introuvable: "Cette conversation est introuvable.",
  gmail_non_connecte: "La boîte mail de l'agence n'est pas connectée.",
  gmail_acces_refuse: "Accès à la boîte mail refusé.",
  gmail_indisponible: "Boîte mail indisponible pour le moment.",
  piece_trop_lourde: "Pièce jointe trop lourde (20 Mo max).",
  note_invalide: "Message vide ou trop long.",
  decision_agence: "Ton agence a déjà tranché sur cet échange.",
  migration_manquante: "Fonction pas encore activée (SQL à lancer).",
  decision_non_enregistree: "Réponse non enregistrée, réessaie.",
};

export class MailError extends Error {}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("creator-mail", { body });
  let payload = data as (T & { error?: string }) | null;
  if (error) {
    const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
    payload = ctx?.json ? ((await ctx.json().catch(() => null)) as typeof payload) : null;
  }
  if (!payload || payload.error) {
    const code = payload?.error ?? "";
    throw new MailError(ERRORS[code] ?? "Impossible de charger les mails.");
  }
  return payload;
}

/** `creator` n'est pris en compte par le serveur que pour un compte agence. */
export const listMails = (creator?: string) =>
  call<{ configured: boolean; threads: MailThreadLite[] }>({ action: "list", creator });
export const getMailThread = (threadId: string, creator?: string) =>
  call<{ thread: MailThread }>({ action: "thread", threadId, creator }).then((r) => r.thread);
export const sendManagerNote = (threadId: string, body: string) =>
  call<{ note: MailNote }>({ action: "note", threadId, body }).then((r) => r.note);
/**
 * Avis de la créatrice : range l'échange (En cours / Validé / Refusé) avec un mot
 * facultatif. « En cours » part sous son ancien nom « annuler », compris par toutes
 * les versions du serveur.
 */
export const sendDecision = (threadId: string, choice: MailChoice, comment?: string) =>
  call<Decision & { status: MailStatus; logged?: boolean }>({
    action: "decision", threadId, decision: choice === "encours" ? "annuler" : choice, comment: comment || undefined,
  });
export const listGmailLabels = () =>
  call<{ labels: { id: string; name: string }[] }>({ action: "labels" }).then((r) => r.labels);

export async function downloadAttachment(threadId: string, a: MailAttachment, creator?: string) {
  const r = await call<{ filename: string; mimeType: string; data: string }>({
    action: "attachment", threadId, messageId: a.messageId, attachmentId: a.attachmentId, creator,
  });
  saveBase64(r.data, r.filename || a.filename);
}

/** Enregistre un fichier reçu en base64 (téléchargement). */
export function saveBase64(data: string, filename: string) {
  const bin = atob(data);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  // Type forcé en binaire : le fichier est enregistré, jamais interprété par la page.
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "piece-jointe";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Le mail contient-il un historique cité (réponse précédente recopiée) ? */
export const hasQuote = (html: string) => /class="[^"]*gmail_quote|<blockquote/i.test(html);

/** Texte brut court d'un mail (aperçu des messages repliés). */
export function mailSnippet(html: string, text: string): string {
  let t = text;
  if (html) {
    // Espace après chaque fin de bloc : « Bonjour,</p><p>Je » → « Bonjour, Je ».
    const spaced = html.replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)\b[^>]*>/gi, "$& ");
    const d = new DOMParser().parseFromString(DOMPurify.sanitize(spaced), "text/html");
    d.querySelectorAll(".gmail_quote, blockquote, style").forEach((n) => n.remove());
    t = d.body.textContent ?? "";
  }
  return t.replace(/\s+/g, " ").trim().slice(0, 160);
}

/**
 * Document autonome pour l'iframe de lecture (sandbox sans scripts).
 * Second assainissement (DOMPurify) après celui du serveur, et CSP : aucun script,
 * aucune ressource à part les images (logos, signatures). Fond blanc fixe : les
 * mails portent leurs propres couleurs, comme dans Gmail. L'historique cité est
 * masqué tant que `showQuoted` est faux.
 */
export function mailDocument(html: string, text: string, showQuoted: boolean): string {
  const body = html
    ? DOMPurify.sanitize(html, {
        FORBID_TAGS: ["script", "style", "form", "input", "button", "textarea", "select", "iframe", "object", "embed", "link", "meta", "base", "svg", "math"],
        FORBID_ATTR: ["srcset", "action", "formaction", "background", "ping"],
      })
    : `<pre>${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c)}</pre>`;
  const quotes = showQuoted ? "" : ".gmail_quote,.gmail_extra,.gmail_attr,blockquote{display:none!important}";
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src data:;">
<base target="_blank">
<style>
  html,body{margin:0;padding:0;background:#fff;color:#18181b;font:14px/1.6 Inter,-apple-system,system-ui,sans-serif;word-wrap:break-word;overflow-wrap:anywhere}
  body>*:first-child{margin-top:0} body>*:last-child{margin-bottom:0}
  img{max-width:100%;height:auto} table{max-width:100%} pre{white-space:pre-wrap;font:inherit;margin:0}
  a{color:#2563eb} blockquote{margin:8px 0;padding-left:12px;border-left:2px solid #e4e4e7;color:#71717a}
  ${quotes}
</style></head><body>${body}</body></html>`;
}

export const fmtSize = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`;
