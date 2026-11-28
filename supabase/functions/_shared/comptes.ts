// ============================================================================
// _shared/comptes.ts : règles PURES des comptes de connexion, testées par comptes.test.ts.
//   • MIN_MOT_DE_PASSE : longueur minimale d'un mot de passe, la même dans l'app
//     (src/lib/passwordRecovery.ts, page Accès) et dans la fonction create-access.
//   • resetAutorise : « Nouveau mot de passe » (create-access, action reset) ne touche jamais
//     le compte d'un autre fondateur, ni un compte sans profil (sauf le sien). Le SQL
//     2026-11-28-comptes-fondateurs-proteges.sql garde le profil d'un fondateur intact.
//   • rattachementCreateur : un nouveau compte créateur vise une fiche qui existe et qui n'a
//     pas déjà son compte.
//   • adresseAgenceAttendue / compteGoogleAgenceOk : la connexion Google de l'app
//     (google_tokens, agenda et boîte partnerships@) n'accepte que la boîte de l'agence.
// ============================================================================

export const MIN_MOT_DE_PASSE = 12;

export type ProfilCible = { role: string | null; agency_role: string | null } | null;

/** Le fondateur `appelant` peut-il remplacer le mot de passe du compte `cible` ? */
export function resetAutorise(appelant: string, cible: string, profil: ProfilCible): boolean {
  if (!appelant || !cible) return false;
  if (cible === appelant) return true;
  if (!profil) return false;
  return !(profil.role === "agency" && profil.agency_role === "founder");
}

/** Refus à renvoyer pour un nouveau compte créateur, sinon null. */
export function rattachementCreateur(nom: string, ficheExiste: boolean, comptesDejaRelies: number): "createur_requis" | "createur_inconnu" | "createur_deja_relie" | null {
  if (!nom.trim()) return "createur_requis";
  if (!ficheExiste) return "createur_inconnu";
  if (comptesDejaRelies > 0) return "createur_deja_relie";
  return null;
}

/** Adresse normalisée, ou null. */
function norm(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  return /^[^@\s<>,;"']+@[^@\s<>,;"']+\.[a-z]{2,}$/.test(s) ? s : null;
}

/**
 * Boîte Google attendue pour la connexion de l'app : le secret GOOGLE_AGENCY_EMAIL s'il est
 * posé, sinon la boîte partnerships@ du domaine de l'agence (AGENCY_MAIL_DOMAIN).
 */
export function adresseAgenceAttendue(secret: string | undefined, domaine: string | undefined): string | null {
  return norm(secret) ?? norm(`partnerships@${String(domaine ?? "").trim() || "ttpcreators.pro"}`);
}

/** L'adresse renvoyée par Google (id_token, adresse vérifiée) est-elle celle attendue ? */
export function compteGoogleAgenceOk(email: unknown, emailVerifie: unknown, attendue: string | null): boolean {
  if (!attendue || emailVerifie === false) return false;
  return norm(email) === attendue;
}
