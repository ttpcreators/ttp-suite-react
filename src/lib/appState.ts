import { useEffect, useState } from "react";
import { useLive } from "./useLive";
import { supabase } from "./supabase";

/**
 * Toute la donnée "modules" de l'app (factures, to-do, briefs, prospects,
 * events, objectifs, pricing, media kit, accès…) est persistée dans UN seul
 * blob JSON : table `module_rows`, ligne `module = '__app_state__'`, colonne `a`.
 * Ce module charge ce blob une seule fois (cache) et l'expose aux vues.
 *
 * L'ARGENT (lignes des factures, comptes bancaires, émetteur, versements, commissions)
 * vit dans une 2e ligne, `module = '__finance_state__'`, lisible des seuls fondateurs
 * (SQL 2026-10-25-finance-fondateurs.sql). Elle est lue en même temps et ses clés
 * recouvrent celles de la ligne commune ; les fonctions app_state_* y rangent d'office
 * ces clés à l'écriture. Avant le SQL (ou pour un membre), elle n'existe pas : rien change.
 */
export type AppState = Record<string, unknown>;

let _cache: AppState | null = null;
let _promise: Promise<AppState> | null = null;

const readRow = (module: string) =>
  supabase.from("module_rows").select("id,a").eq("module", module).order("created_at", { ascending: false }).limit(1);

function parseRow(data: unknown[] | null): AppState {
  const row = data && (data[0] as { a?: string } | undefined);
  if (!row?.a) return {};
  try {
    const o = JSON.parse(row.a);
    return o && typeof o === "object" ? (o as AppState) : {};
  } catch {
    return {};
  }
}

async function loadAppState(): Promise<AppState> {
  const [app, fin] = await Promise.all([readRow("__app_state__"), readRow("__finance_state__")]);
  // Lecture ratée ≠ ligne absente (y compris la ligne finance : une clé argent lue vide
  // serait réécrite à partir de rien).
  if (app.error) throw app.error;
  if (fin.error) throw fin.error;
  return { ...parseRow(app.data), ...parseRow(fin.data) };
}

// Compteur d'écritures : une écriture optimiste en cours "gagne" contre un
// refetch concurrent (évite qu'un tick live annule visuellement une modif).
let _writeGen = 0;

/** Charge le blob (mémoïsé). Toutes les vues partagent la même requête. */
export function getAppState(): Promise<AppState> {
  if (_cache) return Promise.resolve(_cache);
  if (!_promise) {
    const gen = _writeGen;
    const p: Promise<AppState> = loadAppState().then((s) => {
      // Une écriture a eu lieu pendant le chargement : snapshot possiblement
      // antérieur → on ne le met pas en cache (prochain get = relecture).
      if (_writeGen === gen) _cache = s;
      else if (_promise === p) _promise = null;
      return s;
    });
    _promise = p;
  }
  return _promise;
}

/** Force un rechargement (après une mutation). */
export function invalidateAppState() {
  _cache = null;
  _promise = null;
}

// Rafraîchissement partagé pour le tick "live". Sans ça, chaque vue montée
// appelle invalidate()+getAppState() → invalidate remet _promise à null, donc
// la déduplication saute et on déclenche N fetch réseau par tick. Ici, tous
// les abonnés d'un même tick partagent UNE seule requête.
let _refreshing: Promise<AppState> | null = null;
export function refreshAppState(): Promise<AppState> {
  if (_refreshing) return _refreshing;
  // On garde l'ancien cache pendant le fetch (le vider laissait une écriture
  // concurrente créer un cache partiel, puis écrasé par un snapshot pré-écriture).
  const gen = _writeGen;
  const p: Promise<AppState> = loadAppState()
    .then((s) => {
      if (_writeGen === gen) _cache = s;
      else if (_promise === p) _promise = null; // snapshot périmé : pas de cache
      return s;
    })
    .finally(() => {
      _refreshing = null;
    });
  _refreshing = p;
  if (!_cache) _promise = p;
  return p;
}

