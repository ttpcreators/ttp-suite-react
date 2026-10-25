import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/**
 * Le compte connecté est-il fondateur ? Les montants (CA, factures, commissions) ne
 * s'affichent qu'aux fondateurs, comme les pages de `FOUNDER_ONLY` (src/App.tsx).
 * Lu une fois par compte (`profiles.agency_role`), puis gardé en mémoire.
 */

let cache: { uid: string; founder: boolean } | null = null;
let pending: Promise<boolean> | null = null;

export function readIsFounder(): Promise<boolean> {
  if (pending) return pending;
  const p = (async () => {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id ?? "";
    if (!uid) return false;
    if (cache?.uid === uid) return cache.founder;
    const { data: row, error } = await supabase.from("profiles").select("agency_role").eq("user_id", uid).maybeSingle<{ agency_role: string | null }>();
    if (error) return false; // dans le doute, rien d'argent (nouvel essai au prochain appel)
    cache = { uid, founder: row?.agency_role === "founder" };
    return cache.founder;
  })()
    .catch(() => false)
    .finally(() => {
      if (pending === p) pending = null;
    });
  pending = p;
  return p;
}

/** true = fondateur ; false = membre (ou lecture impossible) ; null = pas encore lu. */
export function useIsFounder(): boolean | null {
  const [founder, setFounder] = useState<boolean | null>(cache ? cache.founder : null);
  useEffect(() => {
    let alive = true;
    void readIsFounder().then((v) => {
      if (alive) setFounder(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return founder;
}
