/*
 * Petites protections pures pour les adresses et fichiers venus de l'extérieur.
 * Testées par safeUrl.test.ts.
 */

/** Adresse d'image utilisable dans un attribut src d'un HTML écrit à la main : http(s) ou
 *  image en data:, échappée pour l'attribut. Tout le reste (javascript:, guillemets…) → "". */
export function safeImgSrc(url: string | null | undefined): string {
  const u = String(url ?? "").trim();
  if (!/^(https?:\/\/|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(u)) return "";
  return u.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** Types d'image acceptés dans le bucket public « avatars » : des photos, jamais de SVG
 *  (un SVG peut contenir du code). Même liste que supabase/sql/2026-11-27-securite-14.sql. */
export const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic", "image/heif"] as const;

/** Vrai si ce fichier peut aller dans « avatars ». */
export function isAvatarImage(file: { type?: string | null; name?: string | null }): boolean {
  const t = String(file.type ?? "").toLowerCase();
  return (AVATAR_TYPES as readonly string[]).includes(t);
}
