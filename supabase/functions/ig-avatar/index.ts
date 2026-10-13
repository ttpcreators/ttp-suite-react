// ============================================================================
// ig-avatar/index.ts : photo de profil Instagram (+ abonnés) des créateurs du Scouting.
// ----------------------------------------------------------------------------
// Entrée (POST JSON) : { handles: string[] } (20 max par appel).
// Passe par l'outil officiel de Meta (« business discovery » de l'API Graph), au
// nom du compte pro de l'agence : pour chaque @ PRO (créateur ou entreprise),
// Meta donne la photo de profil et le nombre d'abonnés. La photo est copiée dans
// le bucket public « avatars » (instagram/<nom>.jpg : les liens de Meta expirent).
// Les comptes personnels ne sont pas visibles par cet outil → null « compte_perso ».
// (Lire la page Instagram directement ne marche pas : Instagram bloque les
// serveurs de Supabase, réponse 429.)
// Sortie : { photos: { [handle]: url | null }, followers: { [handle]: n }, why: { [handle]: raison } }
//
// Secrets (supabase secrets set) : META_TOKEN (jeton de page longue durée, jamais
// dans le dépôt), META_IG_ID (id du compte Instagram pro de l'agence),
// META_GRAPH_VERSION facultatif (défaut v26.0).
// Sécurité : JWT requis (verify_jwt) + rôle agence vérifié dans profiles.
// Seuls des noms d'utilisateur Instagram valides sont demandés (pas d'URL libre).
// ============================================================================

import { getServiceClient, corsHeaders } from "../_shared/google.ts";

const META_TOKEN = Deno.env.get("META_TOKEN") ?? "";
const META_IG_ID = Deno.env.get("META_IG_ID") ?? "";
const GRAPH = `https://graph.facebook.com/${Deno.env.get("META_GRAPH_VERSION") ?? "v26.0"}`;
const USERNAME = /^[A-Za-z0-9._]{1,30}$/;

/** « @lea.fit », « instagram.com/lea.fit/ » → « lea.fit » (ou "" si invalide). */
function clean(handle: string): string {
  const u = handle.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "");
  return USERNAME.test(u) ? u : "";
}

type Found = { url: string | null; followers?: number; why?: string; stop?: boolean };
type GraphError = { code?: number; error_subcode?: number; message?: string };

/** Erreur Meta → raison lisible ; stop = inutile de continuer cet appel (jeton, limite). */
function graphWhy(e: GraphError): { why: string; stop?: boolean } {
  if (e.code === 190) return { why: "meta_jeton", stop: true };
  if (e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613) return { why: "meta_limite", stop: true };
  if (e.code === 110 || e.error_subcode === 2207013 || /Invalid user id|cannot be found/i.test(e.message ?? "")) return { why: "compte_perso" };
  return { why: `meta_${e.code ?? "erreur"}` };
}

async function photoOf(sb: ReturnType<typeof getServiceClient>, user: string): Promise<Found> {
  const fields = `business_discovery.username(${user}){username,profile_picture_url,followers_count}`;
  const r = await fetch(`${GRAPH}/${META_IG_ID}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(META_TOKEN)}`);
  const body = await r.json().catch(() => ({}));
  if (body?.error) return { url: null, ...graphWhy(body.error as GraphError) };
  const bd = body?.business_discovery as { profile_picture_url?: string; followers_count?: number } | undefined;
  const followers = typeof bd?.followers_count === "number" ? bd.followers_count : undefined;
  const src = bd?.profile_picture_url;
  if (!src) return { url: null, followers, why: "sans_photo" };
  if (!/(\.|^)(cdninstagram\.com|fbcdn\.net)$/.test(new URL(src).hostname)) return { url: null, followers, why: "adresse_inattendue" };
  const img = await fetch(src);
  const type = img.headers.get("content-type") ?? "";
  if (!img.ok || !type.startsWith("image/")) return { url: null, followers, why: `image_${img.status}` };
  const bytes = new Uint8Array(await img.arrayBuffer());
  if (!bytes.length || bytes.length > 2_000_000) return { url: null, followers, why: "image_taille" };
  const path = `instagram/${user.toLowerCase()}.jpg`;
  const { error } = await sb.storage.from("avatars").upload(path, bytes, { upsert: true, contentType: type, cacheControl: "86400" });
  if (error) return { url: null, followers, why: "stockage" };
  // ?v= : la nouvelle photo remplace l'ancienne sans attendre le cache.
  return { url: `${sb.storage.from("avatars").getPublicUrl(path).data.publicUrl}?v=${Date.now()}`, followers };
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
  const why: Record<string, string> = {};
  // Pas encore configuré chez Meta : on le dit, l'app retentera plus tard.
  if (!META_TOKEN || !META_IG_ID) {
    for (const h of list) {
      photos[h] = null;
      why[h] = "meta_non_configure";
    }
    return res({ photos, followers, why });
  }
  let stopped = "";
  for (const h of list) {
    if (stopped) {
      photos[h] = null;
      why[h] = stopped;
      continue;
    }
    const user = clean(h);
    const f: Found = user ? await photoOf(sb, user).catch(() => ({ url: null, why: "erreur" })) : { url: null, why: "nom_invalide" };
    photos[h] = f.url;
    if (f.followers !== undefined) followers[h] = f.followers;
    if (f.why) why[h] = f.why;
    if (f.stop) stopped = f.why ?? "erreur";
  }
  console.log("ig-avatar", JSON.stringify({ demandes: list.length, trouvees: Object.values(photos).filter(Boolean).length, why }));
  return res({ photos, followers, why });
});
