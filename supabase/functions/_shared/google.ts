// ============================================================================
// _shared/google.ts
// ----------------------------------------------------------------------------
// Module partagé (Deno / Supabase Edge Functions) pour la synchronisation
// bidirectionnelle `events` <-> Google Calendar 'primary' (Option C).
//
// Fournit, en source unique de vérité :
//   - le client Supabase service-role (bypass RLS) ;
//   - la lecture/rafraîchissement de l'access_token (getAccessToken) ;
//   - le client Google Calendar (gcalFetch : retry 401 + backoff 429/5xx) ;
//   - le mapping DST-aware events <-> Google (eventToGoogle / googleToEvent) ;
//   - le watch (gcalWatch / gcalStopChannel) ;
//   - le CYCLE DE SYNC complet (runSyncCycle) réutilisé par google-sync,
//     google-webhook, google-watch-renew et google-oauth-callback, plus AUCUNE
//     réimplémentation. Le passage lui-même (quoi envoyer, quoi marquer, que faire
//     d'une réponse de Google, d'un 412, d'un 404) est dans _shared/synchroAgenda.ts,
//     testé avec une base et un Google simulés ; ce fichier fournit la vraie base et
//     le vrai Google. Depuis le 27/11/2026, un envoi réussi passe la ligne en
//     sync_source 'google' (sinon le déclencheur touch_updated_at la laissait « à
//     envoyer » : boucle avec le webhook), et toute écriture qui marque une ligne se
//     fait sous condition que updated_at n'ait pas bougé depuis la lecture ;
//   - un lease-lock à expiration (acquireLock/releaseLock) anti-verrou-collé ;
//   - helpers CORS (whitelist stricte, pas de wildcard), CRON secret, waitUntil.
//
// SÉCURITÉ : n'utilise QUE la clé service-role. Aucun secret (refresh_token,
// client_secret) n'est jamais renvoyé au front.
// ============================================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { guessEventKind } from "./eventKind.ts";
import { texteSur } from "./texteSur.ts";
import {
  appliquerLecture,
  type BaseAgenda,
  type BilanSync,
  bilanVide,
  envoyerVersGoogle,
  type GoogleAgenda,
  type Journal,
} from "./synchroAgenda.ts";

// ----------------------------------------------------------------------------
// Constantes & environnement
// ----------------------------------------------------------------------------

export const GCAL_BASE = "https://www.googleapis.com/calendar/v3";
export const CALENDAR_ID = "primary";
export const APP_TIMEZONE = "Europe/Paris";
export const DEFAULT_EVENT_DURATION_MIN = 60;

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const PROJECT_URL = "https://zizvggziggswhrbuyhuo.supabase.co";
export const WEBHOOK_URL = `${PROJECT_URL}/functions/v1/google-webhook`;
export const SYNC_URL = `${PROJECT_URL}/functions/v1/google-sync`;

/** Fenêtre du bootstrap (1er PULL sans syncToken) : bornée. */
const BOOTSTRAP_PAST_DAYS = 60;
const BOOTSTRAP_FUTURE_DAYS = 365;

/** Lease du verrou de sync : périmé au-delà de cette durée (anti-verrou-collé). */
const LOCK_LEASE_MS = 2 * 60 * 1000; // 2 min
/** Marge avant expiration de l'access_token. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`env_missing:${name}`);
  return v;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const GOOGLE_CLIENT_ID = requireEnv("GOOGLE_CLIENT_ID");
const GOOGLE_CLIENT_SECRET = requireEnv("GOOGLE_CLIENT_SECRET");
export const CRON_SECRET = requireEnv("CRON_SECRET");

// ----------------------------------------------------------------------------
// Client Supabase service-role (singleton)
// ----------------------------------------------------------------------------

let _sb: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (_sb) return _sb;
  _sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _sb;
}

// ----------------------------------------------------------------------------
// CORS (whitelist stricte : jamais de wildcard, jamais de fallback laxiste)
// ----------------------------------------------------------------------------

/**
 * En-têtes CORS. Si l'origine appelante n'est pas whitelistée, on N'émet PAS
 * d'en-tête Allow-Origin (le navigateur bloquera) — jamais de "*".
 */
