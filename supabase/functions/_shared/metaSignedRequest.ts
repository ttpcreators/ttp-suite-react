// ============================================================================
// _shared/metaSignedRequest.ts : lecture PURE du `signed_request` que Meta envoie
// aux adresses « annulation d'autorisation » (ig-deauth) et « suppression des
// données » (ig-data-deletion) de l'app Instagram.
// ----------------------------------------------------------------------------
// Format de Meta : `<signature>.<payload>`, les deux en base64url sans « = ».
//   • payload = JSON { algorithm: "HMAC-SHA256", issued_at, user_id, … } ;
//   • signature = HMAC-SHA256(payload ENCODÉ, tel quel, clé = clé secrète de l'app).
// La signature est vérifiée AVANT de lire le JSON, et comparée en temps constant.
// Sans réseau ni API Deno (crypto.subtle et TextEncoder existent aussi dans Node) :
// testé par metaSignedRequest.test.ts avec un faux secret.
// ============================================================================

export type SignedRequestLu =
  | { ok: true; userId: string; issuedAt: number | null; payload: Record<string, unknown> }
  | { ok: false; raison: "secret_manquant" | "forme" | "signature" | "payload" | "algorithme" | "utilisateur" };

const B64URL = /^[A-Za-z0-9_-]+$/;

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Uint8Array {
  let b = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b.length % 4) b += "=";
  const bin = atob(b);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}
function memes(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** Vérifie et lit un signed_request de Meta. Ne lève jamais. */
export async function lireSignedRequest(secret: string, signedRequest: string | null | undefined): Promise<SignedRequestLu> {
  if (!secret) return { ok: false, raison: "secret_manquant" };
  const parts = String(signedRequest ?? "").trim().split(".");
  if (parts.length !== 2 || !B64URL.test(parts[0]) || !B64URL.test(parts[1])) return { ok: false, raison: "forme" };
  const [sigPart, payloadPart] = parts;
  let sig: Uint8Array;
  try {
    sig = b64urlDecode(sigPart);
  } catch {
    return { ok: false, raison: "forme" };
  }
  if (!memes(await hmac(secret, payloadPart), sig)) return { ok: false, raison: "signature" };
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b64urlDecode(payloadPart)));
  } catch {
    return { ok: false, raison: "payload" };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, raison: "payload" };
  const p = payload as Record<string, unknown>;
  if (String(p.algorithm ?? "").toUpperCase() !== "HMAC-SHA256") return { ok: false, raison: "algorithme" };
  const userId = typeof p.user_id === "string" || typeof p.user_id === "number" ? String(p.user_id).trim() : "";
  if (!/^\d{1,30}$/.test(userId)) return { ok: false, raison: "utilisateur" };
  return { ok: true, userId, issuedAt: typeof p.issued_at === "number" ? p.issued_at : null, payload: p };
}

/** Fabrique un signed_request comme Meta (tests, essais à la main). */
export async function signerSignedRequest(secret: string, payload: Record<string, unknown>): Promise<string> {
  const p = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  return `${b64urlEncode(await hmac(secret, p))}.${p}`;
}

/** Lit `signed_request` dans le corps d'un POST (formulaire, ou JSON par précaution). */
export function signedRequestDuCorps(body: string, contentType = ""): string | null {
  const t = body.trim();
  if (!t) return null;
  if (contentType.includes("json") || t.startsWith("{")) {
    try {
      const j = JSON.parse(t) as { signed_request?: unknown };
      return typeof j?.signed_request === "string" ? j.signed_request : null;
    } catch {
      return null;
    }
  }
  return new URLSearchParams(t).get("signed_request");
}
