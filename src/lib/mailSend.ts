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
export const saveMailSettings = (v: MailSettings) => saveAppStateKey("mailSettings", v);

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

export type SendParams = {
  to: string; cc?: string[]; subject: string; html: string; box: MailBox;
  threadId?: string; source?: string; contactName?: string;
};
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
