import { useSyncExternalStore } from "react";
import DOMPurify from "dompurify";
import { supabase } from "@/lib/supabase";
import { linkifyHtml } from "@/lib/mailSend";

/*
 * Client de la section « Mails » de l'Espace Créateur.
 * Tout passe par la fonction serveur creator-mail (filtrage par alias/libellé
 * CÔTÉ SERVEUR). Le navigateur ne reçoit que les fils du créateur.
 */

export type MailStatus = "nouvelle" | "demarchee" | "negociation" | "a_verifier" | "a_valider" | "valide" | "refuse";

export const MAIL_STATUS: { value: MailStatus; label: string; short: string; dot: string; badge: string }[] = [
  { value: "nouvelle", short: "Nouvelles", label: "Nouvelle demande", dot: "bg-info", badge: "bg-info-soft text-info" },
  // Fil lancé par l'agence (démarchage), la marque n'a pas encore répondu.
  { value: "demarchee", short: "Démarchées", label: "Démarchée par l'agence", dot: "bg-progress", badge: "bg-progress-soft text-progress" },
  { value: "negociation", short: "Négociation", label: "En négociation", dot: "bg-progress", badge: "bg-progress-soft text-progress" },
  { value: "a_verifier", short: "À vérifier", label: "À vérifier", dot: "bg-wait", badge: "bg-wait-soft text-wait" },
  { value: "a_valider", short: "À valider", label: "À valider", dot: "bg-wait", badge: "bg-wait-soft text-wait" },
  { value: "valide", short: "Validés", label: "Validé", dot: "bg-ok", badge: "bg-ok-soft text-ok" },
  { value: "refuse", short: "Refusés", label: "Refusé", dot: "bg-closed", badge: "bg-closed-soft text-closed" },
];
export const statusMeta = (s: string) => MAIL_STATUS.find((x) => x.value === s) ?? MAIL_STATUS[0];

/** Qui a pris la décision Validé / Refusé (null = pas encore décidé). */
export type Decision = { decidedBy: "creator" | "agency" | null; decidedAt: string | null };
export type MailThreadLite = Decision & {
  id: string; subject: string; brand: string; excerpt: string; ts: number;
  count: number; status: MailStatus; notes: number;
  /** Adresse de la marque (pour son logo) ; absente avec une ancienne version du serveur. */
  brandEmail?: string;
  /** Démarchage : fil lancé par l'agence ; la marque a-t-elle répondu ; date du 1er message. */
  prospect?: boolean;
  replied?: boolean;
  startedTs?: number;
  /** L'agence a écrit dans l'échange (page « Envoyés ») ; absent avec une ancienne version du serveur. */
  sent?: boolean;
};

/** Démarchage du mois en cours : marques contactées par l'agence pour ce créateur, et réponses. */
export function prospectStats(threads: Pick<MailThreadLite, "prospect" | "replied" | "startedTs" | "brand">[], now = new Date()): { pitched: number; replied: number } {
  const from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const mine = threads.filter((t) => t.prospect && (t.startedTs ?? 0) >= from);
  const brands = new Set(mine.map((t) => t.brand.trim().toLowerCase()));
  const answered = new Set(mine.filter((t) => t.replied).map((t) => t.brand.trim().toLowerCase()));
  return { pitched: brands.size, replied: answered.size };
}
export type MailAttachment = { messageId: string; attachmentId: string; filename: string; mimeType: string; size: number };
export type MailMessage = {
  id: string; from: string; fromEmail: string; fromAgency: boolean; to: string; cc: string;
  /** Copie cachée (vue agence, nos envois seulement ; jamais renvoyée à un créateur). */
  bcc?: string;
  ts: number; html: string; text: string; attachments: MailAttachment[];
  /** Vue agence : réponse envoyée sans l'adresse du créateur, il ne la voit pas dans son espace. */
  hiddenFromCreator?: boolean;
  /** Emoji si ce message EST une réaction (creator-mail, 2026-10-24). */
  reaction?: string;
};
export type MailNote = {
  id: string; body: string; created_at: string; agency_read_at: string | null;
  /** Qui a écrit : la créatrice (« Écrire à mon manager ») ou l'agence (remarque). */
  by_role?: "creator" | "agency"; author_name?: string | null;
};
export type MailThread = Decision & {
  id: string; subject: string; brand: string; status: MailStatus; messages: MailMessage[]; notes: MailNote[];
};
/** Réglage Mails d'un créateur. `aliases` : ses adresses en plus de l'alias (absent tant que le SQL n'est pas lancé). */
export type MailSettings = {
  creator: string; alias: string | null; aliases?: string[] | null; label_id: string | null; label_name: string | null; enabled: boolean;
};

