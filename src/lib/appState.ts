import { useEffect, useState } from "react";
import { useLive } from "./useLive";
import { supabase } from "./supabase";

/**
 * Toute la donnée "modules" de l'app (factures, to-do, briefs, prospects,
 * events, objectifs, pricing, media kit, accès…) est persistée dans UN seul
 * blob JSON : table `module_rows`, ligne `module = '__app_state__'`, colonne `a`.
 * Ce module charge ce blob une seule fois (cache) et l'expose aux vues.
 */
export type AppState = Record<string, unknown>;

let _cache: AppState | null = null;
let _promise: Promise<AppState> | null = null;

async function loadAppState(): Promise<AppState> {
  const { data, error } = await supabase
    .from("module_rows")
    .select("id,a")
    .eq("module", "__app_state__")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = data && data[0];
  if (!row) return {};
  try {
    const o = JSON.parse((row as { a: string }).a);
    return o && typeof o === "object" ? (o as AppState) : {};
  } catch {
    return {};
  }
}

// Compteur d'écritures : une écriture optimiste en cours "gagne" contre un
// refetch concurrent (évite qu'un tick live annule visuellement une modif).
let _writeGen = 0;

/** Charge le blob (mémoïsé). Toutes les vues partagent la même requête. */
export function getAppState(): Promise<AppState> {
  if (_cache) return Promise.resolve(_cache);
  if (!_promise) {
    _promise = loadAppState().then((s) => {
      _cache = s;
      return s;
    });
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
  _cache = null;
  _refreshing = loadAppState()
    .then((s) => {
      _cache = s;
      return s;
    })
    .finally(() => {
      _refreshing = null;
    });
  _promise = _refreshing;
  return _refreshing;
}

/**
 * Écrit une clé dans le blob __app_state__ (read-modify-write de tout le blob,
 * comme l'ancienne app). Réservé à l'AGENCE (RLS). Renvoie true si OK.
 */
export async function saveAppStateKey(key: string, value: unknown): Promise<boolean> {
  _writeGen++; // marque une écriture en cours (prioritaire sur les refetch)
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
  _cache = obj as AppState;
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

/** Helper : parse un montant texte ("3 000 €", "1 200,50 €") en nombre.
 *  Gère le séparateur décimal FR (virgule) sans l'écraser — sinon "3 000,00 €"
 *  était lu 300000 (×100). Compatible avec les montants entiers ("2000 €" → 2000). */
export function parseAmount(x: unknown): number {
  const cleaned = String(x ?? "")
    .replace(/\s/g, "")
    .replace(",", ".")
    .replace(/[^0-9.\-]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Helper : formate un nombre en "3 000 €". */
export function formatEuro(n: number): string {
  return n.toLocaleString("fr-FR").replace(/ /g, " ") + " €";
}
