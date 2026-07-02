// ============================================================================
// _shared/state.ts
// ----------------------------------------------------------------------------
// Signature/vérification du paramètre `state` OAuth (anti-CSRF).
//
// Le state est signé HMAC-SHA256 avec STATE_SIGNING_SECRET (secret serveur, JAMAIS
// exposé au front). Format : base64url(payloadJson) + "." + base64url(hmac).
// Payload : { origin, nonce, iat }. TTL 10 min. Comparaison à temps constant.
//
// signState() est appelé par google-connect-url (serveur) ; verifyState() par
// google-oauth-callback. Le front ne signe RIEN : il reçoit l'URL déjà signée.
// ============================================================================

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface StatePayload {
  origin: string;
  nonce: string;
  iat: number; // ms epoch
}

function requireSecret(): string {
  const s = Deno.env.get("STATE_SIGNING_SECRET");
  if (!s) throw new Error("env_missing:STATE_SIGNING_SECRET");
  return s;
}

// --- base64url helpers -------------------------------------------------------

function bytesToB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64UrlToBytes(s: string): Uint8Array {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function strToB64Url(s: string): string {
  return bytesToB64Url(new TextEncoder().encode(s));
}

function b64UrlToStr(s: string): string {
  return new TextDecoder().decode(b64UrlToBytes(s));
}

// --- HMAC --------------------------------------------------------------------

async function hmac(data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(requireSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return new Uint8Array(sig);
}

/** Comparaison de tableaux d'octets à temps constant. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    // On compare quand même une longueur fixe puis on renvoie false.
    let diff = 1;
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
    return diff === 0;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Génère un nonce aléatoire (hex). */
export function genNonce(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Signe un state : renvoie `<payloadB64Url>.<hmacB64Url>`.
 * `iat` est posé à maintenant si absent.
 */
export async function signState(
  payload: Omit<StatePayload, "iat"> & { iat?: number },
): Promise<string> {
  const full: StatePayload = {
    origin: payload.origin,
    nonce: payload.nonce,
    iat: payload.iat ?? Date.now(),
  };
  const p = strToB64Url(JSON.stringify(full));
  const sig = bytesToB64Url(await hmac(p));
  return `${p}.${sig}`;
}

/**
 * Vérifie un state signé. Lève une erreur si signature invalide, malformé, ou
 * TTL dépassé. Retourne le payload décodé sinon.
 */
export async function verifyState(token: string): Promise<StatePayload> {
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("state_malformed");
  const [p, sig] = parts;

  const expected = await hmac(p);
  const provided = b64UrlToBytes(sig);
  if (!timingSafeEqual(expected, provided)) throw new Error("state_bad_signature");

  let payload: StatePayload;
  try {
    payload = JSON.parse(b64UrlToStr(p));
  } catch {
    throw new Error("state_bad_payload");
  }

  if (!payload.origin || typeof payload.iat !== "number") {
    throw new Error("state_bad_payload");
  }
  if (Date.now() - payload.iat > STATE_TTL_MS) {
    throw new Error("state_expired");
  }
  return payload;
}