/**
 * Écrit une clé dans le blob __app_state__. Réservé à l'AGENCE (RLS).
 *
 * Chemin ATOMIQUE (par défaut) : la fonction Postgres `app_state_set` fait un
 * jsonb_set d'UNE seule clé, sous verrou de ligne → deux sauvegardes simultanées
 * de clés différentes (Marc + Gianni) ne s'écrasent plus JAMAIS.
 *
 * Filet : si la fonction SQL n'est pas encore posée (migration 07), on retombe
 * automatiquement sur l'ancien read-modify-write → aucune régression.
 * Renvoie true si OK.
 */
export async function saveAppStateKey(key: string, value: unknown): Promise<boolean> {
  _writeGen++; // marque une écriture en cours (prioritaire sur les refetch)
  const { error } = await supabase.rpc("app_state_set", { p_key: key, p_value: value });
  // Re-marque à la fin : un refetch lancé PENDANT l'appel RPC est aussi ignoré.
  _writeGen++;
  if (!error) {
    // Cache local à jour sans refetch. Jamais de cache partiel {[key]: value} :
    // si le cache est vide, le prochain get relira le blob complet.
    if (_cache) _cache = { ..._cache, [key]: value } as AppState;
    return true;
  }
  // Fallback legacy (réécriture de tout le blob) UNIQUEMENT si la fonction SQL
  // n'existe pas. Sur toute autre erreur (réseau, RLS…) → échec franc.
  if (!isMissingFunction(error)) {
    console.warn("[blob] app_state_set", key, error.message);
    return false;
  }
  console.warn("[blob] app_state_set absente → fallback legacy", key, error.message);
  const ok = await legacySaveAppStateKey(key, value);
  _writeGen++;
  return ok;
}

/**
 * Écriture PARTIELLE d'une clé-objet { id: valeur } (factures, versements, notes…) :
 * seules les entrées `set` sont posées et `remove` retirées, côté base et sous verrou
 * (fonction app_state_merge). Deux postes qui enregistrent en même temps ne
 * s'effacent plus : chacun ne touche que SES entrées.
 * Filet : fonction SQL absente → relecture fraîche + réécriture de la clé (ancien chemin).
 */
export async function mergeAppStateKey(key: string, set: Record<string, unknown>, remove: string[] = []): Promise<boolean> {
  _writeGen++;
  const { error } = await supabase.rpc("app_state_merge", { p_key: key, p_set: set, p_remove: remove });
  _writeGen++;
  if (!error) {
    if (_cache) {
      const cur = { ...((_cache[key] as Record<string, unknown> | undefined) ?? {}) };
      for (const k of remove) delete cur[k];
      _cache = { ..._cache, [key]: { ...cur, ...set } } as AppState;
    }
    return true;
  }
  if (!isMissingFunction(error)) {
    console.warn("[blob] app_state_merge", key, error.message);
    return false;
  }
  invalidateAppState();
  const fresh = { ...(((await getAppState())[key] as Record<string, unknown> | undefined) ?? {}) };
  for (const k of remove) delete fresh[k];
  return saveAppStateKey(key, { ...fresh, ...set });
}

/**
 * Écriture PARTIELLE d'une clé-liste d'objets ayant un `id` (historiques) : `upsert`
 * remplace sur place ou ajoute (en tête si `prepend`), `remove` retire par id.
 * Même garantie que mergeAppStateKey (fonction app_state_list).
 */
