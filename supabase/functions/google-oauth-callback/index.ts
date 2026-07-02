// ============================================================================
// google-oauth-callback/index.ts
// ----------------------------------------------------------------------------
// Callback OAuth 2.0 Google Calendar (Option C). Google redirige le navigateur
// ici avec ?code=...&state=<signé HMAC>.
//
//   1. verifyState(state) — anti-CSRF (HMAC-SHA256, TTL 10 min) -> { origin }.
//   2. Échange authorization_code -> {access_token, refresh_token, id_token, ...}.
//   3. Décode l'id_token -> { sub, email }.
//   4. upsert google_tokens (id=1) via service-role. refresh_token JAMAIS écrasé
//      par null (Google ne le renvoie qu'au 1er consentement / prompt=consent).
//   5. Sync full initial (runSyncCycle) + création du watch (gcalWatch) — best
//      effort : un échec ne casse pas la connexion (fallback polling).
//   6. 302 -> <origin>?google=connected  (origine re-validée : anti open-redirect).
//
// AUTH : config.toml -> verify_jwt = false (redirect navigateur GET, pas de JWT ;
// l'authenticité tient au state signé).
// ============================================================================

import {
  gcalWatch,
  getServiceClient,
  runSyncCycle,
  waitUntil,
} from "../_shared/google.ts";
import { verifyState } from "../_shared/state.ts";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const WATCH_TTL_SECONDS = 604_800;

function getAllowedOrigins(): string[] {
  return (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "")
    .split(",").map((o) => o.trim()).filter(Boolean);
}

/** Reconstruit une URL de retour sûre (origine whitelistée + ?google=status). */
function buildSafeRedirect(rawOrigin: string, status: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawOrigin);
  } catch {
    return null;
  }
  if (!getAllowedOrigins().includes(parsed.origin)) return null;
  parsed.searchParams.set("google", status);
  return parsed.toString();
}

/** Décode le payload d'un id_token (JWT) sans vérif de signature (canal TLS Google). */
function decodeIdToken(idToken: string): { sub?: string; email?: string } {
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) return {};
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    const jsonStr = new TextDecoder().decode(
      Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
    );
    const claims = JSON.parse(jsonStr);
    return { sub: claims.sub, email: claims.email };
  } catch {
    return {};
  }
}

function htmlError(message: string, status: number): Response {
  const body = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Connexion Google — erreur</title></head>
<body style="font-family:system-ui,sans-serif;padding:2rem;max-width:40rem;margin:auto">
<h1>Échec de la connexion Google Agenda</h1>
<p>${message}</p>
<p>Vous pouvez fermer cette fenêtre et réessayer depuis l'application.</p>
</body></html>`;
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "GET") return htmlError("Méthode non autorisée.", 405);

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) return htmlError(`Autorisation Google refusée (${oauthError}).`, 400);
  if (!code || !state) return htmlError("Paramètres OAuth manquants (code ou state).", 400);

  // 1. Vérification du state (anti-CSRF, HMAC).
  let origin: string;
  try {
    const payload = await verifyState(state);
    origin = payload.origin;
    if (!origin) throw new Error("origin manquante");
  } catch {
    return htmlError(
      "Jeton de sécurité (state) invalide ou expiré. Relancez la connexion depuis l'application.",
      400,
    );
  }

  const successRedirect = buildSafeRedirect(origin, "connected");
  if (!successRedirect) {
    return htmlError("Origine de redirection non autorisée (APP_ALLOWED_ORIGINS).", 400);
  }
  const errorRedirect = buildSafeRedirect(origin, "error")!;

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const redirectUri = Deno.env.get("GOOGLE_REDIRECT_URI");
  if (!clientId || !clientSecret || !redirectUri) {
    return Response.redirect(errorRedirect, 302);
  }

  const sb = getServiceClient();

  try {
    // 2. Échange authorization_code -> tokens.
    const tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri, grant_type: "authorization_code",
      }),
    });
    const tokenJson = await tokenRes.json().catch(() => ({}));

    if (!tokenRes.ok) {
      await sb.from("google_tokens").upsert(
        { id: 1, connected: false, last_error: `token_exchange_failed:${tokenJson?.error ?? tokenRes.status}` },
        { onConflict: "id" },
      );
      return Response.redirect(errorRedirect, 302);
    }

    const { access_token, refresh_token, expires_in, id_token, scope, token_type } = tokenJson as {
      access_token?: string; refresh_token?: string; expires_in?: number;
      id_token?: string; scope?: string; token_type?: string;
    };

    if (!access_token) {
      await sb.from("google_tokens").upsert(
        { id: 1, connected: false, last_error: "no_access_token" }, { onConflict: "id" });
      return Response.redirect(errorRedirect, 302);
    }

    const { sub, email } = id_token ? decodeIdToken(id_token) : {};
    const expiresAt = new Date(Date.now() + (expires_in ?? 3600) * 1000).toISOString();

    // 4. Stockage. refresh_token ajouté SEULEMENT s'il est présent (jamais null).
    const upd: Record<string, unknown> = {
      id: 1, access_token, token_type: token_type ?? "Bearer",
      scope: scope ?? null, expires_at: expiresAt,
      google_sub: sub ?? null, google_email: email ?? null,
      connected: true, last_error: null,
    };
    if (refresh_token) upd.refresh_token = refresh_token;

    const { error: upsertErr } = await sb.from("google_tokens").upsert(upd, { onConflict: "id" });
    if (upsertErr) {
      await sb.from("google_tokens").upsert(
        { id: 1, connected: false, last_error: `db_upsert:${upsertErr.message}` }, { onConflict: "id" });
      return Response.redirect(errorRedirect, 302);
    }

    // Vérif défensive : un refresh_token doit exister (frais ou préexistant).
    const { data: tokRow } = await sb
      .from("google_tokens").select("refresh_token").eq("id", 1).single();
    if (!tokRow?.refresh_token) {
      await sb.from("google_tokens").upsert(
        { id: 1, connected: false, last_error: "no_refresh_token" }, { onConflict: "id" });
      return Response.redirect(errorRedirect, 302);
    }

    // 5. Best effort : watch d'abord (initialise le channel), puis sync full inline.
    //    On tente le watch ; s'il échoue (domaine non vérifié), on reste en polling.
    try {
      await gcalWatch(sb, WATCH_TTL_SECONDS);
    } catch (e) {
      console.warn("google-oauth-callback: watch échoué (fallback polling)", e);
      await sb.from("google_tokens").update({ last_error: "watch_setup_failed" }).eq("id", 1);
    }

    // Sync full initial (survit à la réponse via waitUntil).
    waitUntil(runSyncCycle(sb, "full").catch((e) => console.error("initial sync failed", e)));

    // 6. Succès.
    return Response.redirect(successRedirect, 302);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("google_tokens").upsert(
      { id: 1, connected: false, last_error: `callback_exception:${msg}` }, { onConflict: "id" },
    ).then(() => {}, () => {});
    return Response.redirect(errorRedirect, 302);
  }
});
