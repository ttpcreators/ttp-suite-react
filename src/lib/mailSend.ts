import { supabase } from "@/lib/supabase";
import { saveAppStateKey, type AppState } from "@/lib/appState";

/*
 * Envoi de mails depuis l'app (page Mails, composeur, transfert) :
 *   - réglages agence (blob `mailSettings`) : signature HTML collée, délai
 *     d'annulation, signature ajoutée par défaut ;
 *   - file d'attente « Annuler l'envoi » : le mail part après N secondes,
 *     tant qu'on ne l'a pas annulé (rien n'est envoyé si l'onglet est fermé avant).
 */

export type MailBox = "partnerships" | "talent";
export const BOX_LABEL: Record<MailBox, string> = { partnerships: "partnerships@", talent: "talent@" };
/** Code couleur des boîtes : violet = partnerships@, vert fluo = talent@. */
export const BOX_STYLE: Record<MailBox, { dot: string; chip: string; soft: string }> = {
  partnerships: {
    dot: "bg-violet-500",
    chip: "bg-violet-600 text-white",
    soft: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  },
  talent: {
    dot: "bg-[#39ff6a]",
    chip: "bg-[#39ff6a] text-zinc-900",
    soft: "bg-[#39ff6a]/20 text-emerald-800 dark:text-[#6dff92]",
  },
};
export type MailSettings = { signatureHtml: string; signatureOn: boolean; delaySec: number };
export const DEFAULT_MAIL_SETTINGS: MailSettings = { signatureHtml: "", signatureOn: true, delaySec: 10 };
export const DELAYS = [0, 5, 10, 20, 30];

export function readMailSettings(s: AppState): MailSettings {
  const v = (s["mailSettings"] ?? {}) as Partial<MailSettings>;
  return {
    signatureHtml: typeof v.signatureHtml === "string" ? v.signatureHtml : "",
    signatureOn: v.signatureOn !== false,
    delaySec: DELAYS.includes(Number(v.delaySec)) ? Number(v.delaySec) : DEFAULT_MAIL_SETTINGS.delaySec,
  };
}
// Dernière valeur enregistrée sur ce poste : visible tout de suite partout
// (sans attendre le rafraîchissement périodique des réglages partagés).
let savedLocal: MailSettings | null = null;
const settingsListeners = new Set<(v: MailSettings) => void>();
export const localMailSettings = () => savedLocal;
export function subscribeMailSettings(fn: (v: MailSettings) => void) {
  settingsListeners.add(fn);
  return () => {
    settingsListeners.delete(fn);
  };
}
export async function saveMailSettings(v: MailSettings): Promise<boolean> {
  const ok = await saveAppStateKey("mailSettings", v);
  if (ok) {
    savedLocal = v;
    for (const l of settingsListeners) l(v);
  }
  return ok;
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);

/** Corps HTML final : texte saisi + signature éventuelle + contenu cité (transfert). */
export function buildHtml(text: string, opts: { signature?: string; quoted?: string } = {}): string {
  const body = `<div style="font-family:system-ui,Arial,sans-serif;font-size:14px;line-height:1.6;white-space:pre-line">${esc(text.trim())}</div>`;
  const sig = opts.signature ? `<br><div class="ttp-signature">${opts.signature}</div>` : "";
  const quoted = opts.quoted ? `<br><div class="gmail_quote">${opts.quoted}</div>` : "";
  return body + sig + quoted;
}

/** Adresses saisies (« a@b.fr, c@d.com ») → liste, invalides signalées. */
export function parseEmails(raw: string): { ok: string[]; bad: string[] } {
  const parts = raw.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const re = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/;
  return { ok: parts.filter((p) => re.test(p)), bad: parts.filter((p) => !re.test(p)) };
}

export type OutAttachment = { filename: string; mimeType: string; contentBase64: string; size: number };
export type SendParams = {
  to: string; cc?: string[]; bcc?: string[]; subject: string; html: string; box: MailBox;
  threadId?: string; source?: string; contactName?: string;
  attachments?: OutAttachment[];
  /** Transfert : le serveur joint les pièces jointes d'origine de ce message. */
  forward?: { box: MailBox; messageId: string };
};

/** Taille totale max des pièces jointes d'un envoi (comme côté serveur). */
export const ATTACH_MAX_BYTES = 20 * 1024 * 1024;

/** Fichier choisi → pièce jointe prête à envoyer (base64). */
export function readAttachment(file: File): Promise<OutAttachment> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result ?? "");
      resolve({ filename: file.name, mimeType: file.type || "application/octet-stream", contentBase64: url.slice(url.indexOf(",") + 1), size: file.size });
    };
    r.onerror = () => reject(new Error("Lecture du fichier impossible"));
    r.readAsDataURL(file);
  });
}
export type SendResult = { ok?: boolean; error?: string; id?: string; threadId?: string };

export async function sendGmail(p: SendParams): Promise<SendResult> {
  const { data, error } = await supabase.functions.invoke("gmail-send", { body: p });
  if (error && (error as { context?: { json?: () => Promise<unknown> } }).context?.json)
    return ((await (error as { context: { json: () => Promise<unknown> } }).context.json().catch(() => null)) as SendResult) ?? {};
  return (data as SendResult) ?? {};
}

export function sendErrorText(code?: string): string {
  if (code === "google_non_connecte" || code === "gmail_scope_manquant") return "Reconnecte Google (droits Gmail) dans l'app.";
  if (code === "talent_droit_manquant") return "Envoi depuis talent@ pas encore autorisé (admin.google.com).";
  if (code === "copie_invalide") return "Une adresse en copie est invalide.";
  if (code === "destinataire_invalide") return "Adresse du destinataire invalide.";
  if (code === "pieces_trop_lourdes") return "Pièces jointes trop lourdes (20 Mo au total).";
  if (code === "original_introuvable") return "Mail d'origine introuvable pour le transfert.";
  return "Envoi échoué, réessaie";
}

// ── File « Annuler l'envoi » ────────────────────────────────────────────────
export type PendingSend = { id: number; label: string; until: number; run: () => Promise<void> };
let seq = 0;
const pending = new Map<number, { item: PendingSend; timer: number }>();
const listeners = new Set<(items: PendingSend[]) => void>();
const emit = () => {
  const items = [...pending.values()].map((p) => p.item);
  for (const l of listeners) l(items);
};
export function subscribePending(fn: (items: PendingSend[]) => void) {
  listeners.add(fn);
  fn([...pending.values()].map((p) => p.item));
  return () => {
    listeners.delete(fn);
  };
}

/** Programme un envoi dans `delaySec` secondes (0 = tout de suite). */
export function scheduleSend(label: string, delaySec: number, run: () => Promise<void>) {
  if (!delaySec) {
    void run();
    return;
  }
  const id = ++seq;
  const item: PendingSend = { id, label, until: Date.now() + delaySec * 1000, run };
  const timer = window.setTimeout(() => {
    pending.delete(id);
    emit();
    void run();
  }, delaySec * 1000);
  pending.set(id, { item, timer });
  emit();
}
export function cancelSend(id: number): boolean {
  const p = pending.get(id);
  if (!p) return false;
  window.clearTimeout(p.timer);
  pending.delete(id);
  emit();
  return true;
}
/** Envoie tout de suite (sans attendre la fin du délai). */
export function flushSend(id: number) {
  const p = pending.get(id);
  if (!p) return;
  window.clearTimeout(p.timer);
  pending.delete(id);
  emit();
  void p.item.run();
}
