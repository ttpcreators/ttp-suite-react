// ============================================================================
// tt-callback/index.ts : retour de TikTok après l'accord de la créatrice.
// ----------------------------------------------------------------------------
// TikTok redirige le navigateur ici avec ?code=…&state=<signé> (ou ?error=…).
//   1. verifyState(state) → { origin, sub = id de la créatrice } (anti-CSRF).
//   2. code → jetons (accès 24 h + renouvellement 365 j), rangés dans tt_accounts
//      (jamais lisibles depuis l'app) ; creators.tt.link = { username, at }.
//   3. Première lecture de ses chiffres (tt-sync, en arrière-plan).
//   4. 302 → <origin>?tiktok=connected|error (origine re-validée).
// AUTH : verify_jwt = false (redirection du navigateur) ; authenticité = state signé.
// ============================================================================

import { CRON_SECRET, getServiceClient, waitUntil } from "../_shared/google.ts";
import { verifyState } from "../_shared/state.ts";
import { ttExchangeCode, ttUser } from "../_shared/tiktok.ts";

function safeRedirect(rawOrigin: string, status: string): string | null {
  const allowed = (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  try {
    const u = new URL(rawOrigin);
    if (!allowed.includes(u.origin)) return null;
    u.searchParams.set("tiktok", status);
    return u.toString();
  } catch {
    return null;
  }
}

const page = (msg: string, status = 400) =>
  new Response(`<!doctype html><meta charset="utf-8"><title>TikTok</title><p style="font-family:system-ui;padding:24px">${msg}</p>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  let payload;
  try {
    payload = await verifyState(url.searchParams.get("state") ?? "");
  } catch {
    return page("Lien expiré ou invalide. Retourne dans l'app TTP et relance « Connecter mon TikTok ».");
  }
  const fail = safeRedirect(payload.origin, "error");
  const ok = safeRedirect(payload.origin, "connected");
  if (!fail || !ok || !payload.sub) return page("Origine de retour non autorisée.");

  const code = url.searchParams.get("code");
  if (!code) return Response.redirect(fail, 302); // refus de la créatrice ou erreur TikTok

  const r = await ttExchangeCode(code);
  if ("error" in r) {
    console.error("tt-callback échange", r.error);
    return Response.redirect(fail, 302);
  }
  const sb = getServiceClient();
  const now = Date.now();
  const me = await ttUser(r.token);
  const username = "error" in me ? null : me.username || null;
  const { error } = await sb.from("tt_accounts").upsert({
    creator_id: payload.sub, open_id: r.openId, username, token: r.token,
    expires_at: new Date(now + r.expiresIn * 1000).toISOString(), refresh_token: r.refresh || null,
    refresh_expires_at: r.refreshExpiresIn ? new Date(now + r.refreshExpiresIn * 1000).toISOString() : null,
    scopes: r.scopes, connected_at: new Date(now).toISOString(), refreshed_at: new Date(now).toISOString(),
  });
  if (error) {
    console.error("tt-callback stockage", error.message);
    return Response.redirect(fail, 302);
  }
  const { data: c } = await sb.from("creators").select("tt").eq("id", payload.sub).maybeSingle<{ tt: Record<string, unknown> | null }>();
  await sb.from("creators").update({ tt: { ...(c?.tt ?? {}), link: { username, at: new Date(now).toISOString(), scopes: r.scopes } } }).eq("id", payload.sub);

  waitUntil(
    fetch("https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/tt-sync", {
      method: "POST",
      headers: { Authorization: `Bearer ${CRON_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "creator", id: payload.sub }),
    }),
  );
  return Response.redirect(ok, 302);
});