export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "")
    .split(",").map((o) => o.trim()).filter(Boolean);
  const base: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Vary": "Origin",
  };
  if (origin && allowed.includes(origin)) {
    base["Access-Control-Allow-Origin"] = origin;
  }
  return base;
}

export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/**
 * Garantit qu'une tâche de fond survit à la réponse HTTP dans l'edge runtime.
 * Utilise EdgeRuntime.waitUntil si disponible, sinon await direct (sûr).
 */
export function waitUntil(p: Promise<unknown>): void {
  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") {
    er.waitUntil(p.catch((e: unknown) => console.error("waitUntil task failed", e)));
  } else {
    // Pas de waitUntil : on laisse la promesse tourner (best effort).
    p.catch((e: unknown) => console.error("bg task failed", e));
  }
}

// ----------------------------------------------------------------------------
// CRON secret / comparaison temps constant
// ----------------------------------------------------------------------------

export function timingSafeEqualStr(a: string, b: string): boolean {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ba.length, bb.length);
  let diff = ba.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/** Vérifie Authorization: Bearer <CRON_SECRET> (temps constant). */
export function checkCronSecret(req: Request): boolean {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return timingSafeEqualStr(token, CRON_SECRET);
}

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface GoogleTokensRow {
  id: number;
  google_sub: string | null;
  google_email: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_type: string | null;
  scope: string | null;
  expires_at: string | null;
  connected: boolean;
  last_error: string | null;
}

export interface SyncStateRow {
  id: number;
  sync_token: string | null;
  channel_id: string | null;
  channel_resource_id: string | null;
  channel_token: string | null;
  channel_expiration: string | null;
  last_sync_at: string | null;
  syncing: boolean;
  syncing_at: string | null;
}

export interface EventRow {
  id: string;
  day: number | null;
  date: string;
  time: string | null;
  title: string;
  type: string;
  who: string | null;
  description: string | null;
  sort_order: number;
  google_event_id: string | null;
  google_etag: string | null;
  updated_at: string;
  last_synced_at: string | null;
  sync_source: string | null;
  deleted: boolean;
  deleted_at: string | null;
}

export interface GoogleEvent {
  id?: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  updated?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
}

// ----------------------------------------------------------------------------
// Access token : lecture + refresh
// ----------------------------------------------------------------------------

export async function getAccessToken(sb: SupabaseClient): Promise<string> {
  const { data: tok, error } = await sb
    .from("google_tokens").select("*").eq("id", 1).single<GoogleTokensRow>();

  if (error) throw new Error(`google_tokens_read_failed:${error.message}`);
  if (!tok || !tok.connected) throw new Error("not_connected");
  if (!tok.refresh_token) {
    await sb.from("google_tokens")
      .update({ connected: false, last_error: "no_refresh_token" }).eq("id", 1);
    throw new Error("not_connected");
  }

  if (
    tok.access_token && tok.expires_at &&
    new Date(tok.expires_at).getTime() - TOKEN_EXPIRY_MARGIN_MS > Date.now()
  ) {
    return tok.access_token;
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: tok.refresh_token,
    }),
  });
  const j = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (j?.error === "invalid_grant") {
      // refresh_token révoqué : on marque déconnecté SANS écraser le refresh_token
      // par null (la reconnexion OAuth le remplacera).
      await sb.from("google_tokens")
        .update({ connected: false, last_error: "invalid_grant" }).eq("id", 1);
      throw new Error("invalid_grant");
    }
    throw new Error(`refresh_failed:${j?.error ?? res.status}`);
  }

  await sb.from("google_tokens").update({
    access_token: j.access_token,
    expires_at: new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString(),
    last_error: null,
  }).eq("id", 1);

  return j.access_token as string;
}

