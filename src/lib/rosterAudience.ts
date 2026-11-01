import { useMemo } from "react";
import { useAppState, type AppState } from "./appState";
import { useIgColumn } from "./instagram";

type EngEntry = { creator?: string; platform?: string; followers?: string; date?: string };

/**
 * Abonnés tous réseaux par créateur (clé = nom en minuscules) : dernière mesure de chaque
 * réseau (blob `engagementHistory`), le chiffre du jour d'Instagram (Meta, ig-sync) à la
 * place de la mesure Instagram. Même règle pour le Roster, les Stats et le connecteur
 * (supabase/functions/_shared/audience.ts).
 */
export function cumulativeFollowers(history: readonly EngEntry[], igByName: Record<string, { followers?: number | null }>): Record<string, number> {
  const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
  const ts = (d?: string) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(d ?? ""); return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : 0; };
  const byCreator = new Map<string, EngEntry[]>();
  for (const h of history) {
    const k = (h.creator ?? "").trim().toLowerCase();
    if (!k) continue;
    byCreator.set(k, [...(byCreator.get(k) ?? []), h]);
  }
  const out: Record<string, number> = {};
  for (const k of new Set([...byCreator.keys(), ...Object.keys(igByName)])) {
    const ordered = [...(byCreator.get(k) ?? [])].sort((a, b) => ts(b.date) - ts(a.date));
    const latest = new Map<string, number>();
    for (const h of ordered) {
      const pf = (h.platform ?? "").toLowerCase();
      if (pf && !latest.has(pf)) latest.set(pf, num(h.followers));
    }
    const live = igByName[k]?.followers;
    if (live && live > 0) latest.set("instagram", live);
    const sum = [...latest.values()].reduce((a, n) => a + n, 0);
    if (sum > 0) out[k] = sum;
  }
  return out;
}

/** Abonnés tous réseaux du roster (voir cumulativeFollowers). */
export function useRosterAudience(): Record<string, number> {
  const [igByName] = useIgColumn<{ followers?: number | null }>("creators", "name");
  const { data: engHist } = useAppState<EngEntry[]>((s: AppState) => (s["engagementHistory"] as EngEntry[]) ?? []);
  return useMemo(() => cumulativeFollowers(engHist ?? [], igByName), [engHist, igByName]);
}
