// ============================================================================
// _shared/gfetch.ts : appels Gmail fiables + petits outils Gmail communs.
// ----------------------------------------------------------------------------
//   • gfetch()        : fetch avec délai max (AbortSignal.timeout, 10 s par défaut)
//                       et jusqu'à 3 nouvelles tentatives sur 429 / 500 / 502 / 503 /
//                       504 et erreurs réseau (attente exponentielle + aléa, respecte
//                       Retry-After, 8 s max). Renvoie la dernière Response ; lève
//                       GfetchError si le réseau ou le délai a échoué jusqu'au bout.
//   • classifyGmail() : code d'erreur lisible pour l'app selon la réponse Gmail
//                       (gmail_scope_manquant, limite_gmail, google_non_connecte…).
//   • mapPool()       : traitement parallèle borné (N appels Gmail à la fois).
//   • decodeGmailBody() / charsetOf() : corps de message décodé selon son charset.
// ============================================================================

export type GfetchOptions = {
  /** Délai max par tentative, en ms (défaut 10 s). Couvre aussi la lecture du corps. */
  timeoutMs?: number;
  /** Nouvelles tentatives après la première (défaut 3). */
  retries?: number;
  /** Statuts HTTP qui déclenchent une nouvelle tentative (défaut 429, 500, 502, 503, 504). */
  retryStatuses?: number[];
  /** Retenter après une erreur réseau ou un délai dépassé (défaut true). À couper pour un envoi. */
  retryNetwork?: boolean;
};

/** Échec sans réponse HTTP : délai dépassé ou réseau injoignable (après les tentatives). */
export class GfetchError extends Error {
  constructor(public kind: "timeout" | "reseau", message: string) {
    super(message);
    this.name = "GfetchError";
  }
}

const RETRY_STATUSES = [429, 500, 502, 503, 504];
const MAX_WAIT_MS = 8_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Attente demandée par Retry-After (secondes ou date HTTP), plafonnée à 8 s. */
function retryAfterMs(v: string | null): number | null {
  if (!v) return null;
  const s = Number(v);
  if (Number.isFinite(s) && s >= 0) return Math.min(s * 1000, MAX_WAIT_MS);
  const d = Date.parse(v);
  if (!Number.isNaN(d)) return Math.min(Math.max(0, d - Date.now()), MAX_WAIT_MS);
  return null;
}

/** Attente exponentielle avec aléa : ~0,5 s, 1 s, 2 s… (8 s max). */
function backoffMs(attempt: number): number {
  const base = Math.min(500 * 2 ** attempt, MAX_WAIT_MS);
  return Math.round(base / 2 + Math.random() * (base / 2));
}

/** fetch() avec délai max et nouvelles tentatives (voir l'en-tête du fichier). */
export async function gfetch(url: string, init: RequestInit = {}, opts: GfetchOptions = {}): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const retries = Math.max(0, opts.retries ?? 3);
  const statuses = opts.retryStatuses ?? RETRY_STATUSES;
  const retryNetwork = opts.retryNetwork ?? true;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      const name = (e as { name?: string })?.name ?? "";
      const timeout = name === "TimeoutError" || name === "AbortError";
      if (retryNetwork && attempt < retries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw new GfetchError(timeout ? "timeout" : "reseau", timeout ? "delai_depasse" : String((e as Error)?.message ?? "reseau").slice(0, 200));
    }
    if (statuses.includes(res.status) && attempt < retries) {
      const wait = retryAfterMs(res.headers.get("Retry-After")) ?? backoffMs(attempt);
      await res.body?.cancel().catch(() => {});
      await sleep(wait);
      continue;
    }
    return res;
  }
}

// ---------------------------------------------------------------------------
// Erreurs Gmail
// ---------------------------------------------------------------------------
const RATE_REASONS = ["ratelimitexceeded", "userratelimitexceeded", "dailylimitexceeded", "quotaexceeded", "rate_limit_exceeded", "resource_exhausted"];

