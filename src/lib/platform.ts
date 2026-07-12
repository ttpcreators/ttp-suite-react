/**
 * Source unique de vérité pour « la plateforme principale d'un créateur ».
 * Utilisée par le calculateur d'engagement, la fiche roster et le détail —
 * pour qu'ils s'accordent toujours sur ce qui met à jour la fiche.
 */
export type PlatformKey = "instagram" | "tiktok" | "youtube" | "x" | "snapchat";

export function isMainPlatform(creatorPlatform: string | null | undefined, key: string): boolean {
  const cp = (creatorPlatform ?? "").toLowerCase().trim();
  if (!cp) return true; // pas de plateforme principale définie → on met à jour
  if (key === "instagram") return cp.includes("insta");
  if (key === "tiktok") return cp.includes("tiktok") || cp.includes("tik tok");
  if (key === "youtube") return cp.includes("youtube") || cp.includes("yt");
  if (key === "snapchat") return cp.includes("snap");
  return cp === "x" || cp.includes("twitter") || /(^|\s)x($|\s)/.test(cp);
}