// ----------------------------------------------------------------------------
// Client Google Calendar (retry 401 -> refresh forcé, backoff 429/5xx)
// ----------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Appel Google Calendar. `path` : URL absolue OU chemin relatif à GCAL_BASE.
 * - 401 : invalide expires_at en base (force le refresh) puis retente 1 fois.
 * - 429/5xx : backoff exponentiel (respecte Retry-After), max `maxRetries`.
 * Renvoie la Response brute (l'appelant gère 404/410/412).
 */
export async function gcalFetch(
  sb: SupabaseClient,
  path: string,
  init: RequestInit = {},
  opts: { maxRetries?: number } = {},
): Promise<Response> {
  const url = path.startsWith("http")
    ? path
    : `${GCAL_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  const maxRetries = opts.maxRetries ?? 5;
  let refreshedOnce = false;
  let attempt = 0;

  while (true) {
    const token = await getAccessToken(sb);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const res = await fetch(url, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(25_000) });

    if (res.status === 401 && !refreshedOnce) {
      refreshedOnce = true;
      // Force le refresh : on invalide expires_at pour que getAccessToken relance.
      await sb.from("google_tokens")
        .update({ expires_at: new Date(0).toISOString() }).eq("id", 1);
      continue;
    }

    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      const retryAfter = Number(res.headers.get("Retry-After"));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 20_000) // Retry-After plafonné
        : Math.min(1000 * 2 ** attempt, 16_000);
      attempt++;
      await sleep(delayMs);
      continue;
    }

    return res;
  }
}

// ----------------------------------------------------------------------------
// Watch channels
// ----------------------------------------------------------------------------

export interface WatchResult {
  channel_id: string;
  channel_resource_id: string;
  channel_token: string;
  channel_expiration: string;
}

export async function gcalWatch(
  sb: SupabaseClient,
  ttlSeconds = 604800,
): Promise<WatchResult> {
  const channelId = crypto.randomUUID();
  const channelToken = crypto.randomUUID() + "." + crypto.randomUUID();

  const res = await gcalFetch(sb, `/calendars/${CALENDAR_ID}/events/watch`, {
    method: "POST",
    body: JSON.stringify({
      id: channelId,
      type: "web_hook",
      address: WEBHOOK_URL,
      token: channelToken,
      params: { ttl: String(ttlSeconds) },
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`watch_failed:${res.status}:${JSON.stringify(body).slice(0, 300)}`);
  }

  const expMs = Number(body.expiration);
  const expiration = Number.isFinite(expMs)
    ? new Date(expMs).toISOString()
    : new Date(Date.now() + ttlSeconds * 1000).toISOString();

  const result: WatchResult = {
    channel_id: channelId,
    channel_resource_id: body.resourceId,
    channel_token: channelToken,
    channel_expiration: expiration,
  };

  const { error } = await sb.from("sync_state").upsert({
    id: 1,
    channel_id: result.channel_id,
    channel_resource_id: result.channel_resource_id,
    channel_token: result.channel_token,
    channel_expiration: result.channel_expiration,
  }, { onConflict: "id" });
  if (error) throw new Error(`sync_state_upsert_failed:${error.message}`);

  return result;
}

export async function gcalStopChannel(
  sb: SupabaseClient,
  channelId: string,
  resourceId: string,
): Promise<boolean> {
  try {
    const res = await gcalFetch(sb, `/channels/stop`, {
      method: "POST",
      body: JSON.stringify({ id: channelId, resourceId }),
    });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

export async function getSyncState(sb: SupabaseClient): Promise<SyncStateRow | null> {
  const { data, error } = await sb
    .from("sync_state").select("*").eq("id", 1).maybeSingle<SyncStateRow>();
  if (error) throw new Error(`sync_state_read_failed:${error.message}`);
  return data ?? null;
}

// ----------------------------------------------------------------------------
// Déclenchement de sync : appel HTTP interne (fire-and-forget avec waitUntil)
// ----------------------------------------------------------------------------

/**
 * Déclenche google-sync via HTTP interne (CRON_SECRET). Utilise waitUntil pour
 * survivre à la réponse. À réserver aux cas où on NE veut pas exécuter la sync
 * inline. Le webhook/renew préfèrent runSyncCycle inline (fiable).
 * `trigger` n'est qu'une étiquette pour le journal de google-sync (correspondance
 * dans son en-tête). Si un passage tourne déjà, celui-ci est sauté sans nouvel
 * essai : le passage suivant (avis de Google ou cron horaire) prend le relais.
 */
export function triggerSync(trigger: "webhook" | "cron" | "renew"): void {
  waitUntil(
    fetch(SYNC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${CRON_SECRET}`,
      },
      body: JSON.stringify({ trigger }),
    }).then((r) => {
      if (!r.ok) console.error(`triggerSync(${trigger}) http_${r.status}`);
    }),
  );
}

