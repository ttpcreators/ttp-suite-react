/*
 * Double authentification (application TOTP : Google Authenticator, 1Password, Authy…),
 * FACULTATIVE : chaque compte l'active s'il le veut, dans Paramètres › Compte (agence) ou les
 * Réglages de l'espace créateur. Une fois activée, l'app demande un code à 6 chiffres après
 * la connexion. Le serveur ne l'exige pas encore (décision de Marc, une fois les fondateurs
 * inscrits). Règles pures, testées par doubleAuth.test.ts ; écrans dans
 * src/components/double-auth.tsx (API MFA de Supabase Auth).
 */

/** Ce que l'utilisateur tape : chiffres seuls, 6 au plus (les espaces collés depuis l'app partent). */
export function nettoyerCode(saisie: string): string {
  return String(saisie ?? "").replace(/\D/g, "").slice(0, 6);
}

export const codeComplet = (code: string) => /^\d{6}$/.test(code);

/** Niveau de la session : un code est attendu (compte inscrit, session sans code). */
export function codeAttendu(niveau: { currentLevel?: string | null; nextLevel?: string | null } | null | undefined): boolean {
  return niveau?.nextLevel === "aal2" && niveau?.currentLevel !== "aal2";
}

/** Le QR code renvoyé par Supabase, en adresse d'image (SVG brut ou déjà en data:). */
export function sourceQr(qr: string): string {
  const v = String(qr ?? "").trim();
  if (!v) return "";
  if (v.startsWith("data:image/")) return v;
  return `data:image/svg+xml;utf-8,${encodeURIComponent(v)}`;
}

/** La clé à taper à la main, par groupes de 4. */
export function cleLisible(secret: string): string {
  return String(secret ?? "").replace(/\s/g, "").replace(/(.{4})(?=.)/g, "$1 ");
}

type Facteur = { id: string; factor_type?: string; status?: string };

/** Facteurs TOTP d'un compte : le vérifié (actif) et ceux laissés en cours d'inscription. */
export function facteursTotp(tous: readonly Facteur[] | null | undefined): { actif: string | null; enCours: string[] } {
  const totp = (tous ?? []).filter((f) => f.factor_type === "totp");
  return {
    actif: totp.find((f) => f.status === "verified")?.id ?? null,
    enCours: totp.filter((f) => f.status !== "verified").map((f) => f.id),
  };
}

/** Refus de Supabase Auth en mots simples (texte français, clé de traduction). */
export function messageErreurDoubleAuth(e: { code?: string | null; message?: string | null } | null | undefined): string {
  const code = String(e?.code ?? "");
  const m = String(e?.message ?? "").toLowerCase();
  if (code === "mfa_verification_failed" || m.includes("invalid totp") || m.includes("invalid code")) return "Code incorrect. Regarde l'application et réessaie.";
  if (code === "mfa_challenge_expired" || m.includes("expired")) return "Code expiré. Tape le nouveau code.";
  if (code.startsWith("mfa_totp_") || code === "mfa_factor_not_found" || m.includes("disabled") || m.includes("not enabled")) return "La double authentification n'est pas ouverte pour l'instant. Préviens l'agence.";
  if (code === "insufficient_aal") return "Entre d'abord un code de ton application.";
  if (code === "too_many_enrolled_mfa_factors") return "Trop d'essais d'activation. Réessaie plus tard.";
  if (code === "over_request_rate_limit" || code === "mfa_verification_rejected" || m.includes("rate limit")) return "Trop d'essais. Attends une minute puis réessaie.";
  return "Ça n'a pas marché. Réessaie dans un instant.";
}
