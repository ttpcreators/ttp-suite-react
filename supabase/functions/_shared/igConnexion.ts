// ============================================================================
// _shared/igConnexion.ts : règles PURES de la connexion Instagram des créatrices
// (« Connecter mon Instagram », Instagram API with Instagram Login).
// ----------------------------------------------------------------------------
// • raisonEchec(étape, message de Meta) → raison courte (refus, pas_pro, expire…).
// • MESSAGES_RAISON : ce que voit la créatrice (titre, quoi faire) ; RAISON_AGENCE :
//   la même raison en une ligne pour la fiche (vue agence).
// • etatConnexion(…) : connecté, bientôt expiré, expiré, échec, jamais tenté.
// • signerLien / lireLien : lien de connexion envoyé par WhatsApp (7 jours, une
//   créatrice), signé HMAC-SHA256 avec le secret du serveur (STATE_SIGNING_SECRET).
// Sans réseau ni API Deno : lu par ig-callback, ig-connect, ttp-mcp ET par l'app
// (src/lib/instagram.ts) ; testé par igConnexion.test.ts.
// ============================================================================

/** Où la tentative s'est arrêtée (colonne ig_connexions.etape). */
export type Etape =
  | "lien" // lien WhatsApp illisible, expiré ou créatrice inconnue
  | "etat" // retour d'Instagram avec un state expiré ou invalide
  | "configuration" // secrets Instagram absents côté serveur
  | "autorisation" // la page d'accord d'Instagram a renvoyé une erreur (refus…)
  | "echange" // code → jeton court refusé par Meta
  | "jeton_long" // jeton court → jeton 60 jours refusé
  | "profil" // lecture du compte (id, @, type) impossible
  | "compte_pas_pro" // compte personnel
  | "enregistrement" // écriture en base ratée
  | "ok";

/** Raison affichée (paramètre `raison` du retour, colonne ig_connexions.raison). */
export type Raison = "refus" | "pas_pro" | "pas_autorise" | "expire" | "lien_invalide" | "agence";
export const RAISONS: readonly Raison[] = ["refus", "pas_pro", "pas_autorise", "expire", "lien_invalide", "agence"];

/** Lit un paramètre d'adresse : une raison connue, sinon « agence » (jamais un texte libre). */
export function lireRaison(v: string | null | undefined): Raison {
  return (RAISONS as readonly string[]).includes(String(v ?? "")) ? (v as Raison) : "agence";
}

/**
 * Raison d'un échec, à partir de l'étape et du message brut de Meta. Tout ce qui
 * n'est pas du fait de la créatrice (adresse de retour, clé secrète, réseau, base)
 * donne « agence » : ce n'est pas à elle de le régler.
 */
export function raisonEchec(etape: Etape, message = ""): Raison {
  const m = message.toLowerCase();
  if (etape === "lien") return "lien_invalide";
  if (etape === "etat") return "expire";
  if (etape === "compte_pas_pro") return "pas_pro";
  if (/pro_account|professional|business account|creator account|personal account/.test(m)) return "pas_pro";
  if (/insufficient developer role|tester|app role|not authorized for this app|not been approved/.test(m)) return "pas_autorise";
  if (etape === "autorisation") return /denied|cancel/.test(m) ? "refus" : "agence";
  if (etape === "echange" && /already used|has been used|matching code was not found|expired/.test(m)) return "expire";
  return "agence";
}

/** Ce que voit la créatrice, en français simple (traduit à l'affichage par l'espace). */
export const MESSAGES_RAISON: Record<Raison, { titre: string; texte: string }> = {
  refus: {
    titre: "Tu as refusé l'accès",
    texte: "Instagram ne nous a rien transmis. Si c'était une erreur, réessaie et touche « Autoriser ».",
  },
  pas_pro: {
    titre: "Ton compte Instagram n'est pas un compte professionnel",
    texte: "Dans Instagram : Paramètres › Compte › Passer à un compte professionnel (Créateur), puis réessaie.",
  },
  pas_autorise: {
    titre: "Ton compte n'est pas encore autorisé par Meta",
    texte: "L'agence est prévenue : elle t'ajoute et te dit quand réessayer.",
  },
  expire: {
    titre: "La connexion a expiré",
    texte: "Ça a pris un peu trop de temps. Recommence, ça prend une minute.",
  },
  lien_invalide: {
    titre: "Ce lien n'est plus valable",
    texte: "Demande un nouveau lien à l'agence, ou connecte ton Instagram depuis ton espace TTP.",
  },
  agence: {
    titre: "Problème de notre côté",
    texte: "Ce n'est pas toi : l'agence est prévenue et règle ça. Tu pourras réessayer ensuite.",
  },
};

/** La même raison en une ligne, pour la fiche de la créatrice (vue agence). */
export const RAISON_AGENCE: Record<Raison, string> = {
  refus: "elle a refusé l'accès",
  pas_pro: "compte personnel, pas professionnel",
  pas_autorise: "compte pas autorisé par Meta (testeur ou validation)",
  expire: "connexion expirée en route",
  lien_invalide: "lien de connexion invalide ou expiré",
  agence: "réglage Meta ou serveur (message de Meta ci-dessous)",
};

