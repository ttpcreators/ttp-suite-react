/**
 * Google Drive, juste ce qu'il faut pour ranger les sauvegardes : un dossier, des fichiers.
 * Autorisation « drive.file » : l'app ne voit QUE les fichiers qu'elle a créés elle-même,
 * jamais le reste du Drive.
 */
const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";

export type DriveError = "autorisation_manquante" | "api_desactivee" | "drive_indisponible";

export class DriveFail extends Error {
  constructor(public code: DriveError, detail = "") {
    super(`${code}${detail ? `: ${detail}` : ""}`);
  }
}

/** Code d'erreur lisible à partir d'une réponse Drive en échec. */
export function driveErrorOf(status: number, body: string): DriveError {
  if (status === 403 && /accessNotConfigured|has not been used|is disabled/i.test(body)) return "api_desactivee";
  if (status === 401 || (status === 403 && /insufficient|scope|permission/i.test(body))) return "autorisation_manquante";
  return "drive_indisponible";
}

async function call(token: string, url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(60_000) });
  const text = await r.text();
  if (!r.ok) throw new DriveFail(driveErrorOf(r.status, text), `${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** Fichier (ou dossier) créé par l'app, par nom, dans `parent` (racine sinon). */
async function find(token: string, name: string, parent: string | null, folder: boolean): Promise<string | null> {
  const where = [`name = '${q(name)}'`, "trashed = false", folder ? `mimeType = '${FOLDER}'` : `mimeType != '${FOLDER}'`, `'${parent ?? "root"}' in parents`];
  const res = await call(token, `${API}?${new URLSearchParams({ q: where.join(" and "), fields: "files(id)", pageSize: "1", spaces: "drive" })}`);
  const files = (res.files ?? []) as { id: string }[];
  return files[0]?.id ?? null;
}

/** Dossier `name` dans `parent` (créé s'il n'existe pas). */
export async function ensureFolder(token: string, name: string, parent: string | null = null): Promise<string> {
  const found = await find(token, name, parent, true);
  if (found) return found;
  const res = await call(token, `${API}?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }),
  });
  return String(res.id);
}

/**
 * Envoie un fichier dans `folder`. S'il existe déjà sous ce nom, il est REMPLACÉ (même
 * fichier, nouvelle version) : relancer la sauvegarde du mois ne crée pas de doublon.
 */
export async function putFile(token: string, folder: string, name: string, mimeType: string, bytes: Uint8Array): Promise<string> {
  const existing = await find(token, name, folder, false);
  if (existing) {
    await call(token, `${UPLOAD}/${existing}?uploadType=media&fields=id`, { method: "PATCH", headers: { "Content-Type": mimeType }, body: new Blob([bytes as BlobPart], { type: mimeType }) });
    return existing;
  }
  const boundary = `ttp${crypto.randomUUID().replace(/-/g, "")}`;
  const meta = JSON.stringify({ name, parents: [folder], mimeType });
  const enc = new TextEncoder();
  const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
  const tail = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);
  const res = await call(token, `${UPLOAD}?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: new Blob([body as BlobPart]),
  });
  return String(res.id);
}
