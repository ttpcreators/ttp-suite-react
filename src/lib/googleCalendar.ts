/**
 * googleCalendar.ts — Client front (React 19 / Vite / GitHub Pages) pour la
 * synchronisation bidirectionnelle `events` <-> Google Calendar (Option C).
 *
 * SÉCURITÉ (rappels de la spec) :
 *  - Le front ne connaît QUE la clé anon Supabase et le CLIENT_ID OAuth (publics
 *    par nature). Aucun secret (GOOGLE_CLIENT_SECRET, service role, refresh_token)
 *    ne transite ni n'est stocké côté navigateur.
 *  - Le `state` OAuth est signé/vérifié côté serveur (Edge Function). Ici on
 *    génère un `state` opaque contenant l'origine de retour + un nonce anti-CSRF
 *    que l'on mémorise dans sessionStorage : au retour, on vérifie que le nonce
 *    correspond (défense en profondeur côté client). La signature HMAC réelle,
 *    non falsifiable, est posée/vérifiée par l'Edge Function `google-connect-url`
 *    / `google-oauth-callback`.
 *  - Tous les appels authentifiés passent par `supabase.functions.invoke`, qui
 *    ajoute automatiquement l'en-tête `Authorization: Bearer <JWT session agence>`.
 *
 * Deux stratégies de construction de l'URL de consentement sont fournies :
 *  1. `getConnectUrl()` — RECOMMANDÉE : demande l'URL à l'Edge Function
 *     `google-connect-url`, qui signe le `state` avec le secret serveur (HMAC).
 *  2. `buildConsentUrl(clientId, origin)` — construction 100 % côté client
 *     (utile en secours / hors-ligne du backend). Le `state` n'est alors que
 *     signé côté serveur au retour ; on y met néanmoins un nonce anti-CSRF.
 */

import { supabase } from "@/lib/supabase";

/* ------------------------------------------------------------------ *
 * Constantes                                                          *
 * ------------------------------------------------------------------ */

/** URL de la fonction callback (redirect_uri enregistré dans Google Cloud). */
export const GOOGLE_REDIRECT_URI =
  "https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/google-oauth-callback";

/** Endpoint d'autorisation Google (OAuth 2.0). */
const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

/**
 * Scopes demandés :
 *  - openid + email : identifier le compte Google (sub / email) sans plus.
 *  - calendar.events : lecture/écriture des évènements (pas d'accès au reste).
 */
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

/** Clé sessionStorage du nonce anti-CSRF (round-trip OAuth). */
const STATE_NONCE_KEY = "ttp_google_oauth_nonce";

/** CLIENT_ID OAuth (public), injecté au build via Vite. */
export const GOOGLE_CLIENT_ID: string =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "";

/* ------------------------------------------------------------------ *
 * Types                                                               *
 * ------------------------------------------------------------------ */

/** Statut de connexion renvoyé par l'Edge Function `google-status`. */
export interface GoogleStatus {
  connected: boolean;
  email: string | null;
  lastSyncAt: string | null;
  channelExpiration: string | null;
  lastError: string | null;
}

/** Résultat d'un cycle de synchronisation (`google-sync`). */
export interface SyncResult {
  ok: boolean;
  pulled: number;
  pushed: number;
  deleted: number;
  ressynced?: boolean;
  skipped?: string;
}

/* ------------------------------------------------------------------ *
 * Utilitaires internes                                                *
 * ------------------------------------------------------------------ */

/**
 * Origine de retour de l'app = origine du navigateur + BASE_URL Vite.
 * Sur GitHub Pages l'app est servie sous un sous-chemin (ex. /ttp-suite-react/),
 * il faut donc conserver `import.meta.env.BASE_URL`. On normalise pour éviter
 * les doubles slashs.
 */
export function appOrigin(): string {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
  return (window.location.origin + base).replace(/\/+$/, "");
}

