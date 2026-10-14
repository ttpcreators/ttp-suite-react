import { supabase } from "@/lib/supabase";
import { saveAppStateKey, type AppState } from "@/lib/appState";

/*
 * Envoi de mails depuis l'app (page Mails, composeur, transfert) :
 *   - réglages agence (blob `mailSettings`) : signature HTML collée, délai
 *     d'annulation, signature ajoutée par défaut ;
 *   - file d'attente « Annuler l'envoi » : le mail part après N secondes,
 *     tant qu'on ne l'a pas annulé (rien n'est envoyé si l'onglet est fermé avant) ;
 *   - brouillons gardés sur l'appareil (réponse, nouveau mail, transfert) ;
 *   - envois échoués gardés (Réessayer / Copier le texte), même après rechargement.
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
  /** Réponse : Message-ID du message auquel on répond (en-tête In-Reply-To). */
  inReplyTo?: string;
  /** Réponse : chaîne des Message-ID du fil (en-tête References, ignoré par un ancien serveur). */
  references?: string;
  attachments?: OutAttachment[];
  /** Transfert : le serveur joint les pièces jointes d'origine de ce message. */
  forward?: { box: MailBox; messageId: string };
};

/** Taille totale max des pièces jointes d'un envoi (18 Mo bruts, comme côté serveur). */
export const ATTACH_MAX_BYTES = 18 * 1024 * 1024;
export const ATTACH_MAX_LABEL = "18 Mo";

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

/** Délai max d'un envoi (pièces jointes comprises) avant d'abandonner l'attente. */
const SEND_TIMEOUT_MS = 60_000;

/**
 * Envoi via gmail-send. `track` : en cas d'échec, l'envoi est gardé dans la liste
 * « Envois échoués » (barre du bas : Réessayer / Copier le texte), même après rechargement.
 * Coupure réseau ou délai dépassé → `error: "reseau"` (envoi NON confirmé).
 */
export async function sendGmail(p: SendParams, track?: { label: string; draftKey?: string }): Promise<SendResult> {
  let res: SendResult;
  try {
    const { data, error } = await supabase.functions.invoke("gmail-send", { body: p, timeout: SEND_TIMEOUT_MS });
    const ctx = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
    if (error) res = ctx && typeof ctx.json === "function" ? (((await ctx.json().catch(() => null)) as SendResult) ?? {}) : { error: "reseau" };
    else res = (data as SendResult) ?? {};
  } catch {
    res = { error: "reseau" };
  }
  if (res.ok) forgetFailedLike(p);
  else if (track) recordFailedSend(track.label, p, res.error, track.draftKey);
  return res;
}

export function sendErrorText(code?: string): string {
  if (code === "google_non_connecte" || code === "gmail_scope_manquant") return "Reconnecte Google (droits Gmail) dans l'app.";
  if (code === "talent_droit_manquant") return "Envoi depuis talent@ pas encore autorisé (admin.google.com).";
  if (code === "copie_invalide") return "Une adresse en copie est invalide.";
  if (code === "destinataire_invalide") return "Adresse du destinataire invalide.";
  if (code === "pieces_trop_lourdes") return `Pièces jointes trop lourdes (${ATTACH_MAX_LABEL} au total).`;
  if (code === "original_introuvable") return "Mail d'origine introuvable pour le transfert.";
  if (code === "limite_gmail") return "Gmail limite les demandes, réessaie dans une minute.";
  if (code === "reseau") return "Envoi non confirmé (connexion) : vérifie dans Envoyés avant de renvoyer.";
  if (code === "pieces_perdues") return "Pièces jointes perdues au rechargement : renvoie ce mail depuis « Nouveau mail ».";
  return "Envoi échoué, réessaie";
}

/** Échec d'envoi quand le texte a été gardé (brouillon) : message court et rassurant. */
export function sendFailText(code?: string): string {
  const base = sendErrorText(code);
  return base === "Envoi échoué, réessaie" ? "Envoi échoué, brouillon conservé" : `${base} Brouillon conservé.`;
}