/** Rangement choisi à la main avec le grand sélecteur d'un échange. */
export type MailChoice = "encours" | "a_verifier" | "a_valider" | "valide" | "refuse";
/** Statuts choisis à la main (les autres, « Nouvelle demande » et « En négociation », sont « En cours »). */
export const STORED_STATUSES = ["a_verifier", "a_valider", "valide", "refuse"] as const;
export const choiceOf = (s: MailStatus): MailChoice =>
  (STORED_STATUSES as readonly string[]).includes(s) ? (s as MailChoice) : "encours";
/**
 * Statut automatique (comme le serveur) :
 *  - fil lancé par la MARQUE : « Nouvelle demande », puis « En négociation » dès que l'agence a répondu ;
 *  - fil lancé par l'AGENCE (démarchage) : « Démarchée par l'agence », puis « En négociation » dès que la marque répond.
 */
export const autoStatusOf = (messages: Pick<MailMessage, "fromAgency">[]): MailStatus =>
  messages[0]?.fromAgency
    ? messages.slice(1).some((m) => !m.fromAgency) ? "negociation" : "demarchee"
    : messages.slice(1).some((m) => m.fromAgency) ? "negociation" : "nouvelle";

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
  if (!evs.length && legacy?.decidedBy && legacy.decidedAt && (STORED_STATUSES as readonly string[]).includes(legacy.status)) {
    evs.push({ id: "decision", status: legacy.status as MailChoice, by_role: legacy.decidedBy, comment: null, created_at: legacy.decidedAt });
  }
  const items: FeedItem[] = [
    ...notes.map((n) => ({ kind: "note" as const, at: new Date(n.created_at).getTime(), note: n })),
    ...evs.map((e) => ({ kind: "event" as const, at: new Date(e.created_at).getTime(), event: e })),
  ];
  return items.sort((a, b) => a.at - b.at);
}

/**
 * Suivi écrit d'un échange (messages de la créatrice + remarques de l'agence), lu
 * directement (RLS : agence tout, créatrice les siens). null = lecture impossible.
 */
