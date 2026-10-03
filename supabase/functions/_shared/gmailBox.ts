// ============================================================================
// _shared/gmailBox.ts : accès aux DEUX boîtes Gmail de l'agence.
// ----------------------------------------------------------------------------
//   • "partnerships" : la connexion Google de l'app (OAuth, google_tokens) —
//     prospection, Agenda, envois historiques.
//   • "talent"       : talent@ via le COMPTE DE SERVICE (délégation de domaine),
//     secrets GMAIL_SA_KEY + GMAIL_IMPERSONATE. Lecture = gmail.readonly ;
//     envoi = gmail.send ; corbeille = gmail.modify (chacun doit être autorisé
//     dans admin.google.com).
// Les jetons ne quittent jamais le serveur.
// ============================================================================

import { getAccessToken, getServiceClient } from "./google.ts";

export type Box = "partnerships" | "talent";
export const BOXES: Box[] = ["partnerships", "talent"];

const SCOPE = {
  read: "https://www.googleapis.com/auth/gmail.readonly",
  send: "https://www.googleapis.com/auth/gmail.send",
  // Corbeille (gmail-trash). Pas de suppression définitive : celle-ci exigerait le droit complet.
  modify: "https://www.googleapis.com/auth/gmail.modify",
} as const;

/** Adresse de la boîte talent@ (compte de service), "" si non configurée. */
export function talentAddress(): string {
  return Deno.env.get("GMAIL_SA_KEY") ? (Deno.env.get("GMAIL_IMPERSONATE") ?? "").trim().toLowerCase() : "";
}

/** Boîte valide demandée par le client (défaut : partnerships). */
export function parseBox(v: unknown): Box {
  return v === "talent" ? "talent" : "partnerships";
}

const saCache = new Map<string, { token: string; exp: number }>();

function b64url(bytes: Uint8Array | string): string {
  const bin = typeof bytes === "string" ? bytes : String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Jeton du compte de service pour `subject`, limité à `scope` (JWT RS256). */
export async function serviceAccountToken(scope: string): Promise<string> {
  const rawKey = Deno.env.get("GMAIL_SA_KEY");
  const subject = Deno.env.get("GMAIL_IMPERSONATE");
  if (!rawKey || !subject) throw new Error("talent_non_configure");
  const hit = saCache.get(scope);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const key = JSON.parse(rawKey) as { client_email: string; private_key: string };
  const pem = key.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const unsigned =
    b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." +
    b64url(JSON.stringify({
      iss: key.client_email, sub: subject, aud: "https://oauth2.googleapis.com/token",
      scope, iat: now, exp: now + 3600,
    }));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(unsigned)));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${b64url(sig)}`,
    }),
  });
  const d = await r.json().catch(() => ({}));
  // unauthorized_client = ce champ d'application n'est pas autorisé dans admin.google.com.
  if (!r.ok || !d.access_token) throw new Error(d.error === "unauthorized_client" ? "talent_droit_manquant" : "talent_jeton_echoue");
  saCache.set(scope, { token: d.access_token, exp: Date.now() + Number(d.expires_in ?? 3600) * 1000 });
  return d.access_token;
}

/** Jeton Gmail pour une boîte, en lecture, en envoi ou pour la corbeille. */
export function boxToken(sb: ReturnType<typeof getServiceClient>, box: Box, mode: "read" | "send" | "modify"): Promise<string> {
  if (box === "talent") return serviceAccountToken(SCOPE[mode]);
  return getAccessToken(sb);
}

/** Message d'erreur lisible pour l'app selon la cause. */
export function boxError(e: unknown): { error: string; status: number } {
  const msg = (e as Error)?.message ?? "";
  if (msg === "not_connected" || msg === "invalid_grant") return { error: "google_non_connecte", status: 409 };
  if (msg === "talent_non_configure") return { error: "talent_non_configure", status: 409 };
  if (msg === "talent_droit_manquant") return { error: "talent_droit_manquant", status: 403 };
  return { error: "token_indisponible", status: 502 };
}
