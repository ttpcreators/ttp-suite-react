/*
 * « Mot de passe oublié » et « Changer mon mot de passe » : règles pures, testées par
 * passwordRecovery.test.ts (l'écran vit dans src/components/password-form.tsx).
 *
 * Le lien du mail de Supabase rouvre l'app avec le jeton dans l'adresse et « type=recovery »
 * (flux implicite, gardé exprès : la demande peut partir de l'app installée sur l'iPhone et
 * le lien s'ouvrir dans Safari, qui n'a pas la clé d'un flux PKCE). Un lien périmé ou déjà
 * servi revient avec « error_code=otp_expired ».
 */

/** Longueur minimale, la même que la page Accès et la fonction create-access. */
export const MIN_MOT_DE_PASSE = 6;

export type RetourLien = "recovery" | "expired" | null;

/** Ce que l'adresse d'ouverture dit du lien du mail : récupération, lien périmé, ou rien. */
export function retourDuLien(hash: string, search = ""): RetourLien {
  const read = (s: string) => new URLSearchParams(String(s ?? "").replace(/^[#?]/, ""));
  const h = read(hash);
  const q = read(search);
  const get = (k: string) => h.get(k) ?? q.get(k);
  if (get("type") === "recovery" && (get("access_token") || get("code") || get("token_hash"))) return "recovery";
  if (get("error_code") === "otp_expired") return "expired";
  if (get("error") === "access_denied" && /expired|invalid/i.test(get("error_description") ?? "")) return "expired";
  return null;
}

/** Adresse où le lien du mail ramène : l'app elle-même (à déclarer dans les Redirect URLs de Supabase Auth). */
export function adresseRetour(origin: string, base = "/"): string {
  try {
    return new URL(base || "/", origin).href;
  } catch {
    return origin;
  }
}

/** Saisie à refuser avant l'envoi : le message (texte français, clé de traduction), sinon null. */
export function motDePasseInvalide(motDePasse: string, confirmation: string): string | null {
  if (motDePasse.length < MIN_MOT_DE_PASSE) return "6 caractères au moins.";
  if (motDePasse !== confirmation) return "Les deux mots de passe ne sont pas identiques.";
  return null;
}

/** Refus de Supabase Auth en mots simples (texte français, clé de traduction). */
export function messageErreurMotDePasse(e: { code?: string | null; message?: string | null } | null | undefined): string {
  const code = String(e?.code ?? "");
  const m = String(e?.message ?? "").toLowerCase();
  if (code === "same_password" || m.includes("different from the old")) return "Le mot de passe doit être différent de l'ancien.";
  if (code === "weak_password" || m.includes("at least")) return "6 caractères au moins.";
  if (code === "reauthentication_needed" || code === "session_not_found" || m.includes("reauthentication") || m.includes("session")) return "Pour des raisons de sécurité, reconnecte-toi puis réessaie.";
  return "Ça n'a pas marché. Réessaie dans un instant.";
}
