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
//     google-webhook et google-watch-renew — plus AUCUNE réimplémentation ;
//   - un lease-lock à expiration (acquireLock/releaseLock) anti-verrou-collé ;
//   - helpers CORS (whitelist stricte, pas de wildcard), CRON secret, waitUntil.
//
// SÉCURITÉ : n'utilise QUE la clé service-role. Aucun secret (refresh_token,
// client_secret) n'est jamais renvoyé au front.
// ============================================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

/** Alias ergonomique (client optionnel). */
export function getFreshAccessToken(sb: SupabaseClient = getServiceClient()): Promise<string> {
  return getAccessToken(sb);
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

    const res = await fetch(url, { ...init, headers });

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
        ? retryAfter * 1000
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
 * - marqueurs anti-boucle : ttp_source='ttp', ttp_updated=<updated_at ISO>.
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
  type: string; who: string | null; sort_order: number;
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

  return {
    title: g.summary && g.summary.trim() ? g.summary : "(sans titre)",
    date,
    time,
    day,
    type: priv.ttp_type && priv.ttp_type.length > 0 ? priv.ttp_type : "call",
    who: priv.ttp_who && priv.ttp_who.length > 0 ? priv.ttp_who : null,
    sort_order: Number.isFinite(parsedSort) ? parsedSort : 0,
  };
}

// ============================================================================
// Lease-lock à expiration (anti-verrou-collé)
// ============================================================================

/**
 * Prend le verrou de sync si libre OU si le lease précédent a expiré
 * (isolate tué avant release). Renvoie true si acquis.
 */
export async function acquireLock(sb: SupabaseClient): Promise<boolean> {
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
  return Array.isArray(data) && data.length === 1;
}

export async function releaseLock(sb: SupabaseClient): Promise<void> {
  await sb.from("sync_state").update({ syncing: false, syncing_at: null }).eq("id", 1);
}

// ============================================================================
// CYCLE DE SYNC : PUSH (agence -> Google) puis PULL (Google -> events)
// Réutilisé par google-sync (handler), google-webhook, google-watch-renew.
// ============================================================================

export interface SyncCounters {
  pulled: number;
  pushed: number;
  deleted: number;
  resynced: boolean;
}

interface Ctx {
  sb: SupabaseClient;
}

// --- PUSH -------------------------------------------------------------------

async function pushLocalChanges(ctx: Ctx): Promise<{ pushed: number; deleted: number }> {
  const { sb } = ctx;
  let pushed = 0;
  let deleted = 0;

  const { data: candidates, error } = await sb
    .from("events").select("*").eq("sync_source", "agence").returns<EventRow[]>();
  if (error) throw error;

  const toPush = (candidates ?? []).filter((r) => {
    if (!r.last_synced_at) return true;
    return new Date(r.updated_at).getTime() > new Date(r.last_synced_at).getTime();
  });

  for (const row of toPush) {
    // Suppression (tombstone) -> DELETE Google.
    if (row.deleted) {
      if (row.google_event_id) {
        const res = await gcalFetch(
          sb,
          `/calendars/${CALENDAR_ID}/events/${encodeURIComponent(row.google_event_id)}`,
          { method: "DELETE" },
        );
        if (res.ok || res.status === 404 || res.status === 410) {
          deleted++;
        } else {
          continue; // retenté au prochain cycle
        }
      }
      await sb.from("events")
        .update({ last_synced_at: new Date().toISOString(), sync_source: "google" })
        .eq("id", row.id);
      continue;
    }

    // Création -> INSERT Google.
    if (!row.google_event_id) {
      const res = await gcalFetch(
        sb, `/calendars/${CALENDAR_ID}/events`,
        { method: "POST", body: JSON.stringify(eventToGoogle(row)) },
      );
      if (!res.ok) continue;
      const g = (await res.json()) as GoogleEvent;
      const now = new Date().toISOString();
      // updated_at aligné sur last_synced_at => plus re-sélectionné (anti-boucle).
      await sb.from("events").update({
        google_event_id: g.id,
        google_etag: g.etag ?? null,
        last_synced_at: now,
        updated_at: now,
      }).eq("id", row.id);
      pushed++;
      continue;
    }

    // Mise à jour -> PATCH Google (If-Match: etag).
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (row.google_etag) headers["If-Match"] = row.google_etag;
    const res = await gcalFetch(
      sb, `/calendars/${CALENDAR_ID}/events/${encodeURIComponent(row.google_event_id)}`,
      { method: "PATCH", headers, body: JSON.stringify(eventToGoogle(row)) },
    );

    if (res.status === 412) continue; // conflit -> le PULL tranche
    if (res.status === 404 || res.status === 410) {
      await sb.from("events")
        .update({ google_event_id: null, google_etag: null }).eq("id", row.id);
      continue;
    }
    if (!res.ok) continue;

    const g = (await res.json()) as GoogleEvent;
    const now = new Date().toISOString();
    await sb.from("events").update({
      google_etag: g.etag ?? row.google_etag,
      last_synced_at: now,
      updated_at: now,
    }).eq("id", row.id);
    pushed++;
  }

  return { pushed, deleted };
}