// ── Stockage local (brouillons, envois échoués) ─────────────────────────────
function lsGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string | null): boolean {
  try {
    if (value == null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
    return true;
  } catch {
    return false; // stockage plein ou indisponible
  }
}

// ── Brouillons (réponse dans un fil, nouveau mail, transfert) ───────────────
/*
 * Un brouillon par clé (« reply:<boîte>:<fil> », « new », « fwd:<message> »), gardé
 * sur cet appareil. `sendingAt` : envoi en cours (le brouillon reste stocké jusqu'à la
 * confirmation, mais n'est pas proposé pendant ce temps). Les pièces jointes restent
 * en mémoire seulement (trop lourdes pour le stockage local).
 */
const DRAFT_PREFIX = "ttp:mail-draft:";
/** Un envoi « en cours » depuis plus longtemps que ça a été perdu (onglet fermé) : brouillon rendu. */
const SENDING_STALE_MS = 2 * 60_000;
export type DraftBase = { at: number; sendingAt?: number };
const draftListeners = new Set<(key: string) => void>();
const draftFiles = new Map<string, OutAttachment[]>();

export const replyDraftKey = (box: MailBox, threadId: string) => `reply:${box}:${threadId}`;

/** Brouillon stocké (y compris pendant un envoi). */
export function readDraftRaw<T extends DraftBase>(key: string): T | null {
  const raw = lsGet(DRAFT_PREFIX + key);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as T;
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}
/** Brouillon à proposer : null s'il est en cours d'envoi. */
export function readDraft<T extends DraftBase>(key: string): T | null {
  const d = readDraftRaw<T>(key);
  if (!d) return null;
  if (d.sendingAt && Date.now() - d.sendingAt < SENDING_STALE_MS) return null;
  return d;
}
export function writeDraft<T extends DraftBase>(key: string, value: T | null) {
  lsSet(DRAFT_PREFIX + key, value ? JSON.stringify(value) : null);
  if (!value) draftFiles.delete(key);
  for (const l of draftListeners) l(key);
}
/** Marque le brouillon « en cours d'envoi » (il n'est plus proposé, mais reste gardé). */
export function markDraftSending(key: string) {
  const d = readDraftRaw<DraftBase>(key);
  if (d) writeDraft(key, { ...d, sendingAt: Date.now() });
}
/** Envoi réussi : le brouillon part, sauf s'il a été réécrit depuis l'envoi. */
export function clearSentDraft(key: string) {
  const d = readDraftRaw<DraftBase>(key);
  if (!d || d.sendingAt) writeDraft(key, null);
}
/** Envoi échoué ou annulé : le brouillon redevient proposé. */
export function restoreDraft(key: string) {
  const d = readDraftRaw<DraftBase>(key);
  if (d?.sendingAt) {
    const rest: DraftBase = { ...d };
    delete rest.sendingAt;
    writeDraft(key, rest);
  }
}
export function subscribeDrafts(fn: (key: string) => void) {
  draftListeners.add(fn);
  return () => {
    draftListeners.delete(fn);
  };
}
/** Clés des brouillons proposés commençant par `prefix` (ex. « reply: »). */
export function draftKeys(prefix: string): string[] {
  const out: string[] = [];
  try {
    const ls = globalThis.localStorage;
    if (!ls) return out;
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k?.startsWith(DRAFT_PREFIX + prefix)) {
        const key = k.slice(DRAFT_PREFIX.length);
        if (readDraft(key)) out.push(key);
      }
    }
  } catch {
    /* stockage indisponible */
  }
  return out;
}
export const getDraftFiles = (key: string) => draftFiles.get(key) ?? [];
export function setDraftFiles(key: string, files: OutAttachment[]) {
  if (files.length) draftFiles.set(key, files);
  else draftFiles.delete(key);
}

// ── Envois échoués (barre du bas : Réessayer / Copier le texte) ─────────────
export type FailedSend = {
  id: string; label: string; at: number; error?: string; params: SendParams;
  /** Pièces jointes non gardées au rechargement (trop lourdes pour le stockage local). */
  lostFiles?: string[];
  /** Brouillon lié (réponse) : effacé si le renvoi réussit. */
  draftKey?: string;
};
const FAILED_KEY = "ttp:mail-failed";
const FAILED_MAX = 10;
const FAILED_STORE_MAX = 1_500_000; // au-delà, les pièces jointes ne sont pas stockées
const failedParams = new Map<string, SendParams>(); // envois complets (pièces comprises), cette session
const failedListeners = new Set<(items: FailedSend[]) => void>();
let failedCache: FailedSend[] | null = null;
let failSeq = 0;

