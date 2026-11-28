/*
 * Règles pures pour les fichiers du stockage et les exports (testées par fichierSur.test.ts).
 * Ni React ni Supabase ici : le module est importé par les tests sous Node.
 */

/** Origine du projet Supabase (stockage des fichiers). */
export const STOCKAGE_ORIGINE = "https://zizvggziggswhrbuyhuo.supabase.co";

/** Dossier des contrats HTML générés par l'agence, seuls fichiers affichés par /document/. */
const CONTRATS = "/storage/v1/object/sign/documents/contracts/";

/**
 * Lien signé d'un contrat HTML de l'agence, lisible par la page /document/ : renvoie
 * l'adresse normalisée (celle qu'on charge ensuite), ou null pour tout autre lien.
 * L'adresse est lue par `new URL()` AVANT le contrôle : « .. » et « %2e%2e » sont déjà
 * résolus, comme le fera le chargement. Même règle que public/document/voir.js.
 */
export function lienContrat(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.origin !== STOCKAGE_ORIGINE || u.username || u.password) return null;
  const p = u.pathname;
  if (!p.startsWith(CONTRATS)) return null;
  // Un seul nom de fichier sous contracts/, sans encodage (pas de « %2f » ni de « \ »).
  if (!/^[A-Za-z0-9._-]+\.html?$/i.test(p.slice(CONTRATS.length))) return null;
  return u.href;
}

/** Genre d'un fichier, d'après l'extension de son chemin de stockage (jamais d'après le nom
 *  affiché, choisi par celui qui dépose). */
export type GenreFichier = "image" | "pdf" | "html" | "other";

export function genreFichier(path: string): GenreFichier {
  const nom = String(path ?? "").split(/[?#]/)[0];
  const ext = nom.includes(".") ? (nom.split(".").pop() ?? "").toLowerCase() : "";
  if (["png", "jpg", "jpeg", "gif", "webp", "avif"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (ext === "html" || ext === "htm") return "html";
  return "other";
}

/** Vrai si les premiers octets sont ceux d'un PDF (« %PDF- »). */
export function estPdf(octets: Uint8Array): boolean {
  const sig = [0x25, 0x50, 0x44, 0x46, 0x2d];
  return octets.length >= sig.length && sig.every((b, i) => octets[i] === b);
}

/**
 * Cellule d'export CSV sans formule : Excel, Numbers et Sheets exécutent une cellule qui
 * commence par =, +, -, @, une tabulation ou un retour. On la préfixe d'une apostrophe.
 */
export function sansFormule(v: unknown): string {
  const s = String(v ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** Inverse de sansFormule, à la relecture d'un export de l'app : « '+33 6… » redevient
 *  « +33 6… ». Une apostrophe devant autre chose reste. */
export function retirerApostrophe(s: string): string {
  return /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s;
}

/** Chemin d'un fichier dans le bucket public « avatars », rangé dans le dossier du compte
 *  qui le dépose (creators/<id du compte>/…). Sans compte connu : le chemin tel quel. */
export function cheminAvatar(uid: string | null | undefined, reste: string): string {
  const id = String(uid ?? "").trim();
  const r = reste.replace(/^\/+/, "");
  return /^[0-9a-f-]{36}$/i.test(id) ? `creators/${id.toLowerCase()}/${r}` : r;
}

/** Extensions acceptées dans « avatars » (règle avatars_obj_insert, SQL 2026-11-28). */
const EXT_IMAGE = ["jpg", "jpeg", "jfif", "png", "webp", "gif", "avif", "heic", "heif"];

/** Extension d'une photo à déposer : celle du nom si elle est permise, sinon celle de son
 *  type (image/png → png), sinon jpg. */
export function extensionImage(file: { name?: string | null; type?: string | null }): string {
  const nom = String(file.name ?? "");
  const ext = nom.includes(".") ? (nom.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  if (EXT_IMAGE.includes(ext)) return ext;
  const duType = String(file.type ?? "").toLowerCase().replace(/^image\//, "");
  return EXT_IMAGE.includes(duType) ? duType : "jpg";
}
