// ============================================================================
// yt-callback/index.ts : retour de Google après l'accord de la créatrice.
// ----------------------------------------------------------------------------
// Google renvoie le navigateur sur app.ttpcreators.pro/yt-callback/?code=…&state=…
// (ou ?error=…), page qui transmet tel quel ici.
//   1. verifyState(state) → { origin, sub = id de la créatrice } (anti-CSRF).
//   2. code → jetons (accès 1 h + renouvellement), rangés dans yt_accounts (jamais
//      lisibles depuis l'app) ; creators.yt.link = { channel, title, handle, at }.
//   3. Première lecture de ses chiffres (yt-sync, en arrière-plan).
//   4. 302 → <origin>?youtube=connected|error|nochannel|scopes (origine re-validée).
// AUTH : verify_jwt = false (redirection du navigateur) ; authenticité = state signé.
// ============================================================================

import { CRON_SECRET, getServiceClient, waitUntil } from "../_shared/google.ts";
import { verifyState } from "../_shared/state.ts";
import { ytExchangeCode, ytMyChannel } from "../_shared/youtube-login.ts";

function safeRedirect(rawOrigin: string, status: string): string | null {
  const allowed = (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  try {
    const u = new URL(rawOrigin);
    if (!allowed.includes(u.origin)) return null;
    u.searchParams.set("youtube", status);
    return u.toString();
  } catch {
    return null;
  }
}

const page = (msg: string, status = 400) =>
  new Response(`<!doctype html><meta charset="utf-8"><title>YouTube</title><p style="font-family:system-ui;padding:24px">${msg}</p>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  let payload;
  try {
    payload = await verifyState(url.searchParams.get("state") ?? "");
  } catch {
    return page("Lien expiré ou invalide. Retourne dans l'app TTP et relance « Connecter mon YouTube ».");
  }
  const back = (s: string) => safeRedirect(payload.origin, s);
  const fail = back("error");
  if (!fail || !payload.sub) return page("Origine de retour non autorisée.");

  const code = url.searchParams.get("code");
  if (!code) return Response.redirect(fail, 302); // refus de la créatrice ou erreur Google

  const r = await ytExchangeCode(code);
  if ("error" in r) {
    console.error("yt-callback échange", r.error);
    return Response.redirect(fail, 302);
  }
  // Les deux cases cochées ? (Google laisse décocher une autorisation.)
  if (!/youtube\.readonly/.test(r.scopes) || !/yt-analytics\.readonly/.test(r.scopes)) return Response.redirect(back("scopes") ?? fail, 302);
  if (!r.refresh) {
    console.error("yt-callback : pas de jeton de renouvellement");
    return Response.redirect(fail, 302);
  }
  const ch = await ytMyChannel(r.token);
  if ("error" in ch) return Response.redirect(back(ch.error === "pas_de_chaine" ? "nochannel" : "error") ?? fail, 302);

  const sb = getServiceClient();
  const now = Date.now();
  const { error } = await sb.from("yt_accounts").upsert({
    creator_id: payload.sub, channel_id: ch.id, title: ch.title, token: r.token,
    expires_at: new Date(now + r.expiresIn * 1000).toISOString(), refresh_token: r.refresh,
    scopes: r.scopes, connected_at: new Date(now).toISOString(), refreshed_at: new Date(now).toISOString(),
  });
  if (error) {
    console.error("yt-callback stockage", error.message);
    return Response.redirect(fail, 302);
  }
  const { data: c } = await sb.from("creators").select("yt").eq("id", payload.sub).maybeSingle<{ yt: Record<string, unknown> | null }>();
  await sb.from("creators").update({
    yt: { ...(c?.yt ?? {}), link: { channel: ch.id, title: ch.title, handle: ch.handle || null, at: new Date(now).toISOString() } },
  }).eq("id", payload.sub);

  waitUntil(
    fetch("https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/yt-sync", {
      method: "POST",
      headers: { Authorization: `Bearer ${CRON_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "creator", id: payload.sub }),
    }),
  );
  return Response.redirect(back("connected") ?? fail, 302);
});
