// ============================================================================
// ig-avatar/index.ts : photo de profil Instagram des créateurs du Scouting.
// ----------------------------------------------------------------------------
// Entrée (POST JSON) : { handles: string[] } (20 max).
// Pour chaque @ : lit la page publique du profil (comme un aperçu de lien),
// récupère l'image « og:image » (photo de profil 100×100), la copie dans le bucket
// public « avatars » (instagram/<nom>.jpg : les liens d'Instagram expirent) et
// renvoie son adresse. Profil privé, inexistant ou Instagram qui refuse → null.
// Sortie : { photos: { [handle]: string | null } }
//
// Sécurité : JWT requis (verify_jwt) + rôle agence vérifié dans profiles.
// Seuls des noms d'utilisateur Instagram valides sont demandés (pas d'URL libre).
// ============================================================================

import { getServiceClient, corsHeaders } from "../_shared/google.ts";

const UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
const USERNAME = /^[A-Za-z0-9._]{1,30}$/;

/** « @lea.fit », « instagram.com/lea.fit/ » → « lea.fit » (ou "" si invalide). */
function clean(handle: string): string {
  const u = handle.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "");
  return USERNAME.test(u) ? u : "";
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&quot;/g, '"');

async function photoOf(sb: ReturnType<typeof getServiceClient>, user: string): Promise<string | null> {
  const page = await fetch(`https://www.instagram.com/${user}/`, { headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9" }, redirect: "follow" });
  if (!page.ok) return null;
  const html = await page.text();
  const m = html.match(/<meta property="og:image" content="([^"]+)"/);
  if (!m) return null;
  const src = decode(m[1]);
  const host = new URL(src).hostname;
  if (!/(\.|^)(cdninstagram\.com|fbcdn\.net)$/.test(host)) return null; // jamais une autre adresse
  const img = await fetch(src, { headers: { "User-Agent": UA } });
  const type = img.headers.get("content-type") ?? "";
  if (!img.ok || !type.startsWith("image/")) return null;
  const bytes = new Uint8Array(await img.arrayBuffer());
  if (!bytes.length || bytes.length > 2_000_000) return null;
  const path = `instagram/${user.toLowerCase()}.jpg`;
  const { error } = await sb.storage.from("avatars").upload(path, bytes, { upsert: true, contentType: type, cacheControl: "86400" });
  if (error) return null;
  // ?v= : la nouvelle photo remplace l'ancienne sans attendre le cache.
  return `${sb.storage.from("avatars").getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
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

  // Par petits groupes : Instagram n'aime pas les rafales.
  const photos: Record<string, string | null> = {};
  for (let i = 0; i < list.length; i += 4) {
    await Promise.all(list.slice(i, i + 4).map(async (h) => {
      const user = clean(h);
      photos[h] = user ? await photoOf(sb, user).catch(() => null) : null;
    }));
  }
  return res({ photos });
});
