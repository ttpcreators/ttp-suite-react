// ============================================================================
// ig-callback/index.ts : retour d'Instagram après l'accord de la créatrice.
// ----------------------------------------------------------------------------
// Instagram redirige le navigateur ici avec ?code=…&state=<signé>.
//   1. verifyState(state) → { origin, sub = id de la créatrice } (anti-CSRF).
//   2. code → jeton longue durée (60 j) + compte Instagram (_shared/instagram-login).
//   3. Jeton rangé dans ig_accounts (jamais lisible depuis l'app) ; creators.ig.link
//      = { username, at, expires } pour l'affichage « Instagram connecté ».
//   4. Première synchro de ses chiffres (ig-sync, en arrière-plan).
//   5. 302 → <origin>?instagram=connected|error (origine re-validée).
//
// AUTH : verify_jwt = false (redirection du navigateur, sans JWT) ; l'authenticité
// tient au state signé.
// ============================================================================

import { CRON_SECRET, getServiceClient, waitUntil } from "../_shared/google.ts";
import { verifyState } from "../_shared/state.ts";
import { exchangeCode, SCOPES } from "../_shared/instagram-login.ts";

function safeRedirect(rawOrigin: string, status: string): string | null {
  const allowed = (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  try {
    const u = new URL(rawOrigin);
    if (!allowed.includes(u.origin)) return null;
    u.searchParams.set("instagram", status);
    return u.toString();
  } catch {
    return null;
  }
}

const page = (msg: string, status = 400) =>
  new Response(`<!doctype html><meta charset="utf-8"><title>Instagram</title><p style="font-family:system-ui;padding:24px">${msg}</p>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  let payload;
  try {
    payload = await verifyState(url.searchParams.get("state") ?? "");
  } catch {
    return page("Lien expiré ou invalide. Retourne dans l'app TTP et relance « Connecter mon Instagram ».");
  }
  const fail = safeRedirect(payload.origin, "error");
  const ok = safeRedirect(payload.origin, "connected");
  if (!fail || !ok || !payload.sub) return page("Origine de retour non autorisée.");

  const code = url.searchParams.get("code");
  if (!code) return Response.redirect(fail, 302); // refus de la créatrice ou erreur Instagram

  const r = await exchangeCode(code.replace(/#_$/, ""));
  if ("error" in r) {
    console.error("ig-callback échange", r.error);
    return Response.redirect(fail, 302);
  }
  const sb = getServiceClient();
  const now = new Date();
  const expires = new Date(now.getTime() + r.expiresIn * 1000).toISOString();
  const { error } = await sb.from("ig_accounts").upsert({
    creator_id: payload.sub, ig_user_id: r.userId, username: r.username, token: r.token,
    expires_at: expires, scopes: SCOPES, connected_at: now.toISOString(), refreshed_at: now.toISOString(),
  });
  if (error) {
    console.error("ig-callback stockage", error.message);
    return Response.redirect(fail, 302);
  }
  const { data: c } = await sb.from("creators").select("ig").eq("id", payload.sub).maybeSingle<{ ig: Record<string, unknown> | null }>();
  await sb.from("creators").update({ ig: { ...(c?.ig ?? {}), link: { username: r.username, at: now.toISOString(), expires } } }).eq("id", payload.sub);

  // Ses chiffres tout de suite, sans attendre le passage de la nuit.
  waitUntil(
    fetch("https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ig-sync", {
      method: "POST",
      headers: { Authorization: `Bearer ${CRON_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "creator", id: payload.sub }),
    }),
  );
  return Response.redirect(ok, 302);
});