export async function getThreadNotes(creator: string, threadId: string): Promise<MailNote[] | null> {
  const { data, error } = await supabase.from("creator_mail_notes").select("*")
    .eq("creator", creator).eq("thread_id", threadId).order("created_at");
  return error ? null : ((data ?? []) as MailNote[]);
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

// ─────────────────────────────────────────────────────────────────────────────
// Lectures légères en base (sans Gmail) : statuts, remarques, activité de l'agence.
// Relues au rythme du rafraîchissement de l'app ; la liste Gmail, elle, l'est rarement.
// ─────────────────────────────────────────────────────────────────────────────
type DbRow = { thread_id: string; status: string; decided_by?: string | null; decided_at?: string | null };
/** Statut d'un échange d'après sa ligne en base (même règle que le serveur). */
export function dbStatus(row: DbRow | undefined, auto: MailStatus): Decision & { status: MailStatus } {
  return row && (STORED_STATUSES as readonly string[]).includes(row.status)
    ? { status: row.status as MailStatus, decidedBy: row.decided_by === "creator" ? "creator" : "agency", decidedAt: row.decided_at ?? null }
    : { status: auto, decidedBy: null, decidedAt: null };
}
const DAY = 86_400_000;
/** Activité de l'agence regardée au plus sur 60 jours (au-delà, rien n'est signalé). */
const ACTIVITY_WINDOW = 60 * DAY;
let notesWithoutRole = false; // colonne by_role absente (SQL « remarques » pas lancé)
const latest = (m: Record<string, number>, id: string, iso: string) => {
  const at = Date.parse(iso);
  if (Number.isFinite(at) && at > (m[id] ?? 0)) m[id] = at;
};

/**
 * Statuts, nombre de remarques et (si demandé) dernière action de l'agence par échange.
 * null = lecture impossible (réseau) : l'écran garde ce qu'il a.
 */
export async function getMailDb(creator: string, withAgency: boolean): Promise<{
  rows: Map<string, DbRow>; notes: Map<string, number>; agency: Record<string, number>;
} | null> {
  const notesQuery = () => supabase.from("creator_mail_notes").select(notesWithoutRole ? "thread_id, created_at" : "thread_id, created_at, by_role").eq("creator", creator).limit(2000);
  const since = new Date(Date.now() - ACTIVITY_WINDOW).toISOString();
  const [rowsR, notesR0, logR] = await Promise.all([
    supabase.from("creator_mail_threads").select("*").eq("creator", creator),
    notesQuery(),
    withAgency
      ? supabase.from("creator_mail_status_log").select("thread_id, created_at").eq("creator", creator).eq("by_role", "agency").gte("created_at", since).limit(500)
      : Promise.resolve(null),
  ]);
  let notesR = notesR0;
  if (notesR.error && !notesWithoutRole && /by_role/.test(notesR.error.message)) {
    notesWithoutRole = true;
    notesR = await notesQuery();
  }
  if (rowsR.error || notesR.error) return null;
  const rows = new Map(((rowsR.data ?? []) as DbRow[]).map((r) => [r.thread_id, r]));
  const notes = new Map<string, number>();
  const agency: Record<string, number> = {};
  for (const n of (notesR.data ?? []) as unknown as { thread_id: string; created_at: string; by_role?: string }[]) {
    notes.set(n.thread_id, (notes.get(n.thread_id) ?? 0) + 1);
    if (n.by_role === "agency") latest(agency, n.thread_id, n.created_at);
  }
  if (logR && !logR.error) for (const e of (logR.data ?? []) as { thread_id: string; created_at: string }[]) latest(agency, e.thread_id, e.created_at);
  return { rows, notes, agency };
}

/** Dernière remarque ou dernier statut posé par l'agence, par échange (espace créateur). */
export async function getAgencyActivity(creator: string): Promise<Record<string, number> | null> {
  const since = new Date(Date.now() - ACTIVITY_WINDOW).toISOString();
  const [notes, log] = await Promise.all([
    supabase.from("creator_mail_notes").select("thread_id, created_at").eq("creator", creator).eq("by_role", "agency").gte("created_at", since).limit(500),
    supabase.from("creator_mail_status_log").select("thread_id, created_at").eq("creator", creator).eq("by_role", "agency").gte("created_at", since).limit(500),
  ]);
  if (notes.error && log.error) return null;
  const act: Record<string, number> = {};
  for (const r of [...(notes.error ? [] : notes.data ?? []), ...(log.error ? [] : log.data ?? [])] as { thread_id: string; created_at: string }[]) {
    latest(act, r.thread_id, r.created_at);
  }
  return act;
}

// ─────────────────────────────────────────────────────────────────────────────
// « Pas encore vu » (espace créateur) : un échange est signalé quand il a bougé
// (nouveau message, remarque ou statut de l'agence) depuis que le créateur l'a
// ouvert. Tout est calculé ici, sur l'appareil, à partir de ce qui est déjà chargé :
// localStorage `ttp:cmail-seen:<créateur>` = { base, seen: {échange: ms}, last: {échange: ms} }
//   - base : première utilisation sur cet appareil (rien d'antérieur n'est signalé) ;
//   - seen : moment où l'échange a été ouvert ;
//   - last : date du dernier message de chaque échange (dernière liste chargée).
// ─────────────────────────────────────────────────────────────────────────────
type SeenState = { base: number; seen: Record<string, number>; last: Record<string, number> };
const seenStates = new Map<string, SeenState>();
const agencyActivity = new Map<string, Record<string, number>>();
const seenSubs = new Set<() => void>();
let seenVersion = 0;
const ckey = (c: string) => c.trim().toLowerCase();
const seenStorageKey = (c: string) => `ttp:cmail-seen:${ckey(c)}`;
const emitSeen = () => {
  seenVersion++;
  seenSubs.forEach((f) => f());
};
function saveSeen(creator: string, s: SeenState) {
  try {
    localStorage.setItem(seenStorageKey(creator), JSON.stringify(s));
  } catch {
    /* stockage indisponible : gardé en mémoire */
  }
}
function seenState(creator: string): SeenState {
  const k = ckey(creator);
  let s = seenStates.get(k);
  if (s) return s;
  try {
    const raw = JSON.parse(localStorage.getItem(seenStorageKey(creator)) ?? "null") as Partial<SeenState> | null;
    if (raw && typeof raw.base === "number") s = { base: raw.base, seen: raw.seen ?? {}, last: raw.last ?? {} };
  } catch {
    /* illisible : on repart de zéro */
  }
  if (!s) {
    s = { base: Date.now(), seen: {}, last: {} };
    saveSeen(creator, s);
  }
  seenStates.set(k, s);
  return s;
}
const activityAt = (creator: string, s: SeenState, id: string) =>
  Math.max(s.last[id] ?? 0, agencyActivity.get(ckey(creator))?.[id] ?? 0);

/** La liste vient d'être chargée : on retient la date du dernier message de chaque échange. */
export function reportMailList(creator: string, threads: Pick<MailThreadLite, "id" | "ts">[], partial = false) {
  const s = seenState(creator);
  const last: Record<string, number> = partial ? { ...s.last } : {};
  for (const t of threads) last[t.id] = t.ts || 0;
  // Liste complète : on oublie les échanges qui n'y sont plus (stockage borné).
  const seen = partial ? s.seen : Object.fromEntries(Object.entries(s.seen).filter(([id]) => id in last));
  const changed = JSON.stringify(last) !== JSON.stringify(s.last) || Object.keys(seen).length !== Object.keys(s.seen).length;
  if (!changed) return;
  s.last = last;
  s.seen = seen;
  saveSeen(creator, s);
  emitSeen();
}

/** Dernière remarque / dernier statut de l'agence par échange (lu en base). */
export function reportAgencyActivity(creator: string, act: Record<string, number>) {
  const k = ckey(creator);
  if (JSON.stringify(agencyActivity.get(k) ?? null) === JSON.stringify(act)) return;
  agencyActivity.set(k, act);
  emitSeen();
}

const agencyReadAt = new Map<string, number>(); // créateur → dernière lecture (refreshAgencyActivity)
/** Relit l'activité de l'agence (hors section Mails), au plus toutes les `minGapMs`. */
export async function refreshAgencyActivity(creator: string, minGapMs = 120_000) {
  const k = ckey(creator);
  if (Date.now() - (agencyReadAt.get(k) ?? 0) < minGapMs) return;
  agencyReadAt.set(k, Date.now());
  const act = await getAgencyActivity(creator);
  if (act) reportAgencyActivity(creator, act);
}

/** Le créateur a ouvert l'échange : tout ce qui s'y est passé jusqu'ici est vu. */
export function markThreadSeen(creator: string, threadId: string) {
  const s = seenState(creator);
  const act = activityAt(creator, s, threadId);
  if ((s.seen[threadId] ?? s.base) >= act) return;
  s.seen[threadId] = Math.max(Date.now(), act);
  saveSeen(creator, s);
  emitSeen();
}

/** Échanges qui ont bougé depuis la dernière ouverture (ceux de la dernière liste chargée). */
export function unseenMailIds(creator: string): string[] {
  const s = seenState(creator);
  const known = Object.keys(s.last);
  const ids = known.length ? known : Object.keys(agencyActivity.get(ckey(creator)) ?? {});
  return ids.filter((id) => activityAt(creator, s, id) > (s.seen[id] ?? s.base));
}

/** Appelé à chaque changement (pastille de l'onglet Mails). Renvoie la désinscription. */
export const subscribeSeen = (f: () => void) => {
  seenSubs.add(f);
  return () => {
    seenSubs.delete(f);
  };
};
const NONE: Set<string> = new Set();
const unseenCache = new Map<string, { v: number; set: Set<string> }>();
/** Instantané stable tant que rien n'a changé (exigé par useSyncExternalStore). */
function unseenSnapshot(creator: string, enabled: boolean): Set<string> {
  if (!enabled) return NONE;
  const k = ckey(creator);
  const hit = unseenCache.get(k);
  if (hit && hit.v === seenVersion) return hit.set;
  const set = new Set(unseenMailIds(creator));
  unseenCache.set(k, { v: seenVersion, set });
  return set;
}
/** Échanges pas encore vus par le créateur (vide si `enabled` est faux, ex. aperçu agence). */
export function useUnseenMail(creator: string, enabled = true): Set<string> {
  return useSyncExternalStore(subscribeSeen, () => unseenSnapshot(creator, enabled), () => NONE);
}

/** Textes pour l'agence (fiche, page Mails, aperçu de l'espace créateur) : détaillés. */
const ERRORS: Record<string, string> = {
  introuvable: "Cette conversation est introuvable.",
  gmail_non_connecte: "La boîte mail de l'agence n'est pas connectée.",
  gmail_acces_refuse: "Accès à la boîte mail refusé.",
  gmail_indisponible: "Boîte mail indisponible pour le moment.",
  piece_trop_lourde: "Pièce jointe trop lourde (20 Mo max).",
  note_invalide: "Message vide ou trop long.",
  note_non_enregistree: "Remarque non enregistrée, réessaie.",
  decision_agence: "Ton agence a déjà tranché sur cet échange.",
  migration_manquante: "Fonction pas encore activée (SQL à lancer).",
  decision_non_enregistree: "Réponse non enregistrée, réessaie.",
  section_desactivee: "Cette section n'est plus activée.",
  non_configure: "Aucun alias ni libellé n'est lié à ce créateur.",
};
/** Message unique montré au créateur quand ses mails ne se chargent pas (jamais de détail technique). */
export const CREATOR_UNAVAILABLE = "Tes mails sont momentanément indisponibles, réessaie dans un instant.";
/** Textes pour le créateur : seulement ce qui le concerne, sans parler de la boîte de l'agence ni du SQL. */
const CREATOR_ERRORS: Record<string, string> = {
  introuvable: "Cet échange n'est plus disponible.",
  piece_trop_lourde: "Pièce jointe trop lourde (20 Mo max).",
  note_invalide: "Message vide ou trop long.",
  note_non_enregistree: "Remarque non enregistrée, réessaie.",
  decision_agence: "Ton agence a déjà tranché sur cet échange.",
  decision_non_enregistree: "Réponse non enregistrée, réessaie.",
  migration_manquante: "Réponse non enregistrée, réessaie.",
  section_desactivee: "Cette section n'est plus activée.",
  reponse_invalide: "Message vide ou trop long.",
  pas_de_destinataire: "Impossible de trouver l'adresse de la marque dans cet échange.",
  envoi_echoue: "Ta réponse n'est pas partie, réessaie.",
  gmail_scope_manquant: "Ta réponse n'est pas partie, préviens ton agence.",
  action_inconnue: "La réponse à la marque n'est pas encore disponible, préviens ton agence.",
};

/** Erreur de la fonction creator-mail : `code` brut du serveur, `message` prêt à afficher. */
export class MailError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "MailError";
    this.code = code;
  }
}
const mailError = (code: string, forAgency: boolean) =>
  new MailError(code, forAgency ? ERRORS[code] ?? "Impossible de charger les mails." : CREATOR_ERRORS[code] ?? CREATOR_UNAVAILABLE);
