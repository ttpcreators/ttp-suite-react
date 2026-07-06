// ============================================================================
// google-connect-url/index.ts
// ----------------------------------------------------------------------------
// Construit l'URL d'autorisation Google avec un `state` signé HMAC (anti-CSRF).
// Le front l'appelle (JWT agence) puis redirige le navigateur vers l'URL reçue.
//
// AUTH (config.toml -> verify_jwt = true) : la plateforme valide le JWT ; on
// exige EN PLUS le rôle agence. Transport : POST { origin } (les GET ne portent
// pas de body de façon fiable via functions.invoke).
//
// L'origine fournie est validée contre APP_ALLOWED_ORIGINS avant d'être encodée
// dans le state signé.
// ============================================================================

import { corsHeaders, getServiceClient } from "../_shared/google.ts";
import { genNonce, signState } from "../_shared/state.ts";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

function getAllowedOrigins(): string[] {
  return (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "")
    .split(",").map((o) => o.trim()).filter(Boolean);
}

/** origin fourni = window.location.origin + BASE_URL ; on valide l'ORIGINE. */
function isAllowedOrigin(raw: string): boolean {
  try {
    return getAllowedOrigins().includes(new URL(raw).origin);
  } catch {
    return false;
  }
}

async function requireAgency(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return false;
  const sb = getServiceClient();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return false;
  const { data: prof, error: profErr } = await sb
    .from("profiles").select("role").eq("user_id", data.user.id).maybeSingle<{ role: string }>();
  if (profErr || !prof) return false; // fail-closed : profil absent/illisible → refus
  return prof.role === "agency";
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin);
  const jsonRes = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);

  if (!(await requireAgency(req))) return jsonRes({ error: "unauthorized" }, 401);

  let appOrigin = "";
  try {
    const body = await req.json();
    appOrigin = String(body?.origin ?? "");
  } catch {
    return jsonRes({ error: "bad_request" }, 400);
  }
  if (!isAllowedOrigin(appOrigin)) return jsonRes({ error: "origin_not_allowed" }, 400);

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const redirectUri = Deno.env.get("GOOGLE_REDIRECT_URI");
  if (!clientId || !redirectUri) return jsonRes({ error: "server_misconfigured" }, 500);

  const state = await signState({ origin: appOrigin, nonce: genNonce() });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });

  return jsonRes({ url: `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}` }, 200);
});