// --- PULL -------------------------------------------------------------------

/** Compare deux ISO à la seconde près (robuste aux normalisations Z/+00:00/µs). */
function sameInstant(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 1000;
}

async function applyGoogleItem(sb: SupabaseClient, g: GoogleEvent): Promise<"pulled" | "deleted" | null> {
  const { data: existing } = await sb
    .from("events").select("*").eq("google_event_id", g.id).maybeSingle<EventRow>();

  // Suppression côté Google.
  if (g.status === "cancelled") {
    if (!existing || existing.deleted) return null;
    await sb.from("events").update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      sync_source: "google",
      last_synced_at: new Date().toISOString(),
      updated_at: g.updated ?? new Date().toISOString(),
    }).eq("id", existing.id);
    return "deleted";
  }

  const gUpdated = g.updated ?? new Date().toISOString();
  const fields = googleToEvent(g);
  const now = new Date().toISOString();

  if (existing) {
    // Anti-boucle (défense en profondeur) : si l'event revient avec NOTRE dernière
    // updated_at (notre propre push), on ne réécrit pas les champs.
    const ourMarker = g.extendedProperties?.private?.ttp_updated;
    if (existing.sync_source === "agence" && sameInstant(ourMarker, existing.updated_at)) {
      await sb.from("events")
        .update({ google_etag: g.etag ?? existing.google_etag, last_synced_at: now })
        .eq("id", existing.id);
      return null;
    }

    // Dernier modifié gagne.
    if (new Date(gUpdated).getTime() > new Date(existing.updated_at).getTime()) {
      await sb.from("events").update({
        ...fields,
        google_etag: g.etag ?? existing.google_etag,
        sync_source: "google",
        updated_at: gUpdated,
        last_synced_at: now,
        deleted: false,
        deleted_at: null,
      }).eq("id", existing.id);
      return "pulled";
    }
    return null; // agence plus récent
  }

  // Nouvel event Google. upsert onConflict pour éviter un throw si course.
  await sb.from("events").upsert({
    ...fields,
    google_event_id: g.id,
    google_etag: g.etag ?? null,
    sync_source: "google",
    updated_at: gUpdated,
    last_synced_at: now,
    deleted: false,
  }, { onConflict: "google_event_id" });
  return "pulled";
}

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
        const applied = await applyGoogleItem(sb, item);
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
 * Renvoie les compteurs, ou { skipped:'locked' } si un sync tourne déjà.
 */
export async function runSyncCycle(
  sb: SupabaseClient,
  mode: "incremental" | "full" = "incremental",
): Promise<SyncCounters | { skipped: "locked" }> {
  const locked = await acquireLock(sb);
  if (!locked) return { skipped: "locked" };

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

    const ctx: Ctx = { sb };
    const push = await pushLocalChanges(ctx);
    const pull = await pullFromGoogle(ctx, currentSyncToken, mode !== "full");

    const stateUpdate: Record<string, unknown> = { last_sync_at: new Date().toISOString() };
    if (pull.nextSyncToken) stateUpdate.sync_token = pull.nextSyncToken;
    await sb.from("sync_state").update(stateUpdate).eq("id", 1);

    return {
      pulled: pull.pulled,
      pushed: push.pushed,
      deleted: push.deleted + pull.deleted,
      resynced: pull.resynced,
    };
  } finally {
    await releaseLock(sb).catch(() => {});
  }
}