function loadFailed(): FailedSend[] {
  if (failedCache) return failedCache;
  try {
    const v = JSON.parse(lsGet(FAILED_KEY) ?? "[]") as FailedSend[];
    failedCache = Array.isArray(v) ? v.filter((x) => x && x.id && x.params) : [];
  } catch {
    failedCache = [];
  }
  return failedCache;
}
function saveFailed(items: FailedSend[]) {
  failedCache = items;
  const stored = items.map((f) => {
    const files = f.params.attachments ?? [];
    if (!files.length) return f;
    const size = files.reduce((n, a) => n + a.contentBase64.length, 0);
    return size > FAILED_STORE_MAX ? { ...f, params: { ...f.params, attachments: [] }, lostFiles: files.map((a) => a.filename) } : f;
  });
  if (!lsSet(FAILED_KEY, items.length ? JSON.stringify(stored) : null)) {
    // Stockage plein : on garde au moins le texte (sans pièces jointes).
    lsSet(FAILED_KEY, JSON.stringify(stored.map((f) => (f.params.attachments?.length ? { ...f, params: { ...f.params, attachments: [] }, lostFiles: f.params.attachments.map((a) => a.filename) } : f))));
  }
  for (const l of failedListeners) l(items);
}
const sameSend = (a: SendParams, b: SendParams) =>
  a.box === b.box && a.to === b.to && a.subject === b.subject && (a.threadId ?? "") === (b.threadId ?? "");

export function subscribeFailed(fn: (items: FailedSend[]) => void) {
  failedListeners.add(fn);
  fn(loadFailed());
  return () => {
    failedListeners.delete(fn);
  };
}
export function recordFailedSend(label: string, params: SendParams, error?: string, draftKey?: string) {
  const id = `f${Date.now().toString(36)}${++failSeq}`;
  failedParams.set(id, params);
  const item: FailedSend = { id, label, at: Date.now(), error, params, ...(draftKey ? { draftKey } : {}) };
  saveFailed([item, ...loadFailed().filter((f) => !sameSend(f.params, params))].slice(0, FAILED_MAX));
}
export function dismissFailedSend(id: string) {
  failedParams.delete(id);
  saveFailed(loadFailed().filter((f) => f.id !== id));
}
/** Un envoi identique vient de partir : l'échec correspondant n'a plus lieu d'être. */
function forgetFailedLike(p: SendParams) {
  const cur = loadFailed();
  const next = cur.filter((f) => !sameSend(f.params, p));
  if (next.length !== cur.length) saveFailed(next);
}
/** Renvoie un envoi échoué (pièces jointes comprises si elles sont encore en mémoire). */
export async function retryFailedSend(id: string): Promise<SendResult> {
  const item = loadFailed().find((f) => f.id === id);
  if (!item) return { error: "introuvable" };
  const params = failedParams.get(id) ?? item.params;
  if (!failedParams.has(id) && item.lostFiles?.length) return { error: "pieces_perdues" };
  dismissFailedSend(id);
  const res = await sendGmail(params, { label: item.label, draftKey: item.draftKey });
  if (res.ok && item.draftKey) clearSentDraft(item.draftKey);
  return res;
}

// ── File « Annuler l'envoi » ────────────────────────────────────────────────
export type PendingSend = { id: number; label: string; until: number; run: () => Promise<void>; onCancel?: () => void };
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

/**
 * Programme un envoi dans `delaySec` secondes (0 = tout de suite).
 * `onCancel` : appelé si l'envoi est annulé (on rend alors le brouillon).
 */
export function scheduleSend(label: string, delaySec: number, run: () => Promise<void>, opts?: { onCancel?: () => void }) {
  if (!delaySec) {
    void run();
    return;
  }
  const id = ++seq;
  const item: PendingSend = { id, label, until: Date.now() + delaySec * 1000, run, onCancel: opts?.onCancel };
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
  p.item.onCancel?.();
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
