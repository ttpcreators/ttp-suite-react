import { supabase } from "@/lib/supabase";

/**
 * Coupe les connexions Claude encore ouvertes du compte connecté (mcp_grants.revoked_at,
 * seule colonne qu'un compte peut écrire, sur ses propres lignes). Appelé après un changement
 * de mot de passe et à l'ouverture d'un lien « Mot de passe oublié » : une connexion ouverte
 * avec l'ancien mot de passe (ou depuis une session volée) ne survit pas. Le déclencheur du SQL
 * 2026-11-28-comptes-connexions-claude fait de même côté serveur. Renvoie le nombre coupé
 * (0 pour un créateur, qui n'en a pas ; 0 aussi en cas d'échec, jamais bloquant).
 */
export async function couperMesConnexionsClaude(): Promise<number> {
  try {
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user.id;
    if (!uid) return 0;
    const { data, error } = await supabase
      .from("mcp_grants")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", uid)
      .is("revoked_at", null)
      .select("id");
    if (error) return 0;
    return (data ?? []).length;
  } catch {
    return 0;
  }
}
