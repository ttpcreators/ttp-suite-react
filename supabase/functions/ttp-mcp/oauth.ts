// ============================================================================
// ttp-mcp/oauth.ts : connexion de Claude à TTP Suite (OAuth 2.1 + PKCE S256).
// ----------------------------------------------------------------------------
//   • Claude s'enregistre tout seul (/register, enregistrement dynamique RFC 7591),
//     uniquement avec des adresses de retour Claude (claude.ai / claude.com) ou locales
//     (Claude Code sur l'ordinateur).
//   • La page « Autoriser Claude » (app.ttpcreators.pro/connecteur/) envoie le compte
//     TTP Suite connecté (/authorize/approve) : on crée une connexion (mcp_grants) et un
//     code à usage unique (10 min).
//   • /token échange le code (vérification PKCE) contre un jeton d'accès (1 h) et un
//     jeton de renouvellement (60 j, remplacé à chaque usage). Tout est stocké haché.
//   • Une connexion coupée dans Paramètres (revoked_at) invalide tous ses jetons.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const FN_URL = "https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ttp-mcp";
export const ISSUER = "https://app.ttpcreators.pro";
export const AUTHORIZE_URL = `${ISSUER}/connecteur/`;
const ACCESS_TTL = 3600; // s
const REFRESH_TTL = 60 * 86400; // s
const CODE_TTL = 10 * 60; // s

export type Ctx = { userId: string; grantId: string; founder: boolean; name: string };

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export async function sha256hex(s: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function sha256b64url(s: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))));
}
const randomToken = (prefix: string) => prefix + b64url(crypto.getRandomValues(new Uint8Array(32)));
const inSeconds = (s: number) => new Date(Date.now() + s * 1000).toISOString();

