/**
 * googleCalendar.ts — Client front (React 19 / Vite / GitHub Pages) pour la
 * synchronisation bidirectionnelle `events` <-> Google Calendar (Option C).
 *
 * SÉCURITÉ :
 *  - Le front ne connaît QUE la clé anon Supabase (publique). AUCUN secret
 *    (GOOGLE_CLIENT_SECRET, service role, refresh_token, STATE_SIGNING_SECRET)
 *    ne transite ni n'est stocké côté navigateur.
 *  - L'URL de consentement (avec `state` signé HMAC anti-CSRF) est TOUJOURS
 *    produite côté serveur par l'Edge Function `google-connect-url`. Il n'y a
 *    PAS de fallback client non signé : si la fonction échoue, on abandonne
 *    avec une erreur (on ne contourne jamais la signature du state).
 *  - Tous les appels passent par `supabase.functions.invoke` (en POST), qui
 *    ajoute automatiquement `Authorization: Bearer <JWT session agence>`.
 */

import { supabase } from "@/lib/supabase";

/* ------------------------------------------------------------------ *
 * Types                                                               *
 * ------------------------------------------------------------------ */

export interface GoogleStatus {
  connected: boolean;
  email: string | null;
  lastSyncAt: string | null;
  channelExpiration: string | null;
  lastError: string | null;
}

export interface SyncResult {
  ok: boolean;
  pulled: number;
  pushed: number;
  deleted: number;
  resynced?: boolean;
  skipped?: string;
}

/* ------------------------------------------------------------------ *
 * Utilitaires                                                         *
 * ------------------------------------------------------------------ */

/**
 * Origine de retour de l'app = origine du navigateur + BASE_URL Vite.
 * Sur GitHub Pages l'app vit sous un sous-chemin (ex. /ttp-suite-react/) : on
 * conserve import.meta.env.BASE_URL pour que le callback redirige au bon endroit.
 */
export function appOrigin(): string {
  // URL de la page courante (origine + chemin), sans query ni hash. Robuste quel
  // que soit le `base` Vite (relatif "./" sur GitHub Pages) — l'ancienne version
  // fabriquait une origine malformée ("…github.io.") rejetée par le serveur.
  return window.location.origin + window.location.pathname;
}

/* ------------------------------------------------------------------ *
 * Actions                                                             *
 * ------------------------------------------------------------------ */

/**
 * Récupère l'URL de consentement Google (state signé HMAC côté serveur) auprès
 * de l'Edge Function `google-connect-url`. Transport POST { origin } — les GET
 * ne portent pas de body de façon fiable via functions.invoke.
 *
 * Lève une erreur si la fonction échoue (PAS de fallback client non signé).
 */
export async function getConnectUrl(): Promise<string> {
  const origin = appOrigin();
  const { data, error } = await supabase.functions.invoke<{ url?: string }>(
    "google-connect-url",
    { method: "POST", body: { origin } },
  );
  if (error) throw error;
  if (!data?.url) throw new Error("google-connect-url: réponse invalide");
  return data.url;
}

/** Démarre le flux OAuth : redirige le navigateur (ne revient pas en cas de succès). */
export async function connect(): Promise<void> {
  const url = await getConnectUrl();
  window.location.assign(url);
}

/**
 * Lit le statut de connexion via `google-status` (JWT agence auto).
 * Renvoie un statut « déconnecté » sûr en cas d'erreur (function absente, réseau…).
 */
export async function getStatus(): Promise<GoogleStatus> {
  const fallback: GoogleStatus = {
    connected: false, email: null, lastSyncAt: null,
    channelExpiration: null, lastError: null,
  };
  try {
    const { data, error } = await supabase.functions.invoke<GoogleStatus>(
      "google-status",
      { method: "POST", body: {} },
    );
    if (error) throw error;
    return { ...fallback, ...(data ?? {}) };
  } catch {
    return fallback;
  }
}

/** Déclenche un cycle de synchronisation manuel (`google-sync`, trigger=manual). */
export async function triggerSync(): Promise<SyncResult> {
  const { data, error } = await supabase.functions.invoke<SyncResult>(
    "google-sync",
    { method: "POST", body: { trigger: "manual" } },
  );
  if (error) throw error;
  if (!data?.ok) throw new Error("Synchronisation refusée par le serveur");
  return data;
}

/** Déconnecte le compte Google (`google-disconnect`). */
export async function disconnect(): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{ ok: boolean }>(
    "google-disconnect",
    { method: "POST", body: {} },
  );
  if (error) throw error;
  if (!data?.ok) throw new Error("Déconnexion refusée par le serveur");
}

/**
 * Au montage de l'app : détecte le retour OAuth (?google=connected|error),
 * nettoie l'URL, et renvoie l'issue. La vraie protection anti-CSRF est portée
 * par le `state` signé côté serveur (pas de nonce client à revérifier).
 */
export function consumeOAuthReturn(): { justConnected: boolean; error: boolean } {
  const url = new URL(window.location.href);
  const flag = url.searchParams.get("google");
  const justConnected = flag === "connected";
  const error = flag === "error";
  if (flag) {
    url.searchParams.delete("google");
    window.history.replaceState({}, "", url.toString());
  }
  return { justConnected, error };
}
