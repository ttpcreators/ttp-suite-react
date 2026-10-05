import { supabase } from "./supabase";

/*
 * Dernière visite de chaque page du menu, par compte : sert aux pastilles « pas
 * encore vu » (useNavBadges). Gardée sur l'appareil (localStorage) ET dans la
 * table nav_seen pour que l'ordinateur et le téléphone restent d'accord. Tant que
 * le SQL nav_seen n'est pas lancé, chaque appareil garde sa propre mémoire.
 */
const FIRST_LOOKBACK = 3 * 86400000; // 1re ouverture : on montre les 3 derniers jours
const MAX_LOOKBACK = 14 * 86400000; // au-delà de 14 jours, plus rien n'est « nouveau »

let uid = "";
let seen: Record<string, number> = {};
let base = 0;
let remote = true; // table nav_seen disponible (sinon : appareil seulement)
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const lsKey = (u: string) => `ttp:nav-seen:${u}`;
// Table absente (SQL pas encore lancé) : on n'insiste pas pour cette session.
const missingTable = (e: { code?: string } | null) => !!e && (e.code === "PGRST205" || e.code === "42P01");

function saveLocal() {
  try {
    localStorage.setItem(lsKey(uid), JSON.stringify({ base, seen }));
  } catch {
    /* stockage indisponible : mémoire de la session seulement */
  }
}

/** Relit la table (visites faites sur un autre appareil) et garde la plus récente. */
export async function syncNavSeen() {
  if (!uid || !remote) return;
  const { data, error } = await supabase.from("nav_seen").select("page, seen_at");
  if (error) {
    if (missingTable(error)) remote = false;
    return;
  }
  let changed = false;
  for (const r of (data ?? []) as { page: string; seen_at: string }[]) {
    const t = Date.parse(r.seen_at);
    if (Number.isFinite(t) && t > (seen[r.page] ?? 0)) {
      seen[r.page] = t;
      changed = true;
    }
  }
  if (changed) {
    saveLocal();
    emit();
  }
}

/** Charge la mémoire du compte connecté (une fois par compte). */
export function initNavSeen(u: string) {
  if (!u || u === uid) return;
  uid = u;
  let stored: { base?: unknown; seen?: unknown } = {};
  try {
    stored = JSON.parse(localStorage.getItem(lsKey(u)) || "{}") as typeof stored;
  } catch {
    stored = {};
  }
  base = typeof stored.base === "number" ? stored.base : Date.now() - FIRST_LOOKBACK;
  seen = stored.seen && typeof stored.seen === "object" ? { ...(stored.seen as Record<string, number>) } : {};
  saveLocal();
  emit();
  void syncNavSeen();
}

/** Ces pages viennent d'être vues (ouverture, sortie, appli mise en arrière-plan). */
export function markNavSeen(pages: string[]) {
  const list = [...new Set(pages.filter(Boolean))];
  if (!uid || !list.length) return;
  const now = Date.now();
  for (const p of list) seen[p] = now;
  saveLocal();
  emit();
  if (!remote) return;
  const at = new Date(now).toISOString();
  void supabase
    .from("nav_seen")
    .upsert(list.map((page) => ({ user_id: uid, page, seen_at: at })), { onConflict: "user_id,page" })
    .then(({ error }) => {
      if (missingTable(error)) remote = false;
    });
}

/** Depuis quand une page compte ses nouveautés (dernière visite, 14 jours au plus). */
export function seenAt(page: string): number {
  return Math.max(seen[page] ?? base, Date.now() - MAX_LOOKBACK);
}

/** Point de départ commun des requêtes (la plus ancienne des visites utiles). */
export function oldestSeen(): number {
  return Math.max(Math.min(base, ...Object.values(seen)), Date.now() - MAX_LOOKBACK);
}

export function subscribeNavSeen(f: () => void): () => void {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}
