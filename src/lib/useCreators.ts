import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useLive } from "./useLive";

export type CreatorLite = {
  id: string;
  name: string;
  handle: string | null;
  photo_url: string | null;
  status: string | null;
  commission: string | null;
  platform: string | null;
};

let _cache: CreatorLite[] | null = null;
let _last: CreatorLite[] | null = null; // dernière liste lue avec succès (repli si erreur)
let _promise: Promise<CreatorLite[]> | null = null;

/** null = lecture en échec (≠ liste vide). */
async function load(): Promise<CreatorLite[] | null> {
  const { data, error } = await supabase
    .from("creators")
    .select("id,name,handle,photo_url,status,commission,platform")
    .order("sort_order");
  if (error) return null;
  return (data as CreatorLite[]) ?? [];
}

export function getCreators(): Promise<CreatorLite[]> {
  if (_cache) return Promise.resolve(_cache);
  if (!_promise) {
    const p: Promise<CreatorLite[]> = load()
      .catch(() => null)
      .then((c) => {
        // Échec : rien en cache (le prochain appel réessaie) et on garde l'ancienne
        // liste plutôt que de vider les sélecteurs.
        if (c === null) {
          if (_promise === p) _promise = null;
          return _last ?? [];
        }
        _last = c;
        return (_cache = c);
      });
    _promise = p;
  }
  return _promise;
}

export function invalidateCreators() {
  _cache = null;
  _promise = null;
}

/** Liste des créateurs (pour les sélecteurs « pour qui ? » et le portail). */
export function useCreators() {
  const [creators, setCreators] = useState<CreatorLite[]>(_cache ?? []);
  useEffect(() => {
    let alive = true;
    getCreators().then((c) => alive && setCreators(c));
    return () => {
      alive = false;
    };
  }, []);
  // Se resynchronise (nouveau créateur, photo, etc.) sur chaque tick global.
  useLive(() => {
    invalidateCreators();
    getCreators().then(setCreators);
  });
  return creators;
}
