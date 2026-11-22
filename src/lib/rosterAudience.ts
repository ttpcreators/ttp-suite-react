import { useEffect, useMemo, useState } from "react";
import { useAppState, type AppState } from "./appState";
import { useIgColumn } from "./instagram";
import { supabase } from "./supabase";
import { useLiveKey } from "./useLive";

type EngEntry = { creator?: string; platform?: string; followers?: string | number; date?: string };
/** Chiffres du jour TikTok et YouTube (colonnes creators.tt / creators.yt). */
export type LiveOther = { tt?: { followers?: unknown } | null; yt?: { subscribers?: unknown } | null };

/** « 12,5 K », « 1.2M », « 3 400 », 950 → nombre. Même lecture que le connecteur
 *  (supabase/functions/_shared/audience.ts parseCount). */
export function parseCount(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const t = String(v ?? "").trim().replace(/\s/g, "").replace(",", ".").toUpperCase();
  const m = /^([0-9.]+)([KM]?)/.exec(t);
  if (!m) return 0;
  const n = parseFloat(m[1]) || 0;
  return m[2] === "K" ? n * 1e3 : m[2] === "M" ? n * 1e6 : n;
}

/**
 * Abonnés tous réseaux par créateur (clé = nom en minuscules) : dernière mesure de chaque
 * réseau (blob `engagementHistory`), le chiffre du jour d'Instagram (Meta, ig-sync) à la
 * place de la mesure Instagram, et TikTok / YouTube du jour quand il n'y a pas de mesure.
 * Même règle pour le Roster, les Stats et le connecteur (supabase/functions/_shared/audience.ts).
 */
export function cumulativeFollowers(
  history: readonly EngEntry[],
  igByName: Record<string, { followers?: number | null }>,
  otherByName: Record<string, LiveOther> = {},
): Record<string, number> {
  const ts = (d?: string) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(d ?? ""); return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : 0; };
  const byCreator = new Map<string, EngEntry[]>();
  for (const h of history) {
    const k = (h.creator ?? "").trim().toLowerCase();
    if (!k) continue;
    byCreator.set(k, [...(byCreator.get(k) ?? []), h]);
  }
  const out: Record<string, number> = {};
  for (const k of new Set([...byCreator.keys(), ...Object.keys(igByName), ...Object.keys(otherByName)])) {
    const ordered = [...(byCreator.get(k) ?? [])].sort((a, b) => ts(b.date) - ts(a.date));
    const latest = new Map<string, number>();
    for (const h of ordered) {
      const pf = (h.platform ?? "").toLowerCase();
      if (pf && !latest.has(pf)) latest.set(pf, parseCount(h.followers));
    }
    const live = igByName[k]?.followers;
    if (live && live > 0) latest.set("instagram", live);
    const tt = parseCount(otherByName[k]?.tt?.followers);
    if (tt > 0 && !(latest.get("tiktok")! > 0)) latest.set("tiktok", tt);
    const yt = parseCount(otherByName[k]?.yt?.subscribers);
    if (yt > 0 && !(latest.get("youtube")! > 0)) latest.set("youtube", yt);
    const sum = [...latest.values()].reduce((a, n) => a + (n > 0 ? n : 0), 0);
    if (sum > 0) out[k] = sum;
  }
  return out;
}

/** Abonnés tous réseaux du roster (voir cumulativeFollowers). */
export function useRosterAudience(): Record<string, number> {
  const [igByName] = useIgColumn<{ followers?: number | null }>("creators", "name");
  const { data: engHist } = useAppState<EngEntry[]>((s: AppState) => (s["engagementHistory"] as EngEntry[]) ?? []);
  const [other, setOther] = useState<Record<string, LiveOther>>({});
  const live = useLiveKey();
  useEffect(() => {
    let alive = true;
    void supabase
      .from("creators")
      .select("name, tt, yt")
      .then(({ data, error }) => {
        if (!alive || error) return;
        const m: Record<string, LiveOther> = {};
        for (const r of (data as ({ name: string } & LiveOther)[] | null) ?? []) {
          const k = (r.name ?? "").trim().toLowerCase();
          if (k && (r.tt || r.yt)) m[k] = { tt: r.tt, yt: r.yt };
        }
        setOther(m);
      });
    return () => {
      alive = false;
    };
  }, [live]);
  return useMemo(() => cumulativeFollowers(engHist ?? [], igByName, other), [engHist, igByName, other]);
}
