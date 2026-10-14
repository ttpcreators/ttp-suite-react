import { supabase } from "./supabase";

/**
 * TikTok des créatrices (Login Kit) : elles connectent leur compte (tt-connect →
 * TikTok → tt-callback), tt-sync relit chaque jour leur profil et leurs vidéos
 * → creators.tt ; les vidéos qui citent la marque d'une collab → collabs.tt.
 */

export type TtVideoLite = { id: string; url: string; cover?: string; title?: string; at: string; views: number | null; likes: number | null; comments: number | null; shares: number | null };
export type TtCreator = {
  link?: { username?: string | null; at?: string; scopes?: string } | null;
  username?: string; name?: string; avatar?: string; bio?: string; url?: string; verified?: boolean;
  followers?: number | null; following?: number | null; likes?: number | null; videos?: number | null;
  history?: { d: string; f: number }[];
  recent?: TtVideoLite[];
  avgViews?: number | null; avgLikes?: number | null; er?: number | null; perWeek?: number | null; lastPost?: string | null;
  at?: string; ok?: string; why?: string | null;
};
export type TtCollab = { at?: string; posts?: TtVideoLite[] };

const TT_WHY: Record<string, string> = {
  jeton: "le lien avec TikTok a expiré : elle doit reconnecter son TikTok",
  portee: "elle n'a pas accepté toutes les autorisations : à reconnecter",
  limite: "TikTok freine les demandes, nouvel essai plus tard",
  reseau: "TikTok n'a pas répondu, nouvel essai plus tard",
  non_connecte: "TikTok pas connecté",
  tiktok_non_configure: "la connexion TikTok n'est pas encore activée",
};
export const ttWhyText = (why?: string | null) => (why ? TT_WHY[why] ?? `TikTok a refusé (${why})` : "");

/** Lance la connexion TikTok d'une créatrice (redirige vers TikTok). */
export async function ttConnect(creator?: string): Promise<string | null> {
  const origin = window.location.origin + window.location.pathname;
  const { data, error } = await supabase.functions.invoke("tt-connect", { body: { action: "start", origin, creator } });
  const url = (data as { url?: string } | null)?.url;
  if (!error && url) {
    window.location.href = url;
    return null;
  }
  const why = (data as { error?: string } | null)?.error;
  return why === "tiktok_non_configure" ? "La connexion TikTok n'est pas encore activée par l'agence" : "Connexion impossible pour l'instant, réessaie";
}
export async function ttDisconnect(creator?: string): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke("tt-connect", { body: { action: "disconnect", creator } });
  return !error && !!(data as { ok?: boolean } | null)?.ok;
}
/** « Actualiser » maintenant (agence). */
export async function ttRefresh(id: string): Promise<{ tt?: TtCreator; error?: string }> {
  const { data, error } = await supabase.functions.invoke("tt-sync", { body: { scope: "creator", id } });
  if (error) return { error: "reseau" };
  return (data as { tt?: TtCreator; error?: string }) ?? { error: "reseau" };
}
/** Retour de TikTok (?tiktok=connected|error) : nettoie l'adresse et renvoie l'issue. */
export function consumeTtReturn(): "connected" | "error" | null {
  const url = new URL(window.location.href);
  const flag = url.searchParams.get("tiktok");
  if (!flag) return null;
  url.searchParams.delete("tiktok");
  window.history.replaceState({}, "", url.toString());
  return flag === "connected" ? "connected" : "error";
}