/** Raisons d'une erreur Google ({ error: { errors[].reason, details[].reason, status } }), en minuscules. */
export function gmailReasons(body: unknown): string[] {
  const err = (body as { error?: unknown })?.error;
  if (!err || typeof err !== "object") return [];
  const e = err as { status?: unknown; errors?: { reason?: unknown }[]; details?: { reason?: unknown }[] };
  const out: string[] = [];
  for (const x of Array.isArray(e.errors) ? e.errors : []) if (typeof x?.reason === "string") out.push(x.reason.toLowerCase());
  for (const x of Array.isArray(e.details) ? e.details : []) if (typeof x?.reason === "string") out.push(x.reason.toLowerCase());
  if (typeof e.status === "string") out.push(e.status.toLowerCase());
  return out;
}

/** Message d'erreur Google (pour `detail`), 200 caractères max. */
export function gmailMessage(status: number, body: unknown): string {
  const m = (body as { error?: { message?: unknown } })?.error?.message;
  return String(typeof m === "string" && m ? m : status).slice(0, 200);
}

/**
 * Code d'erreur pour l'app selon la réponse Gmail :
 *   429 ou quota (rateLimitExceeded, userRateLimitExceeded, dailyLimitExceeded, quotaExceeded) → limite_gmail (429)
 *   401 → google_non_connecte (401)
 *   403 (insufficientPermissions, et tout autre refus d'accès comme avant) → gmail_scope_manquant (403)
 *   sinon → `fallback` (502 par défaut).
 */
export function classifyGmail(status: number, body: unknown, fallback: string, fallbackStatus = 502): { error: string; status: number } {
  const reasons = gmailReasons(body);
  if (status === 429 || reasons.some((r) => RATE_REASONS.includes(r))) return { error: "limite_gmail", status: 429 };
  if (status === 401) return { error: "google_non_connecte", status: 401 };
  if (status === 403) return { error: "gmail_scope_manquant", status: 403 };
  return { error: fallback, status: fallbackStatus };
}

/** Erreur Gmail transportable (code pour l'app + statut HTTP + détail). */
export class GmailError extends Error {
  constructor(public code: string, public status: number, public detail?: string) {
    super(code);
    this.name = "GmailError";
  }
}

/** GmailError construite depuis une réponse Gmail en échec. */
export function gmailError(status: number, body: unknown, fallback: string, fallbackStatus = 502): GmailError {
  const c = classifyGmail(status, body, fallback, fallbackStatus);
  return new GmailError(c.error, c.status, gmailMessage(status, body));
}

// ---------------------------------------------------------------------------
// Parallélisme borné
// ---------------------------------------------------------------------------
/** Applique `fn` à chaque élément, `limit` à la fois, en gardant l'ordre. `fn` ne doit pas lever. */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

// ---------------------------------------------------------------------------
// Corps de message
// ---------------------------------------------------------------------------
type Hdr = { name: string; value: string };

/** Octets d'une donnée base64url de Gmail (tolère l'absence de « = »). */
export function b64urlToBytes(data: string): Uint8Array {
  let b64 = data.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Charset d'une partie MIME (en-tête Content-Type), "utf-8" par défaut. */
export function charsetOf(headers: Hdr[] | undefined): string {
  const ct = (headers ?? []).find((h) => h.name.toLowerCase() === "content-type")?.value ?? "";
  const m = /charset\s*=\s*"?([^";\s]+)"?/i.exec(ct);
  return m ? m[1].trim().toLowerCase() : "utf-8";
}

/** Charsets « un octet = un caractère » souvent annoncés à tort (Outlook, Exchange). */
const LEGACY = /^(us-ascii|ascii|iso-8859-1|iso-8859-15|latin1|windows-1252|cp1252)$/;

/**
 * Texte d'une partie (base64url) décodé avec son charset (windows-1252, iso-8859-1…), repli UTF-8.
 * Certains serveurs (Exchange…) annoncent iso-8859-1 alors que le texte est en UTF-8 : décodé
 * tel quel, on lisait « trÃ¨s » au lieu de « très ». Si les octets forment de l'UTF-8 valide
 * avec des accents, c'est de l'UTF-8 (un vrai texte latin-1 ne l'est quasiment jamais).
 */
export function decodeGmailBody(data: string, charset = "utf-8"): string {
  let bytes: Uint8Array;
  try {
    bytes = b64urlToBytes(data);
  } catch {
    return "";
  }
  if (LEGACY.test((charset || "").toLowerCase()) && bytes.some((b) => b >= 0x80)) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      /* pas de l'UTF-8 : vrai latin-1, décodé ci-dessous */
    }
  }
  try {
    return new TextDecoder(charset || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}
