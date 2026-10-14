// ============================================================================
// _shared/youtube.ts : YouTube Data API v3 (clé YT_API_KEY), partagé par
// yt-radar (radar à collabs YouTube). Compte des unités consommées (quota Google :
// 10 000 par jour ; recherche = 100, le reste = 1 par lot de 50) → yt_quota.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { tidySecret } from "./instagram.ts";

type Json = Record<string, unknown>;
export const YT_KEY = tidySecret(Deno.env.get("YT_API_KEY"));
const API = "https://www.googleapis.com/youtube/v3";
export const YT_DAILY = 10_000;

/** Unités de cet appel (remises à zéro au début de chaque requête). */
export const ytUsage = { units: 0, quotaHit: false, reset() { this.units = 0; this.quotaHit = false; } };

export async function yt(path: string, params: Record<string, string>, cost = 1): Promise<Json> {
  ytUsage.units += cost;
  const qs = new URLSearchParams({ ...params, key: YT_KEY });
  try {
    const r = await fetch(`${API}/${path}?${qs}`, { signal: AbortSignal.timeout(15_000) });
    const body = (await r.json().catch(() => ({}))) as Json;
    const reason = ((body.error as Json | undefined)?.errors as Json[] | undefined)?.[0]?.reason;
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") ytUsage.quotaHit = true;
    return body;
  } catch {
    return { error: { message: "reseau" } };
  }
}

/** Unités déjà consommées aujourd'hui (yt_quota), avant cet appel. */
export async function ytUsedToday(sb: SupabaseClient): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const { data } = await sb.from("yt_quota").select("units").eq("day", day).maybeSingle<{ units: number }>();
  return data?.units ?? 0;
}
export async function ytSaveQuota(sb: SupabaseClient) {
  const day = new Date().toISOString().slice(0, 10);
  const total = (await ytUsedToday(sb)) + ytUsage.units;
  await sb.from("yt_quota").upsert({ day, units: total });
  return { used: total, limit: YT_DAILY, blocked: ytUsage.quotaHit };
}

// ── Marques d'une vidéo sponsorisée ──────────────────────────────────────────
// Domaines qui ne sont pas une marque (réseaux, liens courts, outils, cagnottes).
const NOT_BRAND = /(^|\.)(youtube|youtu|instagram|tiktok|facebook|fb|twitter|x|threads|snapchat|pinterest|linkedin|twitch|discord|spotify|deezer|apple|google|goo|bit|tinyurl|linktr|beacons|linkin|lnk|campsite|bio|hoo|stan|patreon|paypal|tipeee|gofundme|wikipedia|gmail|outlook|t|wa|whatsapp|telegram|amzn|amazon-adsystem|utip|ko-fi|buymeacoffee|streamlabs|discordapp|reddit|vimeo|dailymotion|soundcloud|canva|notion)\.[a-z.]+$/i;
const PREFIX = /^(www|shop|store|boutique|fr|eu|uk|us|en|m|go|click|lien|links?|get|try|app|offer|offre|promo|deals?)\./;
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gouv"]);

/** « fr.gymshark.com » → « gymshark » (clé de marque tirée d'un domaine). */
export function domainLabel(host: string): string {
  let h = host.toLowerCase().replace(/\.$/, "");
  while (PREFIX.test(h)) h = h.replace(PREFIX, "");
  const parts = h.split(".");
  if (parts.length >= 3 && SECOND_LEVEL.has(parts[parts.length - 2])) return parts[parts.length - 3];
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
}

/** Clé stable d'une marque : minuscules, sans accents ni ponctuation. */
export const brandKey = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();

const SPONSOR = /(?:sponsoris[ée]e?s?\s+par|en\s+partenariat\s+avec|partenariat\s+avec|en\s+collaboration\s+avec|merci\s+(?:à|a)|gr[âa]ce\s+(?:à|a)|offerte?s?\s+par|sponsored\s+by|thanks\s+to|in\s+partnership\s+with|chez|sur\s+le\s+site\s+(?:de|d'))\s+((?:[A-Z][\w&'’.+-]*)(?:\s+[A-Z][\w&'’.+-]*){0,2})/g;
const STOP_NAMES = new Set(["la", "le", "les", "vous", "tous", "toutes", "moi", "toi", "lui", "elle", "eux", "mon", "ma", "mes", "notre", "nos", "youtube", "instagram", "tiktok", "abonnés", "abonnes", "dieu", "vos", "mes", "tous", "la vidéo", "this"]);

/**
 * Marques citées dans une vidéo sponsorisée : domaines des liens (hors réseaux et
 * liens courts), @ cités, et noms après « sponsorisé par / en partenariat avec /
 * merci à / chez… ». Renvoie { key, name } (clé commune aux trois sources).
 */
export function brandsInVideo(text: string): { key: string; name: string }[] {
  const out = new Map<string, string>();
  const add = (key: string, name: string, strong = false) => {
    if (!key || key.length < 3 || STOP_NAMES.has(name.toLowerCase())) return;
    if (!out.has(key) || strong) out.set(key, name);
  };
  for (const m of text.matchAll(/https?:\/\/(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) {
    const host = m[1].toLowerCase();
    if (NOT_BRAND.test(host)) continue;
    const label = domainLabel(host);
    add(brandKey(label), label.charAt(0).toUpperCase() + label.slice(1));
  }
  for (const m of text.matchAll(/(?:^|[\s(])@([A-Za-z0-9._-]{3,30})/g)) {
    const h = m[1].replace(/\.+$/, "");
    add(brandKey(h), `@${h.toLowerCase()}`);
  }
  for (const m of text.matchAll(SPONSOR)) {
    const name = m[1].replace(/[.’']+$/, "").trim();
    if (name.length < 3 || name.split(/\s+/).length > 3) continue;
    add(brandKey(name), name, true); // nom écrit par la créatrice : prioritaire pour l'affichage
  }
  return [...out.entries()].map(([key, name]) => ({ key, name })).slice(0, 6);
}
