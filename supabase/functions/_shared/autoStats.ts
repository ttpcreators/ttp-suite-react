// ============================================================================
// _shared/autoStats.ts : stats du mois RELEVÉES TOUTES SEULES (synchros TikTok et
// Instagram), pour ne plus demander de captures chaque mois quand l'app reçoit déjà
// les chiffres.
// ----------------------------------------------------------------------------
//  • recordAutoMeasure : une mesure d'engagement par créateur, réseau et mois dans
//    l'historique (clé `engagementHistory`, même forme que le calculateur de la page
//    Engagement), écrite en PARTIEL (app_state_list) : rien d'autre n'est réécrit.
//    Une mesure saisie à la main ce mois-ci compte aussi : on n'en ajoute pas.
//  • markStatsMonth : coche « stats du mois à jour » (creators.stats_month), que lisent
//    le Roster, la notification du matin et l'espace créateur. Seulement quand le réseau
//    PRINCIPAL du créateur est couvert en entier.
// Les dates sont celles de Paris (un relevé à 1 h le 1er compte pour le bon mois).
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type Json = Record<string, unknown>;
export type AutoPlatform = "instagram" | "tiktok" | "youtube";

const LABEL: Record<AutoPlatform, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" };
// Mêmes repères que le calculateur (src/views/Engagement.tsx, PLATFORMS : bon / excellent).
const BAREME: Record<AutoPlatform, [number, number]> = { instagram: [3, 6], tiktok: [4.5, 9], youtube: [2, 5] };
const MAX_HISTORY = 400;

/** Mois de Paris « 2026-10 » (même format que le Roster). */
export function parisMonth(d = new Date()): string {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).format(d);
}
/** Jour de Paris « 21/10/2026 » (même format que les mesures saisies à la main). */
export function parisDay(d = new Date()): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}
/** « jj/mm/aaaa » → « aaaa-mm » (vide si illisible). */
const monthOfFr = (s: unknown) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s ?? ""));
  return m ? `${m[3]}-${m[2].padStart(2, "0")}` : "";
};
const frPct = (n: number) => `${n.toFixed(2).replace(".", ",")} %`;
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());

/** Même règle que src/lib/platform.ts isMainPlatform : sans réseau principal défini, oui. */
export function isMain(creatorPlatform: string | null | undefined, key: AutoPlatform): boolean {
  const cp = (creatorPlatform ?? "").toLowerCase().trim();
  if (!cp) return true;
  if (key === "instagram") return cp.includes("insta");
  if (key === "tiktok") return cp.includes("tiktok") || cp.includes("tik tok");
  return cp.includes("youtube") || cp.includes("yt");
}

/**
 * Ajoute la mesure du mois si ce créateur n'en a pas encore sur ce réseau (automatique
 * ou à la main). Renvoie true si une mesure a été ajoutée. Ne lève jamais : un relevé
 * automatique raté ne doit pas faire échouer la synchro.
 */
export async function recordAutoMeasure(
  sb: SupabaseClient,
  c: { id: string; name: string; platform: string | null },
  m: { platform: AutoPlatform; er: number; followers: number | null; detail: string },
): Promise<boolean> {
  try {
    if (!Number.isFinite(m.er) || m.er <= 0) return false;
    const { data, error } = await sb.from("module_rows").select("a").eq("module", "__app_state__").order("created_at", { ascending: false }).limit(1);
    if (error) return false;
    let hist: Json[] = [];
    try {
      const all = JSON.parse((data?.[0] as { a?: string } | undefined)?.a ?? "{}");
      hist = Array.isArray(all?.engagementHistory) ? all.engagementHistory : [];
    } catch {
      return false; // blob illisible : on ne touche à rien
    }
    const month = parisMonth();
    const lc = c.name.trim().toLowerCase();
    const already = hist.some((h) =>
      (h.creatorId === c.id || String(h.creator ?? "").trim().toLowerCase() === lc) && h.platform === m.platform && monthOfFr(h.date) === month);
    if (already) return false;
    const [bon, excellent] = BAREME[m.platform];
    const entry: Json = {
      id: crypto.randomUUID(),
      date: parisDay(),
      creator: titleCase(c.name),
      creatorId: c.id,
      platform: m.platform,
      platformLabel: LABEL[m.platform],
      er: frPct(m.er),
      verdict: m.er >= excellent ? "Excellent" : m.er >= bon ? "Bon" : "Moyen",
      detail: m.detail,
      vals: {},
      followers: m.followers ? String(m.followers) : "",
      auto: true,
    };
    // Les plus anciennes au-delà du plafond partent (la nouvelle arrive en tête).
    const drop = hist.slice(MAX_HISTORY - 1).map((h) => String(h.id ?? "")).filter(Boolean);
    const { error: wErr } = await sb.rpc("app_state_list", { p_key: "engagementHistory", p_upsert: [entry], p_remove: drop, p_prepend: true });
    if (wErr) {
      console.error("autoStats engagementHistory", c.name, wErr.message);
      return false;
    }
    // Fiche : taux du réseau principal à jour (comme reconcileFiche côté app).
    if (isMain(c.platform, m.platform)) await sb.from("creators").update({ er: entry.er }).eq("id", c.id);
    return true;
  } catch (e) {
    console.error("autoStats", c.name, (e as Error).message);
    return false;
  }
}

/** Coche « stats du mois à jour » pour le mois de Paris en cours. */
export async function markStatsMonth(sb: SupabaseClient, creatorId: string): Promise<void> {
  const month = parisMonth();
  const { error } = await sb.from("creators").update({ stats_month: month }).eq("id", creatorId).or(`stats_month.is.null,stats_month.neq.${month}`);
  if (error) console.error("autoStats stats_month", creatorId, error.message);
}