export async function listAppStateKey(key: string, upsert: { id: string }[], remove: string[] = [], prepend = false): Promise<boolean> {
  _writeGen++;
  const { error } = await supabase.rpc("app_state_list", { p_key: key, p_upsert: upsert, p_remove: remove, p_prepend: prepend });
  _writeGen++;
  const apply = (cur: { id: string }[]) => {
    const ups = new Map(upsert.map((u) => [u.id, u]));
    const kept = cur.filter((x) => !remove.includes(x.id)).map((x) => ups.get(x.id) ?? x);
    const added = upsert.filter((u) => !cur.some((x) => x.id === u.id));
    return prepend ? [...added, ...kept] : [...kept, ...added];
  };
  if (!error) {
    if (_cache) {
      const cur = Array.isArray(_cache[key]) ? (_cache[key] as { id: string }[]) : [];
      _cache = { ..._cache, [key]: apply(cur) } as AppState;
    }
    return true;
  }
  if (!isMissingFunction(error)) {
    console.warn("[blob] app_state_list", key, error.message);
    return false;
  }
  invalidateAppState();
  const fresh = (await getAppState())[key];
  return saveAppStateKey(key, apply(Array.isArray(fresh) ? (fresh as { id: string }[]) : []));
}

/** Fonction Postgres absente : 42883 (Postgres) ou PGRST202 (cache PostgREST). */
export function isMissingFunction(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42883" || err.code === "PGRST202") return true;
  const m = err.message ?? "";
  return /function .* does not exist/i.test(m) || /could not find the function/i.test(m);
}

/** Ancienne écriture read-modify-write de tout le blob. Fallback si la fonction
 *  SQL atomique n'existe pas encore. */
async function legacySaveAppStateKey(key: string, value: unknown): Promise<boolean> {
  const { data, error: selErr } = await supabase
    .from("module_rows")
    .select("id,a")
    .eq("module", "__app_state__")
    .order("created_at", { ascending: false })
    .limit(1);
  // CRITIQUE : ne jamais confondre « lecture échouée » avec « ligne absente ».
  // Sinon on insère une 2e ligne __app_state__ quasi vide qui masque tout le blob.
  if (selErr) {
    console.warn("[blob] read-before-save", key, selErr.message);
    return false;
  }
  const row = data && (data[0] as { id: string; a: string } | undefined);
  let obj: Record<string, unknown> = {};
  if (row) {
    try {
      const parsed = JSON.parse(row.a);
      if (parsed && typeof parsed === "object") obj = parsed as Record<string, unknown>;
    } catch {
      /* blob illisible → on repart d'un objet vide */
    }
  }
  obj[key] = value;
  const json = JSON.stringify(obj);
  const res = row
    ? await supabase.from("module_rows").update({ a: json }).eq("id", row.id)
    : await supabase.from("module_rows").insert({ module: "__app_state__", a: json });
  if (res.error) {
    console.warn("[blob] save", key, res.error.message);
    return false;
  }
  // Pas de cache tiré de la seule ligne commune (la ligne finance en serait absente).
  invalidateAppState();
  return true;
}

/**
 * Hook : sélectionne une tranche du blob d'état.
 * `select` est appelé une fois, au chargement.
 */
export function useAppState<T = AppState>(select?: (s: AppState) => T) {
  // Init synchrone depuis le cache → pas de flash "Chargement…" au retour sur une vue.
  const [data, setData] = useState<T | null>(() =>
    _cache ? (select ? select(_cache) : (_cache as unknown as T)) : null,
  );
  const [loading, setLoading] = useState(!_cache);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    getAppState()
      .then((s) => {
        if (!alive) return;
        setData(select ? select(s) : (s as unknown as T));
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setError(true);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-synchronise les réglages partagés (objectifs, pricing, checklist…) à
  // chaque tick global : ce qu'un poste modifie apparaît sur les autres.
  useLive(() => {
    const gen = _writeGen;
    // Refresh partagé : une seule requête par tick pour toutes les vues montées.
    refreshAppState()
      .then((s) => {
        // Ignore ce refetch si une écriture optimiste a démarré entre-temps
        // (sinon on annulerait visuellement la modif en cours).
        if (_writeGen === gen) setData(select ? select(s) : (s as unknown as T));
      })
      .catch(() => {});
  });

  return { data, loading, error };
}

// parseAmount / formatEuro vivent dans ./money (purs, sans supabase -> testables
// sans charger le client). Reexportes ici pour ne pas casser les imports existants.
export { parseAmount, formatEuro } from "./money";