/** Compte pro ? true / false ; null si Meta n'a pas donné le type (on ne bloque pas). */
export function estComptePro(accountType: unknown): boolean | null {
  const t = String(accountType ?? "").trim().toUpperCase();
  if (!t) return null;
  return t === "BUSINESS" || t === "MEDIA_CREATOR" || t === "CREATOR";
}

// ── État de la connexion (fiche agence, bandeau de l'espace créatrice) ───────
export const JOUR_MS = 86_400_000;
/** En dessous, le jeton « expire bientôt » : bandeau « Reconnecte ton Instagram ». */
export const ALERTE_EXPIRATION_MS = 7 * JOUR_MS;

export type EtatConnexion = "connecte" | "bientot_expire" | "expire" | "echec" | "jamais";
export type EssaiIg = { at: string; ok: boolean; raison?: string | null; etape?: string | null; message?: string | null };

export function etatConnexion(
  x: { link?: { expires?: string | null } | null; jetonInvalide?: boolean; dernier?: EssaiIg | null },
  now = Date.now(),
): { etat: EtatConnexion; joursRestants: number | null } {
  if (x.link) {
    const exp = x.link.expires ? Date.parse(x.link.expires) : NaN;
    const reste = Number.isFinite(exp) ? exp - now : null;
    const jours = reste == null ? null : Math.max(0, Math.ceil(reste / JOUR_MS));
    if (x.jetonInvalide || (reste != null && reste <= 0)) return { etat: "expire", joursRestants: 0 };
    if (reste != null && reste < ALERTE_EXPIRATION_MS) return { etat: "bientot_expire", joursRestants: jours };
    return { etat: "connecte", joursRestants: jours };
  }
  if (x.dernier && !x.dernier.ok) return { etat: "echec", joursRestants: null };
  return { etat: "jamais", joursRestants: null };
}

/** Essais ratés depuis la dernière réussite (liste du plus récent au plus ancien). */
export function essaisRates(liste: EssaiIg[]): number {
  let n = 0;
  for (const e of liste) {
    if (e.ok) break;
    n++;
  }
  return n;
}

// ── Lien de connexion signé (WhatsApp) ───────────────────────────────────────
export const LIEN_IG_TTL_MS = 7 * JOUR_MS;
const LIEN_KIND = "ig-lien";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const IG_CALLBACK_URL = "https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ig-callback";
/** Page de fin du lien (statique, sans compte TTP) : public/instagram-relie/index.html. */
export const PAGE_FIN_IG = "https://app.ttpcreators.pro/instagram-relie/";
/** Adresse à envoyer à la créatrice. */
export const urlLien = (jeton: string) => `${IG_CALLBACK_URL}?lien=${encodeURIComponent(jeton)}`;

const b64url = (bytes: Uint8Array) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = (s: string) => {
  let b = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b.length % 4) b += "=";
  const bin = atob(b);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}
function memes(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** Jeton du lien : base64url({ k, c: id créatrice, iat }) + "." + signature. */
export async function signerLien(secret: string, creatorId: string, now = Date.now()): Promise<string> {
  if (!secret) throw new Error("secret_manquant");
  if (!UUID.test(creatorId)) throw new Error("createur_invalide");
  const p = b64url(new TextEncoder().encode(JSON.stringify({ k: LIEN_KIND, c: creatorId.toLowerCase(), iat: now })));
  return `${p}.${b64url(await hmac(secret, p))}`;
}

export type LienLu = { ok: true; creatorId: string; iat: number } | { ok: false; raison: "forme" | "signature" | "expire"; creatorId?: string };

/**
 * Vérifie un lien : forme, signature, type (un state OAuth ou un lien de boîte Gmail,
 * signés avec le même secret, sont refusés), créatrice (uuid), date (7 jours, pas dans
 * le futur). La créatrice doit ENCORE exister au roster : vérifié par l'appelant.
 */
export async function lireLien(secret: string, jeton: string, now = Date.now()): Promise<LienLu> {
  const parts = String(jeton ?? "").split(".");
  if (!secret || parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return { ok: false, raison: "forme" };
  let sig: Uint8Array;
  try {
    sig = fromB64url(parts[1]);
  } catch {
    return { ok: false, raison: "forme" };
  }
  if (!memes(await hmac(secret, parts[0]), sig)) return { ok: false, raison: "signature" };
  let p: { k?: unknown; c?: unknown; iat?: unknown };
  try {
    p = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
  } catch {
    return { ok: false, raison: "forme" };
  }
  if (p?.k !== LIEN_KIND || typeof p.c !== "string" || !UUID.test(p.c) || typeof p.iat !== "number") return { ok: false, raison: "forme" };
  if (p.iat > now + 5 * 60_000 || now - p.iat > LIEN_IG_TTL_MS) return { ok: false, raison: "expire", creatorId: p.c };
  return { ok: true, creatorId: p.c, iat: p.iat };
}

/** Message brut de Meta, sur une ligne, sans jeton ni clé (400 caractères au plus). */
export function messageBrut(v: unknown): string {
  const s = typeof v === "string" ? v : (() => {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  })();
  return s
    .replace(/(access_token|client_secret|code)=([^&\s"]+)/gi, "$1=…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}