/** Adresses de retour acceptées : Claude (web, ordinateur, téléphone) et Claude Code en local. */
export function allowedRedirect(u: string): boolean {
  try {
    const x = new URL(u);
    if (x.protocol === "https:" && ["claude.ai", "claude.com", "www.claude.ai", "www.claude.com"].includes(x.hostname)) return true;
    if (x.protocol === "http:" && ["localhost", "127.0.0.1"].includes(x.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

export function asMetadata() {
  return {
    issuer: ISSUER,
    authorization_endpoint: AUTHORIZE_URL,
    token_endpoint: `${FN_URL}/token`,
    registration_endpoint: `${FN_URL}/register`,
    revocation_endpoint: `${FN_URL}/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: ["ttp"],
    service_documentation: `${ISSUER}/`,
  };
}

export function resourceMetadata() {
  return {
    resource: FN_URL,
    authorization_servers: [ISSUER],
    scopes_supported: ["ttp"],
    bearer_methods_supported: ["header"],
    resource_name: "TTP Suite",
  };
}

type Json = Record<string, unknown>;
type Out = { status: number; body: Json };
const oauthErr = (error: string, description: string, status = 400): Out => ({ status, body: { error, error_description: description } });

// ── Enregistrement dynamique ────────────────────────────────────────────────
export async function register(sb: SupabaseClient, body: Json): Promise<Out> {
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!uris.length || uris.length > 10 || !uris.every(allowedRedirect)) {
    return oauthErr("invalid_redirect_uri", "Adresse de retour non autorisée (Claude uniquement).");
  }
  const { count } = await sb.from("mcp_clients").select("client_id", { count: "exact", head: true });
  if ((count ?? 0) > 1000) return oauthErr("temporarily_unavailable", "Trop d'enregistrements.", 429);
  const method = ["client_secret_post", "client_secret_basic"].includes(String(body.token_endpoint_auth_method)) ? String(body.token_endpoint_auth_method) : "none";
  const clientId = "ttpc_" + b64url(crypto.getRandomValues(new Uint8Array(16)));
  const secret = method === "none" ? null : randomToken("ttps_");
  const name = String(body.client_name ?? "Claude").slice(0, 80);
  const { error } = await sb.from("mcp_clients").insert({ client_id: clientId, client_name: name, redirect_uris: uris, secret_hash: secret ? await sha256hex(secret) : null });
  if (error) return oauthErr("server_error", "Enregistrement impossible.", 500);
  return {
    status: 201,
    body: {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: method,
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    },
  };
}

type ClientRow = { client_id: string; client_name: string | null; redirect_uris: string[]; secret_hash: string | null };
async function clientOf(sb: SupabaseClient, id: string): Promise<ClientRow | null> {
  if (!id) return null;
  const { data } = await sb.from("mcp_clients").select("client_id, client_name, redirect_uris, secret_hash").eq("client_id", id).maybeSingle<ClientRow>();
  return data ?? null;
}

/** Page « Autoriser » : le client et son adresse de retour sont-ils valides ? */
export async function check(sb: SupabaseClient, body: Json): Promise<Out> {
  const c = await clientOf(sb, String(body.client_id ?? ""));
  if (!c) return oauthErr("invalid_client", "Connexion inconnue : relance la connexion depuis Claude.");
  if (!c.redirect_uris.includes(String(body.redirect_uri ?? ""))) return oauthErr("invalid_request", "Adresse de retour inattendue.");
  return { status: 200, body: { ok: true, client_name: c.client_name ?? "Claude" } };
}

/** Accord donné par un compte agence connecté (jeton de session Supabase). */
export async function approve(sb: SupabaseClient, jwt: string, body: Json): Promise<Out> {
  const { data: u, error: ue } = await sb.auth.getUser(jwt);
  if (ue || !u?.user) return oauthErr("access_denied", "Session expirée : reconnecte-toi.", 401);
  const { data: prof } = await sb.from("profiles").select("role").eq("user_id", u.user.id).maybeSingle<{ role: string }>();
  if (prof?.role !== "agency") return oauthErr("access_denied", "Réservé aux comptes de l'agence.", 403);
  const c = await clientOf(sb, String(body.client_id ?? ""));
  const redirect = String(body.redirect_uri ?? "");
  if (!c) return oauthErr("invalid_client", "Connexion inconnue : relance la connexion depuis Claude.");
  if (!c.redirect_uris.includes(redirect)) return oauthErr("invalid_request", "Adresse de retour inattendue.");
  const challenge = String(body.code_challenge ?? "");
  if (String(body.code_challenge_method ?? "") !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) {
    return oauthErr("invalid_request", "PKCE S256 obligatoire.");
  }
  const { data: grant, error: ge } = await sb.from("mcp_grants").insert({ user_id: u.user.id, client_id: c.client_id, client_name: c.client_name ?? "Claude" }).select("id").single<{ id: string }>();
  if (ge || !grant) return oauthErr("server_error", "Connexion impossible, réessaie.", 500);
  const code = randomToken("ttpcode_");
  const { error: ce } = await sb.from("mcp_codes").insert({
    code_hash: await sha256hex(code), grant_id: grant.id, client_id: c.client_id, redirect_uri: redirect, code_challenge: challenge, expires_at: inSeconds(CODE_TTL),
  });
  if (ce) return oauthErr("server_error", "Connexion impossible, réessaie.", 500);
  const url = new URL(redirect);
  url.searchParams.set("code", code);
  if (body.state) url.searchParams.set("state", String(body.state));
  url.searchParams.set("iss", ISSUER);
  return { status: 200, body: { redirect: url.toString() } };
}

async function issue(sb: SupabaseClient, grantId: string, clientId: string): Promise<Json> {
  const access = randomToken("ttp_at_");
  const refresh = randomToken("ttp_rt_");
  await sb.from("mcp_tokens").insert([
    { token_hash: await sha256hex(access), kind: "access", grant_id: grantId, client_id: clientId, expires_at: inSeconds(ACCESS_TTL) },
    { token_hash: await sha256hex(refresh), kind: "refresh", grant_id: grantId, client_id: clientId, expires_at: inSeconds(REFRESH_TTL) },
  ]);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL, refresh_token: refresh, scope: "ttp" };
}

async function grantAlive(sb: SupabaseClient, grantId: string): Promise<boolean> {
  const { data } = await sb.from("mcp_grants").select("revoked_at").eq("id", grantId).maybeSingle<{ revoked_at: string | null }>();
  return !!data && !data.revoked_at;
}

/** /token : code d'autorisation (PKCE) ou renouvellement (avec rotation). */
export async function token(sb: SupabaseClient, form: URLSearchParams, basic: string | null): Promise<Out> {
  let clientId = form.get("client_id") ?? "";
  let secret = form.get("client_secret") ?? "";
  if (basic) {
    try {
      const [id, s] = atob(basic).split(":");
      clientId = decodeURIComponent(id ?? "");
      secret = decodeURIComponent(s ?? "");
    } catch {
      return oauthErr("invalid_client", "Identification illisible.", 401);
    }
  }
  const c = await clientOf(sb, clientId);
  if (!c) return oauthErr("invalid_client", "Client inconnu.", 401);
  if (c.secret_hash && (!secret || (await sha256hex(secret)) !== c.secret_hash)) return oauthErr("invalid_client", "Secret invalide.", 401);

  const grantType = form.get("grant_type");
  if (grantType === "authorization_code") {
    const code = form.get("code") ?? "";
    const verifier = form.get("code_verifier") ?? "";
    // Marque le code utilisé en une seule instruction : un même code ne sert jamais deux fois.
    const { data: rows } = await sb.from("mcp_codes").update({ used_at: new Date().toISOString() })
      .eq("code_hash", await sha256hex(code)).is("used_at", null).gt("expires_at", new Date().toISOString())
      .select("grant_id, client_id, redirect_uri, code_challenge");
    const row = (rows as { grant_id: string; client_id: string; redirect_uri: string; code_challenge: string }[] | null)?.[0];
    if (!row || row.client_id !== c.client_id) return oauthErr("invalid_grant", "Code invalide ou expiré.");
    if (form.get("redirect_uri") && form.get("redirect_uri") !== row.redirect_uri) return oauthErr("invalid_grant", "Adresse de retour différente.");
    if (!verifier || (await sha256b64url(verifier)) !== row.code_challenge) return oauthErr("invalid_grant", "Vérification PKCE échouée.");
    if (!(await grantAlive(sb, row.grant_id))) return oauthErr("invalid_grant", "Connexion coupée.");
    return { status: 200, body: await issue(sb, row.grant_id, c.client_id) };
  }
  if (grantType === "refresh_token") {
    const rt = form.get("refresh_token") ?? "";
    const { data: rows } = await sb.from("mcp_tokens").update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", await sha256hex(rt)).eq("kind", "refresh").is("revoked_at", null).gt("expires_at", new Date().toISOString())
      .select("grant_id, client_id");
    const row = (rows as { grant_id: string; client_id: string }[] | null)?.[0];
    if (!row || row.client_id !== c.client_id) return oauthErr("invalid_grant", "Jeton de renouvellement invalide.");
    if (!(await grantAlive(sb, row.grant_id))) return oauthErr("invalid_grant", "Connexion coupée.");
    return { status: 200, body: await issue(sb, row.grant_id, c.client_id) };
  }
  return oauthErr("unsupported_grant_type", "Type de demande non pris en charge.");
}

/** /revoke : coupe le jeton donné (et toute sa connexion). */
export async function revoke(sb: SupabaseClient, form: URLSearchParams): Promise<Out> {
  const t = form.get("token") ?? "";
  if (t) {
    const { data } = await sb.from("mcp_tokens").select("grant_id").eq("token_hash", await sha256hex(t)).maybeSingle<{ grant_id: string }>();
    if (data) await sb.from("mcp_grants").update({ revoked_at: new Date().toISOString() }).eq("id", data.grant_id);
  }
  return { status: 200, body: {} };
}

/** Jeton d'accès → compte agence (null = refusé). */
export async function authenticate(sb: SupabaseClient, bearer: string): Promise<Ctx | null> {
  if (!bearer.startsWith("ttp_at_")) return null;
  const { data: tok } = await sb.from("mcp_tokens").select("grant_id, expires_at, revoked_at")
    .eq("token_hash", await sha256hex(bearer)).eq("kind", "access").maybeSingle<{ grant_id: string; expires_at: string; revoked_at: string | null }>();
  if (!tok || tok.revoked_at || Date.parse(tok.expires_at) < Date.now()) return null;
  const { data: g } = await sb.from("mcp_grants").select("user_id, revoked_at, last_used_at").eq("id", tok.grant_id).maybeSingle<{ user_id: string; revoked_at: string | null; last_used_at: string | null }>();
  if (!g || g.revoked_at) return null;
  const { data: prof } = await sb.from("profiles").select("role, agency_role, display_name").eq("user_id", g.user_id).maybeSingle<{ role: string; agency_role: string | null; display_name: string | null }>();
  if (prof?.role !== "agency") return null;
  if (!g.last_used_at || Date.now() - Date.parse(g.last_used_at) > 5 * 60_000) {
    await sb.from("mcp_grants").update({ last_used_at: new Date().toISOString() }).eq("id", tok.grant_id);
  }
  return { userId: g.user_id, grantId: tok.grant_id, founder: prof.agency_role === "founder", name: prof.display_name ?? "" };
}
