/**
 * Ce qu'est un fil reçu quand il n'attend PAS de réponse de l'agence : une réponse
 * automatique (absence), une notification ou un reçu (Yousign, GitHub, Stripe…), une
 * newsletter, ou un mail transféré. Ces fils restent dans la boîte (onglet « Tout »,
 * avec une étiquette) mais ne comptent plus dans « À traiter ».
 *
 * Prudence : un fil où l'agence a déjà écrit est une vraie conversation, il n'est jamais
 * rangé en notification ou newsletter (seule une réponse automatique en dernier message
 * le sort de « À traiter »). Un en-tête List-Unsubscribe seul ne suffit pas : les marques
 * qui prospectent via HubSpot ou Lemlist en ont un aussi.
 */
export type MailKind = "auto" | "notif" | "newsletter" | "forward";

export type KindMsg = {
  labelIds?: string[];
  snippet?: string;
  headers: { name: string; value: string }[];
};

/** En-têtes à demander à Gmail (format=metadata) pour pouvoir classer. */
export const KIND_HEADERS = ["Auto-Submitted", "X-Autoreply", "X-Autorespond", "Precedence", "List-Id", "List-Unsubscribe"];

const h = (m: KindMsg, n: string) => m.headers.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? "";
const email = (v: string) => (v.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] ?? "").toLowerCase();
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const AUTO_SUBJECT = /^(reponse automatique|automatic reply|auto[- ]?reply|autoreply|out of (the )?office|absence|absent|abwesenheit|respuesta automatica|risposta automatica|acces limite a mes mails)\b/;

/** Robots et expéditeurs automatiques (factures, reçus, notifications, enquêtes). Pas
 *  « marketing@ » ni « factures@ » : une marque peut écrire de là pour une vraie demande. */
const ROBOT_SENDER = /(^|[._+-])(no-?reply|noreply|ne-?pas-?repondre|donotreply|do-not-reply|notifications?|notify|alerts?|mailer-daemon|postmaster|bounces?|invoice|invoices|statements|receipts?|billing|enquetes?|survey|newsletter|digest)([._+-]|@)/;

const FORWARD_SUBJECT = /^(fwd?|fw|tr|transf(ere)?|wg)\s*:/;

/** Message de réponse automatique (absence, accès limité). */
export function isAutoReply(m: KindMsg): boolean {
  const auto = h(m, "Auto-Submitted").toLowerCase();
  if (auto === "auto-replied") return true;
  if (h(m, "X-Autoreply") || h(m, "X-Autorespond")) return true;
  const subject = fold(h(m, "Subject")).replace(/^(re|tr|fwd?)\s*:\s*/, "");
  // Le texte seul ne suffit pas : une vraie personne peut écrire « je suis en déplacement ».
  return AUTO_SUBJECT.test(subject);
}

/**
 * Nature du fil, ou null s'il attend vraiment une réponse.
 * @param msgs messages du fil dans l'ordre (brouillons et réactions déjà retirés)
 * @param fromUs vrai si le message vient de l'agence
 */
export function threadKind(msgs: KindMsg[], fromUs: (m: KindMsg) => boolean): MailKind | null {
  if (!msgs.length) return null;
  const last = msgs[msgs.length - 1];
  if (fromUs(last)) return null;
  // Absence en dernier message : rien à faire, même dans une vraie conversation.
  if (isAutoReply(last)) return "auto";
  // L'agence a écrit dans le fil : vraie conversation.
  if (msgs.some(fromUs)) return null;
  const first = msgs[0];
  const subject = fold(h(first, "Subject"));
  if (FORWARD_SUBJECT.test(subject)) return "forward";
  const sender = email(h(last, "From"));
  const labels = new Set(msgs.flatMap((m) => m.labelIds ?? []));
  const auto = h(last, "Auto-Submitted").toLowerCase();
  if ((auto && auto !== "no") || ROBOT_SENDER.test(sender.split("@")[0] + "@")) return "notif";
  const precedence = h(last, "Precedence").toLowerCase();
  if (h(last, "List-Id") || precedence === "bulk" || precedence === "list") return "newsletter";
  if (labels.has("CATEGORY_UPDATES") || labels.has("CATEGORY_FORUMS")) return h(last, "List-Unsubscribe") ? "newsletter" : "notif";
  if (labels.has("CATEGORY_PROMOTIONS") || labels.has("CATEGORY_SOCIAL")) return "newsletter";
  return null;
}
