// ============================================================================
// yt-connect/index.ts : une créatrice connecte (ou déconnecte) SA chaîne YouTube.
// ----------------------------------------------------------------------------
// POST { action: "start", origin } → { url } : page d'accord de Google (lecture
//   seule : chaîne, vidéos, statistiques YouTube Studio), avec un `state` signé
//   (anti-CSRF, 10 min) qui porte l'id de la créatrice ; Google renvoie ensuite vers
//   app.ttpcreators.pro/yt-callback/, qui passe la main à yt-callback.
// POST { action: "disconnect" } → retire l'accès chez Google, efface les jetons
//   (yt_accounts) et le lien affiché.
// L'agence peut agir pour une créatrice : { creator: "<nom>" }.
// AUTH : verify_jwt = true + rôle vérifié dans profiles (créatrice = elle-même ;
// agence = la créatrice nommée). Même schéma que tt-connect.
// ============================================================================

import { corsHeaders, getServiceClient } from "../_shared/google.ts";
import { genNonce, signState } from "../_shared/state.ts";
import { ytAuthorizeUrl, ytLoginReady, ytRevoke } from "../_shared/youtube-login.ts";

function allowedOrigin(raw: string): boolean {
  const allowed = (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  try {
    return allowed.includes(new URL(raw).origin);
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const res = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return res({ error: "methode" }, 405);

  const sb = getServiceClient();
  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  const { data: u } = bearer ? await sb.auth.getUser(bearer) : { data: null };
  const uid = u?.user?.id;
  if (!uid) return res({ error: "non_autorise" }, 401);
  const { data: prof } = await sb.from("profiles").select("role, creator_name").eq("user_id", uid).maybeSingle<{ role: string; creator_name: string | null }>();

  let body: { action?: string; origin?: string; creator?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return res({ error: "json" }, 400);
  }
  const name = prof?.role === "agency" ? String(body.creator ?? "").trim() : prof?.role === "creator" ? (prof.creator_name ?? "").trim() : "";
  if (!name) return res({ error: "non_autorise" }, 403);
  const { data: creator } = await sb.from("creators").select("id, name, yt").ilike("name", name).maybeSingle<{ id: string; name: string; yt: Record<string, unknown> | null }>();
  if (!creator) return res({ error: "createur_introuvable" }, 404);

  if (body.action === "disconnect") {
    const { data: acc } = await sb.from("yt_accounts").select("refresh_token").eq("creator_id", creator.id).maybeSingle<{ refresh_token: string }>();
    if (acc?.refresh_token) await ytRevoke(acc.refresh_token);
    await sb.from("yt_accounts").delete().eq("creator_id", creator.id);
    await sb.from("creators").update({ yt: { ...(creator.yt ?? {}), link: null } }).eq("id", creator.id);
    return res({ ok: true });
  }

  if (!ytLoginReady() || !Deno.env.get("STATE_SIGNING_SECRET")) return res({ error: "youtube_non_configure" });
  const origin = String(body.origin ?? "");
  if (!allowedOrigin(origin)) return res({ error: "origine_refusee" }, 400);
  const state = await signState({ origin, nonce: genNonce(), sub: creator.id });
  return res({ url: ytAuthorizeUrl(state) });
});
