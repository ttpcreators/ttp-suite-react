// ============================================================================
// ig-avatar/index.ts : photo de profil Instagram des créateurs du Scouting.
// ----------------------------------------------------------------------------
// Entrée (POST JSON) : { handles: string[] } (6 traités par appel, un par un).
// Pour chaque @ : lit la page publique du profil (comme un aperçu de lien),
// récupère l'image « og:image » (photo de profil 100×100), la copie dans le bucket
// public « avatars » (instagram/<nom>.jpg : les liens d'Instagram expirent) et
// renvoie son adresse. Profil privé, inexistant ou Instagram qui refuse → null.
// Sortie : { photos: { [handle]: string | null }, why: { [handle]: raison si null } }
//
// Sécurité : JWT requis (verify_jwt) + rôle agence vérifié dans profiles.
// Seuls des noms d'utilisateur Instagram valides sont demandés (pas d'URL libre).
// ============================================================================

import { getServiceClient, corsHeaders } from "../_shared/google.ts";

// Robots d'aperçu de lien : Instagram leur donne la page avec la photo (og:image).
// Plusieurs essais, car Instagram en refuse parfois un selon le serveur qui demande.
const UAS = [
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  "WhatsApp/2.23.20.0",
  "Twitterbot/1.0",
  "Googlebot/2.1 (+http://www.google.com/bot.html)",
];
const USERNAME = /^[A-Za-z0-9._]{1,30}$/;

/** « @lea.fit », « instagram.com/lea.fit/ » → « lea.fit » (ou "" si invalide). */
function clean(handle: string): string {
  const u = handle.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "");
  return USERNAME.test(u) ? u : "";
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&quot;/g, '"');

type Found = { url: string | null; why?: string };

/** Adresse de la photo (og:image) trouvée sur la page du profil, en essayant chaque robot. */
async function findImage(user: string): Promise<{ src?: string; why: string }> {
  let why = "aucune_page";
  for (const ua of UAS) {
    try {
      const page = await fetch(`https://www.instagram.com/${user}/`, { headers: { "User-Agent": ua, "Accept-Language": "fr-FR,fr;q=0.9" }, redirect: "follow" });
      if (page.status === 404) return { why: "profil_introuvable" };
      // Instagram freine (trop de demandes) : on s'arrête là, réessayer aggraverait.
      if (page.status === 429) return { why: "page_429" };
      if (!page.ok) { why = `page_${page.status}`; continue; }
      const m = (await page.text()).match(/<meta property="og:image" content="([^"]+)"/);
      if (!m) { why = "page_sans_photo"; continue; }
      const src = decode(m[1]);
      if (!/(\.|^)(cdninstagram\.com|fbcdn\.net)$/.test(new URL(src).hostname)) { why = "adresse_inattendue"; continue; }
      return { src, why: "" };
    } catch {
      why = "reseau";
    }
  }
  return { why };
}

async function photoOf(sb: ReturnType<typeof getServiceClient>, user: string): Promise<Found> {
  const { src, why } = await findImage(user);
  if (!src) return { url: null, why };
  const img = await fetch(src, { headers: { "User-Agent": UAS[0] } });
  const type = img.headers.get("content-type") ?? "";
  if (!img.ok || !type.startsWith("image/")) return { url: null, why: `image_${img.status}` };
  const bytes = new Uint8Array(await img.arrayBuffer());
  if (!bytes.length || bytes.length > 2_000_000) return { url: null, why: "image_taille" };
  const path = `instagram/${user.toLowerCase()}.jpg`;
  const { error } = await sb.storage.from("avatars").upload(path, bytes, { upsert: true, contentType: type, cacheControl: "86400" });
  if (error) return { url: null, why: "stockage" };
  // ?v= : la nouvelle photo remplace l'ancienne sans attendre le cache.
  return { url: `${sb.storage.from("avatars").getPublicUrl(path).data.publicUrl}?v=${Date.now()}` };
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
  const list = [...new Set(handles.filter((h): h is string => typeof h === "string"))].slice(0, 6);

  // Un par un, avec une pause : Instagram freine vite les rafales venant d'un serveur.
  // Au premier « trop de demandes », les suivants sont laissés pour la prochaine fois.
  const photos: Record<string, string | null> = {};
  const why: Record<string, string> = {};
  let blocked = false;
  for (const h of list) {
    if (blocked) {
      photos[h] = null;
      why[h] = "pause";
      continue;
    }
    const user = clean(h);
    const f: Found = user ? await photoOf(sb, user).catch(() => ({ url: null, why: "erreur" })) : { url: null, why: "nom_invalide" };
    photos[h] = f.url;
    if (f.why) why[h] = f.why;
    if (f.why === "page_429") blocked = true;
    else await new Promise((r) => setTimeout(r, 1500));
  }
  console.log("ig-avatar", JSON.stringify({ demandes: list.length, trouvees: Object.values(photos).filter(Boolean).length, why }));
  return res({ photos, why });
});