// ============================================================================
// Mapping events <-> Google (DST-aware, source unique de vérité)
// ============================================================================

/** Sentinelle "pas d'heure" utilisée par le front (Planning). */
const NO_TIME = "—";

/** Un event est "timed" (à l'heure) si `time` est un vrai HH:MM. */
function isTimed(time: string | null): boolean {
  return !!time && /^\d{2}:\d{2}$/.test(time.trim());
}

function addDaysToDateOnly(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function tzOffsetMinutes(utcDate: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const map: Record<string, number> = {};
  for (const p of dtf.formatToParts(utcDate)) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  const asUTC = Date.UTC(
    map.year, map.month - 1, map.day,
    map.hour === 24 ? 0 : map.hour, map.minute, map.second,
  );
  return Math.round((asUTC - utcDate.getTime()) / 60_000);
}

function offsetToIso(offsetMin: number): string {
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

function localWallTimeToIso(date: string, time: string, timeZone: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const approxUtc = new Date(Date.UTC(y, mo - 1, d, h, mi, 0));
  const offMin = tzOffsetMinutes(approxUtc, timeZone);
  const hhmmss = time.length === 5 ? `${time}:00` : time;
  return `${date}T${hhmmss}${offsetToIso(offMin)}`;
}

function isoDateTimeToLocalParts(
  isoDateTime: string,
  timeZone: string,
): { date: string; time: string } {
  const dt = new Date(isoDateTime);
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(dt)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const hour = map.hour === "24" ? "00" : map.hour;
  return { date: `${map.year}-${map.month}-${map.day}`, time: `${hour}:${map.minute}` };
}

/**
 * events(row) -> ressource Google (insert/patch).
 * - all-day (time null/''/'—') : start.date, end.date = date+1 (EXCLUSIF).
 * - timed : start/end.dateTime DST-aware Europe/Paris, durée 60 min ; le calcul
 *   passe par l'instant absolu -> gère correctement le passage de minuit (end sur
 *   le jour suivant si nécessaire).
 * - type/who/sort_order -> extendedProperties.private.
 * - repères : ttp_source='ttp', ttp_updated=<updated_at ISO> (version de l'app envoyée ;
 *   la lecture de Google reconnaît notre propre envoi à son etag, pas à ce repère).
 */
export function eventToGoogle(row: EventRow): Record<string, unknown> {
  const priv: Record<string, string> = {
    ttp_source: "ttp",
    ttp_type: row.type ?? "",
    ttp_who: row.who ?? "",
    ttp_sort: String(row.sort_order ?? 0),
  };
  if (row.updated_at) priv.ttp_updated = row.updated_at;

  const base: Record<string, unknown> = {
    summary: row.title && row.title.trim() ? row.title : "(sans titre)",
    // Toujours envoyer description (même "") pour qu'un effacement se propage à Google.
    description: row.description ?? "",
    extendedProperties: { private: priv },
  };

  if (isTimed(row.time)) {
    const startIso = localWallTimeToIso(row.date, row.time as string, APP_TIMEZONE);
    const startAbs = new Date(startIso);
    const endAbs = new Date(startAbs.getTime() + DEFAULT_EVENT_DURATION_MIN * 60_000);
    const endParts = isoDateTimeToLocalParts(endAbs.toISOString(), APP_TIMEZONE);
    const endIso = localWallTimeToIso(endParts.date, endParts.time, APP_TIMEZONE);
    base.start = { dateTime: startIso, timeZone: APP_TIMEZONE };
    base.end = { dateTime: endIso, timeZone: APP_TIMEZONE };
  } else {
    base.start = { date: row.date };
    base.end = { date: addDaysToDateOnly(row.date, 1) };
  }
  return base;
}

/**
 * Google(event) -> champs `events` (dont `day` dérivé de la date).
 * all-day => time = '—' (sentinelle du front, pas null). type par défaut 'call'
 * (type valide pour l'UI) pour un event créé directement dans Google.
 */
export function googleToEvent(g: GoogleEvent): {
  title: string; date: string; time: string | null; day: number;
  type: string; who: string | null; description: string | null; sort_order: number;
} {
  const priv = g.extendedProperties?.private ?? {};
  let date: string;
  let time: string | null;

  if (g.start?.dateTime) {
    const parts = isoDateTimeToLocalParts(g.start.dateTime, APP_TIMEZONE);
    date = parts.date;
    time = parts.time;
  } else if (g.start?.date) {
    date = g.start.date;
    time = NO_TIME;
  } else {
    date = isoDateTimeToLocalParts(new Date().toISOString(), APP_TIMEZONE).date;
    time = NO_TIME;
  }

  const day = Number(date.split("-")[2]) || 1;
  const parsedSort = Number.parseInt(priv.ttp_sort ?? "", 10);

  // Titre et description recopiés de Google : sans caractère nul ni moitié d'emoji seule
  // (texteSur), sinon la base refuse le rendez-vous et il manque au Planning.
  return {
    title: g.summary && g.summary.trim() ? texteSur(g.summary) : "(sans titre)",
    date,
    time,
    day,
    // Sans type choisi dans l'app : deviné d'après le titre (« Poster pour Nakd » = deadline).
    type: priv.ttp_type && priv.ttp_type.length > 0 ? priv.ttp_type : guessEventKind(g.summary),
    who: priv.ttp_who && priv.ttp_who.length > 0 ? priv.ttp_who : null,
    description: g.description && g.description.trim() ? texteSur(g.description) : null,
    sort_order: Number.isFinite(parsedSort) ? parsedSort : 0,
  };
}

// ============================================================================
// Lease-lock à expiration (anti-verrou-collé)
// ============================================================================

/**
 * Prend le verrou de sync si libre OU si le lease précédent a expiré
 * (isolate tué avant release). Renvoie le jeton du verrou (son heure de prise),
 * ou null s'il est déjà pris. Seul le détenteur du jeton peut le prolonger ou le
 * libérer : un passage trop long ne libère plus le verrou d'un AUTRE passage.
 */
export async function acquireLock(sb: SupabaseClient): Promise<string | null> {
  await sb.from("sync_state").upsert({ id: 1 }, { onConflict: "id", ignoreDuplicates: true });
  const staleThreshold = new Date(Date.now() - LOCK_LEASE_MS).toISOString();
  const now = new Date().toISOString();

  const { data, error } = await sb
    .from("sync_state")
    .update({ syncing: true, syncing_at: now })
    .eq("id", 1)
    .or(`syncing.eq.false,syncing_at.lt.${staleThreshold}`)
    .select("id");

  if (error) throw error;
  return Array.isArray(data) && data.length === 1 ? now : null;
}

/** Prolonge le lease (entre deux étapes longues). Renvoie le nouveau jeton, ou null si perdu. */
export async function renewLock(sb: SupabaseClient, token: string): Promise<string | null> {
  const now = new Date().toISOString();
  const { data, error } = await sb.from("sync_state").update({ syncing_at: now }).eq("id", 1).eq("syncing", true).eq("syncing_at", token).select("id");
  if (error) return null;
  return Array.isArray(data) && data.length === 1 ? now : null;
}

export async function releaseLock(sb: SupabaseClient, token: string): Promise<void> {
  await sb.from("sync_state").update({ syncing: false, syncing_at: null }).eq("id", 1).eq("syncing_at", token);
}

// ============================================================================
// CYCLE DE SYNC : PUSH (agence -> Google) puis PULL (Google -> events)
// Réutilisé par google-sync (handler), google-webhook, google-watch-renew et
// google-oauth-callback : ces 4 fonctions sont à redéployer quand il change.
// Le passage lui-même (décisions, écritures, 412, 404) est dans _shared/synchroAgenda.ts,
// testé avec une base et un Google simulés ; ici, seulement la vraie base et le vrai Google.
// ============================================================================

/** Bilan d'un passage : reçus, envoyés, supprimés, conflits, absents de Google, refus. */
export type SyncCounters = BilanSync;

interface Ctx {
  sb: SupabaseClient;
  base: BaseAgenda<EventRow>;
  google: GoogleAgenda<EventRow>;
}

/** Une ligne de journal de la synchro (refus, absence, conflit, écriture refusée…), `synchro-agenda {…}`. */
const journalSynchro: Journal = (quoi) => console.warn("synchro-agenda", JSON.stringify(quoi));

/** La table `events` pour la synchro (clé service : le déclencheur touch_updated_at s'applique). */
function baseAgenda(sb: SupabaseClient): BaseAgenda<EventRow> {
  return {
    async lignesAgence() {
      const { data, error } = await sb
        .from("events").select("*").eq("sync_source", "agence").returns<EventRow[]>();
      if (error) throw error;
      return data ?? [];
    },
    async parIdGoogle(idGoogle) {
      const { data, error } = await sb
        .from("events").select("*").eq("google_event_id", idGoogle).maybeSingle<EventRow>();
      if (error) throw new Error(`events_read_failed:${error.message}`);
      return data ?? null;
    },
    async ecrireSiInchangee(ligne, champs) {
      const { data, error } = await sb.from("events").update(champs)
        .eq("id", ligne.id).eq("updated_at", ligne.updated_at).select("id");
      if (error) return { ecrite: false, erreur: error.message };
      return { ecrite: (data?.length ?? 0) > 0, erreur: null };
    },
    async ecrire(id, champs) {
      const { error } = await sb.from("events").update(champs).eq("id", id);
      return error ? error.message : null;
    },
    async ajouter(champs) {
      // upsert sur google_event_id : pas de doublon si deux lectures se croisent.
      const { error } = await sb.from("events").upsert(champs, { onConflict: "google_event_id" });
      return error ? error.message : null;
    },
  };
}

/** L'agenda Google de l'agence pour la synchro. */
function googleAgenda(sb: SupabaseClient): GoogleAgenda<EventRow> {
  const base = `/calendars/${CALENDAR_ID}/events`;
  return {
    async envoyer(action, ligne) {
      const chemin = ligne.google_event_id ? `${base}/${encodeURIComponent(ligne.google_event_id)}` : base;
      const init: RequestInit = action === "supprimer"
        ? { method: "DELETE" }
        : { method: action === "creer" ? "POST" : "PATCH", body: JSON.stringify(eventToGoogle(ligne)) };
      // Mise à jour : If-Match etag ; un 412 dit que Google a changé depuis (le rendez-vous est alors relu).
      if (action === "modifier" && ligne.google_etag) {
        init.headers = { "Content-Type": "application/json", "If-Match": ligne.google_etag };
      }
      const res = await gcalFetch(sb, chemin, init);
      if (res.ok && action !== "supprimer") {
        return { statut: res.status, g: (await res.json().catch(() => ({}))) as GoogleEvent };
      }
      await res.body?.cancel().catch(() => {});
      return { statut: res.status, g: {} };
    },
    async lire(idGoogle) {
      const res = await gcalFetch(sb, `${base}/${encodeURIComponent(idGoogle)}`, { method: "GET" });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return { statut: res.status, g: null };
      }
      return { statut: res.status, g: (await res.json().catch(() => null)) as GoogleEvent | null };
    },
    champs: (g) => googleToEvent(g),
  };
}

// --- PULL -------------------------------------------------------------------

async function pullFromGoogle(
  ctx: Ctx,
  currentSyncToken: string | null,
  useSyncToken: boolean,
): Promise<{ pulled: number; deleted: number; resynced: boolean; nextSyncToken: string | null }> {
  const { sb } = ctx;
  let pulled = 0;
  let deleted = 0;
  let resynced = false;

  attemptLoop: while (true) {
    let pageToken: string | null = null;
    let nextSyncToken: string | null = null;
    const doIncremental = useSyncToken && !!currentSyncToken;

    do {
      const params = new URLSearchParams({
        singleEvents: "true", showDeleted: "true", maxResults: "250",
      });
      if (doIncremental) {
        params.set("syncToken", currentSyncToken as string);
      } else {
        const nowMs = Date.now();
        params.set("timeMin", new Date(nowMs - BOOTSTRAP_PAST_DAYS * 864e5).toISOString());
        params.set("timeMax", new Date(nowMs + BOOTSTRAP_FUTURE_DAYS * 864e5).toISOString());
      }
      if (pageToken) params.set("pageToken", pageToken);

      const res = await gcalFetch(sb, `/calendars/${CALENDAR_ID}/events?${params.toString()}`, { method: "GET" });

      if (res.status === 410 && doIncremental && !resynced) {
        resynced = true;
        currentSyncToken = null;
        continue attemptLoop; // full resync une fois
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`gcal_list_failed:${res.status}:${body.slice(0, 200)}`);
      }

      const data = (await res.json()) as {
        items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string;
      };
      for (const item of data.items ?? []) {
        // Une lecture ou une écriture ratée en base (etag, suppression) lève une erreur : le passage
        // s'arrête avant d'enregistrer le nouveau syncToken, et le suivant relit ce changement.
        const applied = await appliquerLecture(ctx.base, ctx.google, item, new Date().toISOString(), journalSynchro);
        if (applied === "pulled") pulled++;
        else if (applied === "deleted") deleted++;
      }
      pageToken = data.nextPageToken ?? null;
      if (!pageToken && data.nextSyncToken) nextSyncToken = data.nextSyncToken;
    } while (pageToken);

    return { pulled, deleted, resynced, nextSyncToken };
  }
}

