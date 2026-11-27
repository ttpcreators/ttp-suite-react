import { useMemo } from "react";
import { getAppState, invalidateAppState, listAppStateKey, useAppState, type AppState } from "./appState";
import { fmtDay } from "./dates";
import { aVerifierCreators, blockedCreators, readExclusivites, type Exclusivite } from "../../supabase/functions/_shared/exclusivites.ts";

/*
 * Exclusivités des créateurs (blob agence, clé `exclusivites`) : lecture partagée par la
 * page Exclusivités, le choix d'un créateur (prospection, collab, brief, gifting) et
 * l'alerte des mails. Logique pure : supabase/functions/_shared/exclusivites.ts.
 */

export const EXCLU_KEY = "exclusivites";

/** Aujourd'hui à Paris, AAAA-MM-JJ. */
export const todayParis = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());

export function useExclusivites(): { list: Exclusivite[]; loading: boolean } {
  const { data, loading } = useAppState<Exclusivite[]>((s: AppState) => readExclusivites(s[EXCLU_KEY]));
  return { list: data ?? [], loading };
}

/**
 * Créateurs signalés pour cette marque, pour les listes de choix : nom en minuscules →
 * « Exclu Nike · 12 déc. » (bloqué : mis en dernier) ou « À vérifier : exclu Nike non
 * confirmée » (ligne à confirmer, ou exclusivité sans concurrents : signalé, laissé à sa place).
 */
export function useBlockedCreators(brand: string | null | undefined): Map<string, string> {
  const { list } = useExclusivites();
  return useMemo(() => {
    if (!brand?.trim()) return new Map<string, string>();
    const today = todayParis();
    return new Map([...blockedCreators(list, brand, today, [], (d) => fmtDay(d)), ...aVerifierCreators(list, brand, today)]);
  }, [list, brand]);
}

/** Ajoute ou remplace des entrées, retire des ids (relecture fraîche, seules ces entrées bougent). */
export async function saveExclusivites(upsert: Exclusivite[], remove: string[] = []): Promise<boolean> {
  return listAppStateKey(EXCLU_KEY, upsert, remove, true);
}

/** Liste fraîche (avant une vérification importante). */
export async function freshExclusivites(): Promise<Exclusivite[]> {
  invalidateAppState();
  return readExclusivites((await getAppState())[EXCLU_KEY]);
}
