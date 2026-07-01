import { useEffect, useState } from "react";
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

/**
 * Écrit une clé dans le blob __app_state__ (read-modify-write de tout le blob,
 * comme l'ancienne app). Réservé à l'AGENCE (RLS). Renvoie true si OK.
 */
export async function saveAppStateKey(key: string, value: unknown): Promise<boolean> {
  const { data } = await supabase
    .from("module_rows")
    .select("id,a")
    .eq("module", "__app_state__")
    .order("created_at", { ascending: false })
    .limit(1);
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
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
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

  return { data, loading, error };
}

/** Helper : parse un montant texte ("3 000 €") en nombre. */
export function parseAmount(x: unknown): number {
  return Number(String(x ?? "").replace(/[^0-9]/g, "")) || 0;
}

/** Helper : formate un nombre en "3 000 €". */
export function formatEuro(n: number): string {
  return n.toLocaleString("fr-FR").replace(/ /g, " ") + " €";
}
