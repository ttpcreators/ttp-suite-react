/*
 * Scouting → roster (règles PURES, testées par scoutToRoster.test.ts) : quand un profil
 * repéré signe, il passe dans le roster (table `creators`) avec ce que le scouting sait
 * déjà de lui (@, email, niche, abonnés, engagement, plateforme), sans doublon.
 * Aucun compte de connexion n'est créé ici : l'accès se donne toujours par la page Accès.
 */
import { fmtCompact } from "./timeSeries";

export type ScoutProfile = { name: string; handle: string | null; email: string | null; tag: string | null };
export type ScoutStats = { followers: number | null; er: number | null; niche: string | null };
export type RosterLite = { name: string; handle: string | null };

const fold = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** @ comparable : « @Lena.Mrchd », « instagram.com/lena.mrchd/ » → « lena.mrchd ». */
export function handleKey(h: string | null | undefined): string {
  return (h ?? "")
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?(instagram|tiktok)\.com\/@?/i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();
}

/** Déjà dans le roster ? (même @, ou même nom). */
export function inRoster(roster: readonly RosterLite[], p: Pick<ScoutProfile, "name" | "handle">): boolean {
  const h = handleKey(p.handle);
  const n = fold(p.name);
  return roster.some((r) => (h && handleKey(r.handle) === h) || (n && fold(r.name) === n));
}

/** Plateforme principale d'un @ : chaîne YouTube, TikTok, sinon Instagram. */
export function platformOf(handle: string | null | undefined): string {
  if (/youtube\.com|youtu\.be/i.test(handle ?? "")) return "YouTube";
  if (/tiktok\.com/i.test(handle ?? "")) return "TikTok";
  return "Instagram";
}

/** Ligne `creators` créée pour le profil (statut actif, en fin de roster). */
export function rosterRow(p: ScoutProfile, s: ScoutStats, sortOrder: number): Record<string, unknown> {
  const h = handleKey(p.handle);
  const er = s.er != null && Number.isFinite(s.er) ? String(Math.round(s.er * 100) / 100).replace(".", ",") : null;
  return {
    name: p.name.trim(),
    handle: h ? (platformOf(p.handle) === "YouTube" ? (p.handle ?? "").trim() : `@${h}`) : null,
    email: p.email?.trim() || null,
    niche: (p.tag ?? "").trim() || s.niche || null,
    platform: platformOf(p.handle),
    followers: s.followers != null && s.followers > 0 ? fmtCompact(s.followers) : null,
    er,
    status: "actif",
    sort_order: sortOrder,
  };
}
