// ============================================================================
// ig-hashtag/index.ts : recherche de posts Instagram par hashtag (Scouting).
// ----------------------------------------------------------------------------
// POST { tag, kind?: "top" | "recent" } → { posts } ou { why }.
// Meilleurs posts (« top ») ou posts des dernières 24 h (« recent ») d'un hashtag.
// Meta ne donne pas l'auteur : chaque post a son lien, l'agence l'ouvre.
// Demande la fonction « Instagram Public Content Access » validée par Meta (App
// Review) ; avant, la réponse est { why: "meta_autorisation" }.
// Limite Meta : 30 hashtags différents par 7 jours glissants.
//
// AUTH : verify_jwt = true + rôle agence vérifié dans profiles.
// ============================================================================

import { corsHeaders, getServiceClient } from "../_shared/google.ts";
import { hashtagPosts, saveUsage } from "../_shared/instagram.ts";

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
  const { data: prof } = await sb.from("profiles").select("role").eq("user_id", uid).maybeSingle<{ role: string }>();
  if (prof?.role !== "agency") return res({ error: "non_autorise" }, 403);

  let body: { tag?: string; kind?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return res({ error: "json" }, 400);
  }
  const r = await hashtagPosts(String(body.tag ?? ""), body.kind === "recent" ? "recent" : "top");
  console.log("ig-hashtag", JSON.stringify({ tag: body.tag, ok: r.ok, why: r.ok ? undefined : r.why }));
  const quota = await saveUsage(sb);
  return res(r.ok ? { posts: r.posts, quota } : { why: r.why, quota });
});