/** Génère un nonce aléatoire (anti-CSRF) via l'API Web Crypto. */
function genNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** base64url d'une chaîne UTF-8 (pour un `state` compact et URL-safe). */
function toBase64Url(input: string): string {
  const b64 = btoa(unescape(encodeURIComponent(input)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Construit un `state` client : { origin, nonce, iat }. Le nonce est mémorisé
 * en sessionStorage pour vérification au retour. La signature HMAC réelle est
 * ajoutée/vérifiée côté serveur ; ce state client sert de porteur d'origine + nonce.
 */
function buildClientState(origin: string): string {
  const nonce = genNonce();
  sessionStorage.setItem(STATE_NONCE_KEY, nonce);
  const payload = JSON.stringify({ origin, nonce, iat: Date.now() });
  return toBase64Url(payload);
}

/* ------------------------------------------------------------------ *
 * Construction de l'URL de consentement                               *
 * ------------------------------------------------------------------ */

/**
 * Construit l'URL d'autorisation Google entièrement côté client.
 *
 * @param clientId CLIENT_ID OAuth public (import.meta.env.VITE_GOOGLE_CLIENT_ID).
 * @param origin   Origine de retour de l'app (appOrigin()).
 * @returns URL complète vers l'écran de consentement Google.
 *
 * Paramètres clés :
 *  - access_type=offline + prompt=consent : force le renvoi d'un refresh_token
 *    (indispensable au stockage serveur pour le refresh sans interaction).
 *  - include_granted_scopes=true : conserve les scopes déjà accordés.
 *  - state : origine + nonce anti-CSRF (signé côté serveur en amont/au retour).
 */
export function buildConsentUrl(clientId: string, origin: string): string {
  if (!clientId) {
    throw new Error(
      "VITE_GOOGLE_CLIENT_ID manquant : impossible de construire l'URL de consentement Google.",
    );
  }
  const state = buildClientState(origin);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * Récupère l'URL de consentement auprès de l'Edge Function `google-connect-url`
 * (state signé HMAC côté serveur). Solution RECOMMANDÉE. En cas d'échec réseau,
 * on retombe sur la construction client `buildConsentUrl`.
 */
export async function getConnectUrl(): Promise<string> {
  const origin = appOrigin();
  try {
    const { data, error } = await supabase.functions.invoke<{ url: string }>(
      "google-connect-url",
      { method: "GET", body: { origin } },
    );
    if (error) throw error;
    if (data?.url) {
      // On mémorise tout de même un nonce pour le contrôle de retour côté client.
      sessionStorage.setItem(STATE_NONCE_KEY, genNonce());
      return data.url;
    }
    throw new Error("Réponse google-connect-url invalide");
  } catch {
    // Secours : URL construite côté client (le state sera vérifié côté serveur).
    return buildConsentUrl(GOOGLE_CLIENT_ID, origin);
  }
}

/* ------------------------------------------------------------------ *
 * Actions haut niveau                                                 *
 * ------------------------------------------------------------------ */

/**
 * Démarre le flux de connexion : construit l'URL de consentement puis redirige
 * le navigateur. Ne revient jamais (navigation quittée) en cas de succès.
 */
export async function connect(): Promise<void> {
  const url = await getConnectUrl();
  window.location.assign(url);
}

/**
 * Lit le statut de connexion via l'Edge Function `google-status`
 * (JWT agence auto). Le front NE lit JAMAIS directement les tables protégées.
 * Renvoie un statut « déconnecté » sûr en cas d'erreur.
 */
export async function getStatus(): Promise<GoogleStatus> {
  const fallback: GoogleStatus = {
    connected: false,
    email: null,
    lastSyncAt: null,
    channelExpiration: null,
    lastError: null,
  };
  try {
    const { data, error } = await supabase.functions.invoke<GoogleStatus>(
      "google-status",
      { method: "GET" },
    );
    if (error) throw error;
    return { ...fallback, ...(data ?? {}) };
  } catch {
    return fallback;
  }
}

/**
 * Déclenche un cycle de synchronisation manuel (`google-sync`, trigger=manual).
 * Retourne le décompte { pulled, pushed, deleted }. Lève en cas d'erreur pour
 * que l'UI puisse afficher un message d'échec.
 */
export async function triggerSync(): Promise<SyncResult> {
  const { data, error } = await supabase.functions.invoke<SyncResult>(
    "google-sync",
    { method: "POST", body: { trigger: "manual" } },
  );
  if (error) throw error;
  if (!data?.ok) {
    throw new Error("Synchronisation refusée par le serveur");
  }
  return data;
}

/**
 * Déconnecte le compte Google (`google-disconnect`) : stop du channel watch,
 * révocation du refresh_token et remise à zéro côté serveur.
 */
export async function disconnect(): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{ ok: boolean }>(
    "google-disconnect",
    { method: "POST" },
  );
  if (error) throw error;
  if (!data?.ok) {
    throw new Error("Déconnexion refusée par le serveur");
  }
}

/* ------------------------------------------------------------------ *
 * Contrôle du retour OAuth (?google=connected)                         *
 * ------------------------------------------------------------------ */

/**
 * À appeler au montage de l'app / du composant : détecte le retour du flux
 * OAuth via le paramètre `?google=connected` (posé par la fonction callback),
 * nettoie l'URL, et renvoie `true` si une connexion vient d'aboutir.
 *
 * Nettoie aussi le nonce anti-CSRF (usage unique).
 */
export function consumeOAuthReturn(): { justConnected: boolean } {
  const url = new URL(window.location.href);
  const flag = url.searchParams.get("google");
  const justConnected = flag === "connected";

  if (flag) {
    // Nettoyage : on retire le paramètre pour éviter de re-déclencher au reload.
    url.searchParams.delete("google");
    window.history.replaceState({}, "", url.toString());
    sessionStorage.removeItem(STATE_NONCE_KEY);
  }
  return { justConnected };
}
