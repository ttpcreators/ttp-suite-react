/**
 * État de la dernière sauvegarde mensuelle (fonction monthly-backup), rangé dans le blob
 * agence sous la clé `backupStatus`. Écrit par le serveur à CHAQUE passage (cron ou bouton
 * « Envoyer maintenant »), lu par Paramètres › Sauvegarde mensuelle.
 * Module pur : importé par la fonction (Deno) et par l'app (src/views/Parametres.tsx).
 */

export const BACKUP_STATUS_KEY = "backupStatus";

/** Au-delà, un passage resté « en cours » a été coupé (limite de temps de la fonction). */
export const RUNNING_MAX_MS = 15 * 60 * 1000;

export type BackupStatus = {
  /** Début du passage (ISO). */
  at: string;
  /** Fin du passage (ISO), absente tant qu'il tourne. */
  endedAt?: string;
  source?: "cron" | "manuel";
  /** Passage lancé, pas encore terminé. */
  running?: boolean;
  /** Archive envoyée par mail aux fondateurs. */
  ok?: boolean;
  /** Code d'erreur quand le mail n'est pas parti (ou que la fonction a planté). */
  error?: string;
  /** Google Drive : "ok" ou code d'erreur (api_desactivee, autorisation_manquante…). */
  drive?: string;
  month?: string;
  files?: number;
  bytes?: number;
  /** Listes non lues ce jour-là (sauvegarde incomplète). */
  missing?: string[];
};

/** Réponse de la fonction (succès ou erreur), telle qu'elle est renvoyée à l'appelant. */
export type BackupResult = {
  ok?: boolean;
  error?: string;
  drive?: string;
  month?: string;
  files?: number;
  bytes?: number;
  missing?: string[];
};

/** État à enregistrer à la fin d'un passage. */
export function statusFromResult(at: Date, end: Date, source: "cron" | "manuel", res: BackupResult): BackupStatus {
  const s: BackupStatus = { at: at.toISOString(), endedAt: end.toISOString(), source, ok: res.ok === true && !res.error };
  if (res.error) s.error = String(res.error).slice(0, 60);
  if (res.drive) s.drive = String(res.drive).slice(0, 60);
  if (res.month) s.month = res.month;
  if (typeof res.files === "number") s.files = res.files;
  if (typeof res.bytes === "number") s.bytes = res.bytes;
  if (res.missing?.length) s.missing = res.missing.slice(0, 30).map((m) => String(m).slice(0, 80));
  return s;
}

/** Lecture prudente de la clé du blob (absente, ancienne ou abîmée : null). */
export function asBackupStatus(v: unknown): BackupStatus | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.at !== "string" || Number.isNaN(Date.parse(o.at))) return null;
  return o as unknown as BackupStatus;
}

/** Le plus récent des deux états (fin du passage, ou début s'il tourne encore). */
export function latestStatus(a: unknown, b: unknown): BackupStatus | null {
  const x = asBackupStatus(a);
  const y = asBackupStatus(b);
  if (!x || !y) return x ?? y;
  const t = (s: BackupStatus) => Date.parse(s.endedAt ?? s.at) || 0;
  return t(y) > t(x) ? y : x;
}

const ERRORS: Record<string, string> = {
  api_desactivee: "l'API Google Drive n'est pas activée",
  autorisation_manquante: "Drive n'est pas autorisé, reconnecte Google",
  drive_indisponible: "Google Drive injoignable",
  google_non_connecte: "Google n'est pas connecté",
  envoi_echoue: "le mail n'est pas parti",
  aucun_destinataire: "aucun fondateur avec une adresse mail",
  interrompue: "interrompue avant la fin",
};

/** Code d'erreur en français simple (code inconnu : message court générique). */
export function backupErrorText(code: string | undefined): string {
  return (code && ERRORS[code]) || "erreur inattendue";
}

const TZ = "Europe/Paris";
const year = (d: Date) => new Intl.DateTimeFormat("fr-FR", { year: "numeric", timeZone: TZ }).format(d);
const hour = (d: Date) => new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(d);

/** « 1 nov. à 03:00 » (heure de Paris), avec l'année si ce n'est pas celle de `now`. */
export function backupWhen(d: Date, now: Date): string {
  const day = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", ...(year(d) !== year(now) ? { year: "numeric" } : {}), timeZone: TZ }).format(d);
  return `${day} à ${hour(d)}`;
}

export type BackupLine = { text: string; tone: "ok" | "fail" | "muted" };

/** La ligne affichée sous « Sauvegarde mensuelle ». */
export function backupStatusLine(value: unknown, now: Date = new Date()): BackupLine {
  const s = asBackupStatus(value);
  if (!s) return { text: "Aucune sauvegarde encore", tone: "muted" };
  const at = new Date(s.at);
  if (s.running) {
    if (now.getTime() - at.getTime() < RUNNING_MAX_MS) return { text: `Sauvegarde en cours, lancée à ${hour(at)}`, tone: "muted" };
    return { text: `Dernière sauvegarde : ${backupWhen(at, now)} · échec : ${backupErrorText("interrompue")}`, tone: "fail" };
  }
  const head = `Dernière sauvegarde : ${backupWhen(at, now)}`;
  if (!s.ok) return { text: `${head} · échec : ${backupErrorText(s.error)}`, tone: "fail" };
  if (s.drive && s.drive !== "ok") return { text: `${head} · échec : ${backupErrorText(s.drive)} (archive envoyée par mail)`, tone: "fail" };
  const n = s.missing?.length ?? 0;
  if (n) return { text: `${head} · incomplète : ${n} liste${n > 1 ? "s" : ""} non lue${n > 1 ? "s" : ""}`, tone: "fail" };
  return { text: `${head} · réussie`, tone: "ok" };
}
