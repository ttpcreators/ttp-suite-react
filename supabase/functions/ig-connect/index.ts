// ============================================================================
// ig-connect/index.ts : une créatrice connecte (ou déconnecte) SON Instagram.
// ----------------------------------------------------------------------------
// POST { action: "start", origin } → { url } : page d'accord d'Instagram, avec un
//   `state` signé (anti-CSRF, 10 min) qui porte l'id de la créatrice ; Instagram
//   renvoie ensuite vers ig-callback.
// POST { action: "disconnect" } → efface le jeton (table ig_accounts) et le lien.
// L'agence peut agir pour une créatrice : ajouter { creator: "<nom>" } (utile si
// la créatrice est à côté et se connecte sur l'ordinateur de l'agence).
//
// AUTH : verify_jwt = true + rôle vérifié dans profiles (créatrice = elle-même ;
// agence = la créatrice nommée).
// ============================================================================

import { corsHeaders, getServiceClient } from "../_shared/google.ts";
import { genNonce, signState } from "../_shared/state.ts";
import { authorizeUrl, loginReady } from "../_shared/instagram-login.ts";
import { publicFeed } from "../_shared/igFeed.ts";

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
  const res = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return res({ error: "methode" }, 405);

  const sb = getServiceClient();
  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  const { data: u } = bearer ? await sb.auth.getUser(bearer) : { data: null };
  const uid = u?.user?.id;
  if (!uid) return res({ error: "non_autorise" }, 401);
  const { data: prof } = await sb.from("profiles").select("role, creator_name").eq("user_id", uid)
    .maybeSingle<{ role: string; creator_name: string | null }>();

  let body: { action?: string; origin?: string; creator?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return res({ error: "json" }, 400);
  }
  // Pour qui : la créatrice connectée, ou celle que l'agence nomme.
  const name = prof?.role === "agency" ? String(body.creator ?? "").trim() : prof?.role === "creator" ? (prof.creator_name ?? "").trim() : "";
  if (!name) return res({ error: "non_autorise" }, 403);
  const { data: creator } = await sb.from("creators").select("id, name, ig").ilike("name", name).maybeSingle<{ id: string; name: string; ig: Record<string, unknown> | null }>();
  if (!creator) return res({ error: "createur_introuvable" }, 404);

  if (body.action === "disconnect") {
    await sb.from("ig_accounts").delete().eq("creator_id", creator.id);
    // Chiffres privés effacés, y compris ceux de chaque post du feed (« Mes stats »).
    const ig = { ...(creator.ig ?? {}), link: null, insights: null, insightsWhy: null, feed: publicFeed(creator.ig?.feed) };
    await sb.from("creators").update({ ig }).eq("id", creator.id);
    return res({ ok: true });
  }

  if (!loginReady() || !Deno.env.get("STATE_SIGNING_SECRET")) return res({ error: "instagram_login_non_configure" });
  const origin = String(body.origin ?? "");
  if (!allowedOrigin(origin)) return res({ error: "origine_refusee" }, 400);
  const state = await signState({ origin, nonce: genNonce(), sub: creator.id });
  return res({ url: authorizeUrl(state) });
});
