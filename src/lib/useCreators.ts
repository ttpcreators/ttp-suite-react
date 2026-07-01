import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type CreatorLite = {
  id: string;
  name: string;
  handle: string | null;
  photo_url: string | null;
  status: string | null;
};

let _cache: CreatorLite[] | null = null;
let _promise: Promise<CreatorLite[]> | null = null;

async function load(): Promise<CreatorLite[]> {
  const { data, error } = await supabase
    .from("creators")
    .select("id,name,handle,photo_url,status")
    .order("sort_order");
  if (error) return [];
  return (data as CreatorLite[]) ?? [];
}

export function getCreators(): Promise<CreatorLite[]> {
  if (_cache) return Promise.resolve(_cache);
  if (!_promise) _promise = load().then((c) => (_cache = c));
  return _promise;
}

export function invalidateCreators() {
  _cache = null;
  _promise = null;
}

/** Liste des créateurs (pour les sélecteurs « pour qui ? » et le portail). */
export function useCreators() {
  const [creators, setCreators] = useState<CreatorLite[]>([]);
  useEffect(() => {
    let alive = true;
    getCreators().then((c) => alive && setCreators(c));
    return () => {
      alive = false;
    };
  }, []);
  return creators;
}