export const errorCode = (e: unknown) => (e instanceof MailError ? e.code : "");

async function call<T>(body: Record<string, unknown>): Promise<T> {
  // Seul un compte agence passe `creator` (fiche, aperçu) : le créateur reçoit des textes simples.
  const forAgency = !!body.creator || body.action === "labels";
  let res: { data: unknown; error: unknown };
  try {
    res = await supabase.functions.invoke("creator-mail", { body });
  } catch {
    throw mailError("", forAgency);
  }
  let payload = res.data as (T & { error?: string; configured?: boolean }) | null;
  if (res.error) {
    const ctx = (res.error as { context?: { json?: () => Promise<unknown> } }).context;
    payload = ctx?.json ? ((await ctx.json().catch(() => null)) as typeof payload) : null;
  }
  if (!payload || payload.error) throw mailError(payload?.error ?? "", forAgency);
  // Section coupée (ou alias retiré) : l'ancienne version du serveur répond « configured: false »
  // à toutes les actions, la nouvelle renvoie « section_desactivee » (sauf pour la liste).
  if (body.action !== "list" && payload.configured === false) throw mailError(forAgency ? "non_configure" : "section_desactivee", forAgency);
  return payload;
}

/**
 * Réponse de la liste. `partial` : des fils n'ont pas pu être lus ; `alias` (adresse principale)
 * et `aliases` (toutes ses adresses) : selon la version du serveur.
 */
