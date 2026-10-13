// ============================================================================
// ig-avatar/index.ts : profil Instagram des créateurs du Scouting.
// ----------------------------------------------------------------------------
// Entrée (POST JSON) : { handles: string[] } (20 max par appel).
// Pour chaque @ PRO, via l'outil officiel de Meta (_shared/instagram.ts) : photo
// de profil copiée dans le bucket « avatars », abonnés, engagement public moyen
// (12 derniers posts), posts par semaine, bio et site.
// Les comptes personnels ne sont pas visibles par cet outil → « compte_perso ».
// (Lire la page Instagram directement ne marche pas : Instagram bloque les
// serveurs de Supabase, réponse 429.)
// Sortie : { photos, followers, stats, why } indexés par handle.
//
// Sécurité : JWT requis (verify_jwt) + rôle agence vérifié dans profiles.
// Seuls des noms d'utilisateur Instagram valides sont demandés (pas d'URL libre).
// ============================================================================

import { getServiceClient, corsHeaders } from "../_shared/google.ts";
import { discover, engagementRate, igUser, metaReady, postsPerWeek, storePicture } from "../_shared/instagram.ts";

type Stats = { er: number | null; perWeek: number | null; posts: number; bio: string; website: string; name: string };

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

  let handles: unknown = [];
  try {
    handles = (await req.json())?.handles;
  } catch {
    return res({ error: "json" }, 400);
  }
  if (!Array.isArray(handles)) return res({ error: "handles" }, 400);
  const list = [...new Set(handles.filter((h): h is string => typeof h === "string"))].slice(0, 20);

  const photos: Record<string, string | null> = {};
  const followers: Record<string, number> = {};
  const stats: Record<string, Stats> = {};
  const why: Record<string, string> = {};
  // Pas encore configuré chez Meta : on le dit, l'app retentera plus tard.
  if (!metaReady()) {
    for (const h of list) {
      photos[h] = null;
      why[h] = "meta_non_configure";
    }
    return res({ photos, followers, stats, why });
  }
  let stopped = "";
  for (const h of list) {
    photos[h] = null;
    if (stopped) {
      why[h] = stopped;
      continue;
    }
    const r = await discover(h, 12);
    if (!r.ok) {
      why[h] = r.why;
      if (r.stop) stopped = r.why;
      continue;
    }
    const p = r.profile;
    followers[h] = p.followers;
    stats[h] = { er: engagementRate(p.media, p.followers), perWeek: postsPerWeek(p.media), posts: p.posts, bio: p.bio, website: p.website, name: p.name };
    const pic = await storePicture(sb, igUser(h), p.picture);
    photos[h] = pic.url;
    if (pic.why) why[h] = pic.why;
  }
  console.log("ig-avatar", JSON.stringify({ demandes: list.length, trouvees: Object.values(photos).filter(Boolean).length, why }));
  return res({ photos, followers, stats, why });
});
