import { supabase } from "./supabase";

/**
 * YouTube des créatrices (« Connecter mon YouTube », Google OAuth en lecture seule) :
 * elles connectent leur chaîne (yt-connect → Google → yt-callback), yt-sync relit chaque
 * jour leur chaîne, leurs vidéos et leurs stats YouTube Studio → creators.yt ; les
 * vidéos qui citent la marque d'une collab → collabs.yt.
 */

export type YtVideoLite = { id: string; url: string; cover?: string; title?: string; at: string; short?: boolean; paid?: boolean; views: number | null; likes: number | null; comments: number | null };
export type YtCreator = {
  link?: { channel?: string; title?: string | null; handle?: string | null; at?: string } | null;
  channelId?: string; title?: string; handle?: string; avatar?: string; url?: string; country?: string | null;
  subscribers?: number | null; hiddenSubs?: boolean; views?: number | null; videos?: number | null;
  history?: { d: string; f: number }[];
  recent?: YtVideoLite[];
  avgViews?: number | null; avgShortViews?: number | null; er?: number | null; perWeek?: number | null; lastPost?: string | null;
  a30?: {
    from?: string; to?: string; views?: number | null; minutes?: number | null; avgDuration?: number | null; avgPct?: number | null;
    subsGained?: number | null; subsLost?: number | null; likes?: number | null; comments?: number | null; shares?: number | null;
    byType?: Record<string, number>;
  };
  audience?: { age?: { k: string; pct: number }[]; gender?: { female: number; male: number; other: number } | null; countries?: { k: string; pct: number }[] };
  at?: string; ok?: string; why?: string | null;
};
export type YtCollab = { at?: string; posts?: YtVideoLite[] };

const YT_WHY: Record<string, string> = {
  jeton: "le lien avec YouTube a expiré : elle doit reconnecter sa chaîne",
  portee: "elle n'a pas coché toutes les autorisations : à reconnecter",
  quota: "YouTube freine les demandes, nouvel essai demain",
  api_off: "l'API YouTube n'est pas activée dans Google Cloud",
  pas_de_chaine: "ce compte Google n'a pas de chaîne YouTube",
  reseau: "YouTube n'a pas répondu, nouvel essai plus tard",
  non_connecte: "YouTube pas connecté",
  youtube_non_configure: "la connexion YouTube n'est pas encore activée",
};
export const ytWhyText = (why?: string | null) => (why ? YT_WHY[why] ?? `YouTube a refusé (${why})` : "");

/** Lance la connexion YouTube d'une créatrice (redirige vers Google). */
export async function ytConnect(creator?: string): Promise<string | null> {
  const origin = window.location.origin + window.location.pathname;
  const { data, error } = await supabase.functions.invoke("yt-connect", { body: { action: "start", origin, creator } });
  const url = (data as { url?: string } | null)?.url;
  if (!error && url) {
    window.location.href = url;
    return null;
  }
  const why = (data as { error?: string } | null)?.error;
  return why === "youtube_non_configure" ? "La connexion YouTube n'est pas encore activée par l'agence" : "Connexion impossible pour l'instant, réessaie";
}
export async function ytDisconnect(creator?: string): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke("yt-connect", { body: { action: "disconnect", creator } });
  return !error && !!(data as { ok?: boolean } | null)?.ok;
}
/** « Actualiser » maintenant (agence). */
export async function ytRefresh(id: string): Promise<{ yt?: YtCreator; error?: string }> {
  const { data, error } = await supabase.functions.invoke("yt-sync", { body: { scope: "creator", id } });
  if (error) return { error: "reseau" };
  return (data as { yt?: YtCreator; error?: string }) ?? { error: "reseau" };
}

const RETURN_TEXT: Record<string, string> = {
  connected: "YouTube connecté ✓ Tes stats arrivent toutes seules",
  nochannel: "Ce compte Google n'a pas de chaîne YouTube : choisis le compte de ta chaîne",
  scopes: "Coche les deux autorisations sur la page Google pour connecter ta chaîne",
  error: "Connexion YouTube annulée",
};
/** Retour de Google (?youtube=…) : nettoie l'adresse et renvoie le message à afficher. */
export function consumeYtReturn(): string | null {
  const url = new URL(window.location.href);
  const flag = url.searchParams.get("youtube");
  if (!flag) return null;
  url.searchParams.delete("youtube");
  window.history.replaceState({}, "", url.toString());
  return RETURN_TEXT[flag] ?? RETURN_TEXT.error;
}

/** Durée en secondes → « 4 min 12 s ». */
export function fmtDuration(s?: number | null): string {
  if (s == null || !Number.isFinite(s)) return "—";
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m ? `${m} min${r ? ` ${r} s` : ""}` : `${r} s`;
}
