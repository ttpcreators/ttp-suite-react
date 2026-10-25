import { useEffect, useMemo, useSyncExternalStore } from "react";
import { supabase } from "./supabase";
import { useLiveKey } from "./useLive";
import { activityKey, countsByPage, dropReadLocally, unreadKeys, type ActivityEvent } from "./activityEvents";

/*
 * Repères « nouveau » (table `activity_events`, RLS : chacun ne lit que les siens).
 * Une seule mémoire pour toute l'app (menu, listes, fiches), relue au rythme de
 * useLive. Table absente (SQL 2026-10-23 pas encore lancé) : aucun repère, aucune erreur.
 */

let events: ActivityEvent[] = [];
/** Objets marqués lus sur cet appareil (clé → heure), voir dropReadLocally. */
const readAt = new Map<string, number>();
let disabled = false;
let loading: Promise<void> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};
const snapshot = () => events;

async function load(): Promise<void> {
  if (disabled) return;
  if (loading) return loading;
  loading = (async () => {
    const { data, error } = await supabase
      .from("activity_events")
      .select("id, updated_at, target, creator, object_type, object_id, object_title, what, actor, excerpt, count")
      .is("read_at", null)
      .order("updated_at", { ascending: false })
      .limit(300);
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "PGRST205" || code === "42P01" || code === "42501") disabled = true;
      return;
    }
    // Le filtre ne couvre que les lectures en vol : au-delà de 2 min, la base fait foi
    // (et une horloge d'appareil en avance ne cache pas durablement un vrai changement).
    for (const [k, at] of readAt) if (Date.now() - at > 120_000) readAt.delete(k);
    events = dropReadLocally((data as ActivityEvent[]) ?? [], readAt);
    emit();
  })().finally(() => {
    loading = null;
  });
  return loading;
}

/** Marque lu tout ce qui concerne un objet (à son ouverture). */
export async function markActivityRead(type: string, id: string): Promise<void> {
  if (disabled || !id) return;
  const key = activityKey(type, id);
  if (!events.some((e) => activityKey(e.object_type, e.object_id) === key)) return;
  readAt.set(key, Date.now());
  events = events.filter((e) => activityKey(e.object_type, e.object_id) !== key);
  emit();
  await supabase.from("activity_events").update({ read_at: new Date().toISOString() }).eq("object_type", type).eq("object_id", id).is("read_at", null);
}

/**
 * Repères destinés à `side` (« agency » ou « creator »). `enabled` faux : rien (ex.
 * l'agence qui regarde l'espace d'un créateur ne doit pas effacer ses repères à lui).
 */
export function useActivityEvents(side: "agency" | "creator", enabled = true) {
  const live = useLiveKey();
  const all = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (enabled) void load();
  }, [enabled, live]);
  return useMemo(() => {
    const mine = enabled ? all.filter((e) => e.target === side) : [];
    return { events: mine, keys: unreadKeys(mine), counts: countsByPage(mine, side) };
  }, [all, side, enabled]);
}