export type MailList = { configured: boolean; threads: MailThreadLite[]; partial?: boolean; alias?: string | null; aliases?: string[] };
/**
 * `creator` n'est pris en compte par le serveur que pour un compte agence.
 * `fresh` (« Actualiser ») : ignore le cache du serveur (sans effet sur une ancienne version).
 */
export const listMails = (creator?: string, opts: { fresh?: boolean } = {}) =>
  call<MailList>({ action: "list", creator, fresh: opts.fresh || undefined }).then((r) => ({ ...r, threads: r.threads ?? [] }));
export const getMailThread = (threadId: string, creator?: string) =>
  call<{ thread?: MailThread }>({ action: "thread", threadId, creator }).then((r) => {
    if (!r.thread) throw mailError("", !!creator);
    return r.thread;
  });
export const sendManagerNote = (threadId: string, body: string) =>
  call<{ note?: MailNote }>({ action: "note", threadId, body }).then((r) => {
    if (!r.note) throw mailError("note_non_enregistree", false);
    return r.note;
  });
/**
 * Avis du créateur : range l'échange (En cours / Validé / Refusé) avec un mot
 * facultatif. « En cours » part sous son ancien nom « annuler », compris par toutes
 * les versions du serveur.
 */
export const sendDecision = (threadId: string, choice: "encours" | "valide" | "refuse", comment?: string) =>
  call<Decision & { status?: MailStatus; logged?: boolean }>({
    action: "decision", threadId, decision: choice === "encours" ? "annuler" : choice, comment: comment || undefined,
  }).then((r) => {
    if (!r.status) throw mailError("decision_non_enregistree", false);
    return { ...r, status: r.status };
  });
