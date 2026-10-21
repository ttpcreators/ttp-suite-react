// ============================================================================
// _shared/backup.ts : sauvegarde mensuelle (fonction monthly-backup).
// Logique pure, testée : CSV lisibles dans Excel (FR), mail avec pièce jointe,
// repérage des PDF de media kit sur le site public.
// ============================================================================

/** Valeur d'une cellule : objets et listes en JSON, dates telles quelles, rien = vide. */
function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  // Point-virgule (Excel en français), guillemets doublés, retours à la ligne gardés.
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Lignes → CSV « Excel France » : séparateur « ; », BOM UTF-8 (accents corrects),
 * colonnes = union des clés dans l'ordre d'apparition.
 */
export function toCsv(rows: Record<string, unknown>[]): string {
  const cols: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  const lines = [cols.map(cell).join(";"), ...rows.map((r) => cols.map((c) => cell(r[c])).join(";"))];
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** « 2026-10 » (mois de la sauvegarde, heure de Paris). */
export function backupMonth(d: Date): string {
  const p = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).format(d);
  return p.slice(0, 7);
}

/** Réglages de l'agence à sauvegarder : tout, SAUF le coffre des mots de passe. */
export const EXCLUDED_APP_KEYS = ["credVault"];
export function safeAppState(state: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(state)) if (!EXCLUDED_APP_KEYS.includes(k)) out[k] = v;
  return out;
}

/** Pages media kit listées dans le plan du site (sitemap.xml). */
export function mediakitPages(sitemapXml: string, origin: string): string[] {
  const out: string[] = [];
  for (const m of sitemapXml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    const url = m[1];
    if (url.startsWith(origin + "/mediakit/") && !out.includes(url)) out.push(url);
  }
  return out;
}

/** Slug d'une page media kit (« …/mediakit/lena/ » → « lena », « …/lena/en/ » → « lena-en »). */
export function mediakitSlug(pageUrl: string): string {
  const path = new URL(pageUrl).pathname.replace(/^\/mediakit\//, "").replace(/\/+$/, "");
  return path.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "") || "media-kit";
}

/** Liens PDF d'une page (relatifs → absolus), sans doublon. */
export function pdfLinksIn(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/href\s*=\s*"([^"]+\.pdf)(?:[?#][^"]*)?"/gi)) {
    try {
      const u = new URL(m[1], pageUrl).toString();
      if (!out.includes(u)) out.push(u);
    } catch {
      /* lien illisible : ignoré */
    }
  }
  return out;
}

/** Base64 d'un gros fichier, par morceaux (btoa seul déborde la pile). */
export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(bin);
}

const b64Utf8 = (s: string) => toBase64(new TextEncoder().encode(s));
/** Objet de mail avec accents (RFC 2047). */
export const encHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64Utf8(s)}?=`);
const lines76 = (b64: string) => b64.replace(/(.{76})/g, "$1\r\n");

/** Mail MIME (corps HTML + pièces jointes) prêt pour l'API Gmail (raw, avant base64url). */
export function mimeMessage(o: {
  from: string; to: string[]; subject: string; html: string;
  attachments?: { filename: string; mimeType: string; bytes: Uint8Array }[];
  boundary?: string;
}): string {
  const head = [`From: ${o.from}`, `To: ${o.to.join(", ")}`, `Subject: ${encHeader(o.subject)}`, "MIME-Version: 1.0"];
  const body = lines76(b64Utf8(o.html));
  const files = o.attachments ?? [];
  if (!files.length) return [...head, 'Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", body].join("\r\n");
  const b = o.boundary ?? "ttp_backup_" + Date.now().toString(36);
  const parts = [...head, `Content-Type: multipart/mixed; boundary="${b}"`, "", `--${b}`, 'Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", body];
  for (const f of files) {
    const fn = encHeader(f.filename.replace(/["\r\n\\]/g, ""));
    parts.push(`--${b}`, `Content-Type: ${f.mimeType}; name="${fn}"`, "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${fn}"`, "", lines76(toBase64(f.bytes)));
  }
  parts.push(`--${b}--`, "");
  return parts.join("\r\n");
}

/** base64url (format « raw » de l'API Gmail). */
export const base64Url = (s: string) => b64Utf8(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
