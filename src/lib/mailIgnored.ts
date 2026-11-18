import { useEffect, useState } from "react";
import { getAppState, invalidateAppState, mergeAppStateKey, useAppState } from "./appState";
import { toast } from "@/components/ui/toast";
import {
  IGNORED_SENDERS_KEY,
  addIgnoredSender,
  applyIgnoredChange,
  readIgnoredSenders,
  senderAddress,
  type IgnoredSenders,
} from "../../supabase/functions/_shared/mailIgnore.ts";

/*
 * Expéditeurs « Pas à traiter » (page Mails) : liste partagée par l'agence, clé
 * `mailIgnoredSenders` du blob (règle pure : supabase/functions/_shared/mailIgnore.ts,
 * aussi appliquée par gmail-poll pour les tâches To-do).
 *
 * Affichage tout de suite (état du module, partagé par la page et les réglages), puis
 * écriture partielle sous verrou (app_state_merge : une adresse ajoutée ou retirée, jamais
 * toute la liste). Écritures en file : un ajout puis « Annuler » arrivent dans l'ordre.
 */

let current: IgnoredSenders | null = null;
let writing = 0;
let queue: Promise<void> = Promise.resolve();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function write(set: IgnoredSenders, remove: string[]) {
  writing++;
  queue = queue.then(async () => {
    let ok = false;
    try {
      ok = await mergeAppStateKey(IGNORED_SENDERS_KEY, set, remove);
    } catch {
      /* réseau : signalé ci-dessous */
    }
    writing--;
    if (ok) return;
    toast("Réglage « Pas à traiter » non enregistré, réessaie");
    // Retour à ce qui est vraiment en base.
    try {
      invalidateAppState();
      current = readIgnoredSenders((await getAppState())[IGNORED_SENDERS_KEY]);
      emit();
    } catch {
      /* relecture impossible : l'état local reste affiché */
    }
  });
}

/** Expéditeurs retenus (adresse en minuscules → date d'ajout), à jour sur tous les postes. */
export function useIgnoredSenders(): IgnoredSenders {
  const { data } = useAppState((s) => readIgnoredSenders(s[IGNORED_SENDERS_KEY]));
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  // Relecture du blob (tick live) : prise en compte, sauf pendant une écriture.
  useEffect(() => {
    if (!data || writing) return;
    current = data;
    emit();
  }, [data]);
  return current ?? data ?? {};
}

/** Retient l'expéditeur. Renvoie son adresse (pour « Annuler »), ou null si rien n'a changé. */
export function ignoreSender(from: string): string | null {
  const cur = current ?? {};
  const change = addIgnoredSender(cur, from, Date.now());
  if (!change) return null;
  current = applyIgnoredChange(cur, change.set, change.remove);
  emit();
  write(change.set, change.remove);
  return change.email;
}

/** Oublie l'expéditeur : ses mails reviennent dans « À traiter ». */
export function unignoreSender(from: string) {
  const email = senderAddress(from);
  if (!email) return;
  if (current) {
    const next = { ...current };
    delete next[email];
    current = next;
    emit();
  }
  write({}, [email]);
}