/**
 * Réponse du créateur à la marque (agence pas dispo) : part de la boîte de l'agence à son
 * nom, son adresse en copie, dans le même fil. Renvoie l'adresse de la marque.
 */
export const replyToBrand = (threadId: string, text: string) =>
  call<{ to?: string }>({ action: "reply", threadId, text }).then((r) => {
    if (!r.to) throw mailError("envoi_echoue", false);
    return r.to;
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
 * Marque posée devant le HTML d'un mail pour bloquer ses images distantes. Elle passe
 * par le lecteur partagé (MailItem → mailDocument) sans qu'il ait besoin d'une option ;
 * un mail qui l'imiterait ne ferait que masquer ses propres images.
 */
export const NO_REMOTE_IMAGES = "<!--ttp:no-remote-images-->";
export const withoutRemoteImages = (html: string) =>
  html && !html.startsWith(NO_REMOTE_IMAGES) ? NO_REMOTE_IMAGES + html : html;
const REMOTE_IMG = /<img\b[^>]*?\ssrc\s*=\s*["']?\s*(?:https?:)?\/\//i;
const REMOTE_CSS = /url\(\s*["']?\s*(?:https?:)?\/\//i;
/** Le mail charge-t-il des images hébergées ailleurs (pixels espions, logos) ? */
export const hasRemoteImages = (html: string) => !!html && (REMOTE_IMG.test(html) || REMOTE_CSS.test(html));

// Images affichées à la demande, retenues le temps de la session (onglet ouvert).
const IMG_KEY = "ttp:cmail-img";
let imagesOk: Set<string> | null = null;
function imagesSet(): Set<string> {
  if (!imagesOk) {
    try {
      imagesOk = new Set(JSON.parse(sessionStorage.getItem(IMG_KEY) ?? "[]") as string[]);
    } catch {
      imagesOk = new Set();
    }
  }
  return imagesOk;
}
export const remoteImagesAllowed = (messageId: string) => imagesSet().has(messageId);
export function allowRemoteImages(messageId: string) {
  const s = imagesSet();
  s.add(messageId);
  try {
    sessionStorage.setItem(IMG_KEY, JSON.stringify([...s].slice(-200)));
  } catch {
    /* stockage indisponible : retenu jusqu'au rechargement */
  }
}

/**
 * Document autonome pour l'iframe de lecture (sandbox sans scripts).
 * Second assainissement (DOMPurify) après celui du serveur, et CSP : aucun script,
 * aucune ressource à part les images (logos, signatures). Fond blanc fixe : les
 * mails portent leurs propres couleurs, comme dans Gmail. L'historique cité est
 * masqué tant que `showQuoted` est faux. `remoteImages: false` (ou la marque
 * NO_REMOTE_IMAGES) : seules les images intégrées au mail (data:, cid:) s'affichent.
 */
export function mailDocument(html: string, text: string, showQuoted: boolean, opts: { remoteImages?: boolean; fontPx?: number } = {}): string {
  const marked = html.startsWith(NO_REMOTE_IMAGES);
  const src = marked ? html.slice(NO_REMOTE_IMAGES.length) : html;
  const remote = opts.remoteImages !== false && !marked;
  // Liens écrits en clair (https://…, www.…) : cliquables, comme dans Gmail.
  const body = src
    ? linkifyHtml(DOMPurify.sanitize(src, {
        FORBID_TAGS: ["script", "style", "form", "input", "button", "textarea", "select", "iframe", "object", "embed", "link", "meta", "base", "svg", "math"],
        FORBID_ATTR: ["srcset", "action", "formaction", "background", "ping"],
      }))
    : `<pre>${linkifyHtml(text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c))}</pre>`;
  const quotes = showQuoted ? "" : ".gmail_quote,.gmail_extra,.gmail_attr,blockquote{display:none!important}";
  // Images distantes bloquées : masquées (sinon leur texte de remplacement s'écrase lettre par lettre).
  const hideRemote = remote ? "" : 'img[src^="http"],img[src^="//"]{display:none!important}';
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${remote ? "https: data: cid:" : "data: cid:"}; style-src 'unsafe-inline'; font-src data:;">
<base target="_blank">
<style>
  html,body{margin:0;padding:0;background:#fff;color:#18181b;font:${opts.fontPx ?? 14}px/1.6 Inter,-apple-system,system-ui,sans-serif;word-wrap:break-word;overflow-wrap:anywhere}
  body>*:first-child{margin-top:0} body>*:last-child{margin-bottom:0}
  img{max-width:100%;height:auto} table{max-width:100%} pre{white-space:pre-wrap;font:inherit;margin:0}
  a{color:#2563eb} blockquote{margin:8px 0;padding-left:12px;border-left:2px solid #e4e4e7;color:#71717a}
  ${quotes}${hideRemote}
</style></head><body>${body}</body></html>`;
}

export const fmtSize = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`;