/**
 * Exécute un cycle de sync complet SOUS VERROU (lease). PUSH puis PULL.
 * `mode='full'` force un full pull et réinitialise le syncToken.
 * Renvoie le bilan (reçus, envoyés, supprimés, conflits, absents, refus, verrou perdu), ou
 * { skipped:'locked' } si un sync tourne déjà. Les appelants en écrivent une ligne de
 * journal par passage (ligneJournal de _shared/synchroAgenda.ts).
 */
export async function runSyncCycle(
  sb: SupabaseClient,
  mode: "incremental" | "full" = "incremental",
): Promise<SyncCounters | { skipped: "locked" }> {
  let lock = await acquireLock(sb);
  if (!lock) return { skipped: "locked" };

  try {
    // Vérifie la connexion tôt (lève not_connected/invalid_grant si besoin).
    await getAccessToken(sb);

    if (mode === "full") {
      await sb.from("sync_state").update({ sync_token: null }).eq("id", 1);
    }

    const { data: state } = await sb
      .from("sync_state").select("sync_token").eq("id", 1)
      .maybeSingle<{ sync_token: string | null }>();
    const currentSyncToken = mode === "full" ? null : (state?.sync_token ?? null);

    const ctx: Ctx = { sb, base: baseAgenda(sb), google: googleAgenda(sb) };
    const bilan = bilanVide();
    await envoyerVersGoogle(ctx.base, ctx.google, bilan, journalSynchro);
    // Prolonge le lease avant le PULL ; verrou perdu (passage trop long, repris par un
    // autre) = on s'arrête là plutôt que de synchroniser deux fois en parallèle. Le bilan
    // dit ce qui est déjà parti (verrouPerdu), au lieu d'un « saute: verrou » trompeur.
    const renewed = await renewLock(sb, lock);
    if (!renewed) {
      bilan.verrouPerdu = true;
      return bilan;
    }
    lock = renewed;
    const pull = await pullFromGoogle(ctx, currentSyncToken, mode !== "full");

    const stateUpdate: Record<string, unknown> = { last_sync_at: new Date().toISOString() };
    if (pull.nextSyncToken) stateUpdate.sync_token = pull.nextSyncToken;
    await sb.from("sync_state").update(stateUpdate).eq("id", 1);

    // L'envoi a déjà compté les rendez-vous relus après un 412.
    bilan.pulled += pull.pulled;
    bilan.deleted += pull.deleted;
    bilan.resynced = pull.resynced;
    return bilan;
  } finally {
    await releaseLock(sb, lock).catch(() => {});
  }
}
