// ============================================================================
// ig-publish/index.ts : publie les posts programmés sur le compte Instagram de TTP.
// ----------------------------------------------------------------------------
// Page Planning → Posts Instagram (table ig_planned). Meta publie en 2 temps :
//   1. « préparation » (conteneur) : Meta télécharge la photo / vidéo depuis le
//      bucket public ig-posts (une préparation par élément pour un carrousel) ;
//   2. publication, quand la préparation est prête (les vidéos prennent du temps).
// Entrées (POST JSON) :
//   { mode: "due" }        cron chaque minute (seulement s'il y a un post à l'heure)
//   { mode: "now", id }    bouton « Publier maintenant » de l'app
//   { mode: "status" }     compte TTP, derniers posts, quota de publication de Meta,
//                          permissions du jeton (diagnostic de l'onglet)
// Verrou (lock_until) : une ligne n'est jamais traitée par deux passages à la fois,
// et une préparation déjà publiée n'est jamais republiée.
// Permission : instagram_content_publish sur le jeton de l'utilisateur système.
// AUTH : verify_jwt = false (config.toml) ; Bearer CRON_SECRET (cron) OU JWT agence.
// ============================================================================

import { CRON_SECRET, corsHeaders, getServiceClient, timingSafeEqualStr } from "../_shared/google.ts";
import { GRAPH, META_IG_ID, META_TOKEN, accountToken, getJson, metaReady, ownAccount, pageAccess, postGraph, saveState, saveUsage } from "../_shared/instagram.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type Media = { url: string; path?: string; type: "image" | "video" };
type Row = {
  id: string; kind: "post" | "carrousel" | "reel" | "story"; caption: string; media: Media[]; cover_url: string | null;
  collaborators: string[] | null; share_to_feed: boolean; status: string; scheduled_at: string | null;
  container_id: string | null; children: string[] | null; started_at: string | null; attempts: number;
};
type GraphError = { code?: number; error_subcode?: number; message?: string; error_user_msg?: string };

const LOCK_MS = 4 * 60_000;
const MAX_ATTEMPTS = 5;
const PREP_TIMEOUT_MS = 40 * 60_000; // une vidéo pas prête au bout de 40 min = erreur
const enc = encodeURIComponent;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function caller(req: Request, sb: SupabaseClient): Promise<"cron" | "agency" | null> {
  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  if (!bearer) return null;
  if (CRON_SECRET && timingSafeEqualStr(bearer, CRON_SECRET)) return "cron";
  const { data, error } = await sb.auth.getUser(bearer);
  if (error || !data?.user) return null;
  const { data: prof } = await sb.from("profiles").select("role").eq("user_id", data.user.id).maybeSingle<{ role: string }>();
  return prof?.role === "agency" ? "agency" : null;
}

/** Erreur Meta → phrase claire ; retry = vaut la peine de réessayer plus tard. */
function why(e: GraphError): { text: string; retry: boolean } {
  const sub = e.error_subcode ?? 0;
  const raw = e.error_user_msg || e.message || "erreur inconnue";
  if (e.message === "reseau") return { text: "Meta n'a pas répondu.", retry: true };
  if (e.code === 190) return { text: "Le jeton Meta n'est plus valable (à refaire dans le Business Manager).", retry: false };
  if (e.code === 10 || e.code === 200 || e.code === 3) return { text: "Permission manquante : ajouter instagram_content_publish au jeton Meta.", retry: false };
  if (e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613) return { text: "Meta a freiné les demandes : nouvel essai dans quelques minutes.", retry: true };
  if (sub === 2207042) return { text: "Limite de Meta atteinte (publications des dernières 24 h) : nouvel essai plus tard.", retry: true };
  if (sub === 2207026 || sub === 2207023) return { text: "Format de vidéo refusé par Instagram (MP4 ou MOV, H.264, 3 s à 15 min).", retry: false };
  if (e.code === 36003 || sub === 2207009) return { text: "Format de photo refusé : entre 4:5 (portrait) et 1,91:1 (paysage).", retry: false };
  if (e.code === 9004 || sub === 2207052 || sub === 2207003) return { text: "Meta n'a pas pu télécharger la photo ou la vidéo.", retry: true };
  if (sub === 2207050) return { text: "Le compte Instagram de TTP est restreint ou inactif.", retry: false };
  if (sub === 2207001 || sub === 2207032 || sub === 2207053 || e.code === 1 || e.code === 2) return { text: "Erreur passagère chez Instagram.", retry: true };
  return { text: `Instagram a refusé : ${raw}`, retry: false };
}

/** Réserve la ligne pour ce passage (null = déjà prise ailleurs ou plus à publier). */
async function claim(sb: SupabaseClient, id: string): Promise<Row | null> {
  const now = new Date();
  const { data } = await sb.from("ig_planned")
    .update({ lock_until: new Date(now.getTime() + LOCK_MS).toISOString() })
    .eq("id", id).in("status", ["programme", "en_cours"])
    .or(`lock_until.is.null,lock_until.lt."${now.toISOString()}"`)
    .select("id, kind, caption, media, cover_url, collaborators, share_to_feed, status, scheduled_at, container_id, children, started_at, attempts");
  return ((data as Row[] | null) ?? [])[0] ?? null;
}

async function save(sb: SupabaseClient, id: string, patch: Record<string, unknown>) {
  await sb.from("ig_planned").update({ ...patch, lock_until: null }).eq("id", id);
}

/** Paramètres d'une préparation (conteneur) selon le type de post. */
function params(row: Row, m: Media, carouselItem = false): Record<string, string> {
  const p: Record<string, string> = {};
  const video = m.type === "video";
  if (carouselItem) {
    p.is_carousel_item = "true";
    if (video) p.media_type = "VIDEO";
  } else if (row.kind === "reel") {
    p.media_type = "REELS";
    p.share_to_feed = row.share_to_feed ? "true" : "false";
    if (row.cover_url) p.cover_url = row.cover_url;
  } else if (row.kind === "story") {
    p.media_type = "STORIES";
  }
  p[video ? "video_url" : "image_url"] = m.url;
  if (!carouselItem && row.kind !== "story") {
    if (row.caption) p.caption = row.caption;
    const collab = (row.collaborators ?? []).map((u) => u.replace(/^@/, "").trim()).filter(Boolean).slice(0, 3);
    if (collab.length) p.collaborators = JSON.stringify(collab);
  }
  return p;
}

async function create(token: string, p: Record<string, string>): Promise<{ id?: string; error?: GraphError }> {
  const r = await postGraph(`${META_IG_ID}/media`, p, token, 60_000);
  if (r.error) return { error: r.error as GraphError };
  return { id: String(r.id ?? "") || undefined, error: r.id ? undefined : { message: "sans_id" } };
}

async function statusOf(token: string, id: string): Promise<{ code: string; detail: string }> {
  const r = await getJson(`${GRAPH}/${id}?fields=status_code,status&access_token=${enc(token)}`);
  if (r.error) return { code: "INCONNU", detail: (r.error as GraphError).message ?? "" };
  return { code: String(r.status_code ?? "INCONNU"), detail: String(r.status ?? "") };
}

/**
 * Fait avancer une ligne d'une étape (ou jusqu'au bout si tout est prêt) :
 * préparation(s) → attente → publication. `waitMs` : attente max dans ce passage.
 */
async function advance(sb: SupabaseClient, token: string, row: Row, waitMs: number): Promise<string> {
  const media = (row.media ?? []).filter((m) => m?.url);
  const failNow = async (text: string) => {
    await save(sb, row.id, { status: "erreur", error: text, attempts: row.attempts + 1 });
    return "erreur";
  };
  const retryLater = async (text: string) => {
    if (row.attempts + 1 >= MAX_ATTEMPTS) return failNow(text);
    // Reporte de 5 min (le cron reprendra) en gardant la préparation éventuelle.
    await save(sb, row.id, { attempts: row.attempts + 1, error: text, scheduled_at: new Date(Date.now() + 5 * 60_000).toISOString() });
    return "reporte";
  };
  if (!media.length) return failNow("Aucune photo ni vidéo.");
  if (row.kind === "carrousel" && (media.length < 2 || media.length > 10)) return failNow("Un carrousel compte de 2 à 10 photos ou vidéos.");

  // 1. Préparation(s).
  let container = row.container_id;
  if (!container) {
    if (row.kind === "carrousel") {
      const kids = [...(row.children ?? [])];
      for (let i = 0; i < media.length; i++) {
        if (kids[i]) continue;
        const c = await create(token, params(row, media[i], true));
        if (!c.id) {
          await save(sb, row.id, { children: kids });
          const w = why(c.error ?? {});
          return w.retry ? retryLater(w.text) : failNow(w.text);
        }
        kids[i] = c.id;
      }
      await sb.from("ig_planned").update({ children: kids, status: "en_cours", started_at: row.started_at ?? new Date().toISOString() }).eq("id", row.id);
      // Les vidéos du carrousel doivent être prêtes avant de créer l'ensemble.
      for (let i = 0; i < media.length; i++) {
        if (media[i].type !== "video") continue;
        const s = await statusOf(token, kids[i]);
        if (s.code === "ERROR" || s.code === "EXPIRED") return failNow(`Vidéo ${i + 1} refusée par Instagram ${s.detail ? `(${s.detail})` : ""}`.trim());
        if (s.code !== "FINISHED") {
          await save(sb, row.id, {});
          return "en_preparation";
        }
      }
      const p: Record<string, string> = { media_type: "CAROUSEL", children: kids.join(",") };
      if (row.caption) p.caption = row.caption;
      const collab = (row.collaborators ?? []).map((u) => u.replace(/^@/, "").trim()).filter(Boolean).slice(0, 3);
      if (collab.length) p.collaborators = JSON.stringify(collab);
      const c = await create(token, p);
      if (!c.id) {
        const w = why(c.error ?? {});
        return w.retry ? retryLater(w.text) : failNow(w.text);
      }
      container = c.id;
    } else {
      const c = await create(token, params(row, media[0]));
      if (!c.id) {
        const w = why(c.error ?? {});
        return w.retry ? retryLater(w.text) : failNow(w.text);
      }
      container = c.id;
    }
    const started = row.started_at ?? new Date().toISOString();
    await sb.from("ig_planned").update({ container_id: container, status: "en_cours", started_at: started, error: null }).eq("id", row.id);
    row.started_at = started;
  }

  // 2. Attente de la préparation (une photo est prête en quelques secondes).
  const until = Date.now() + waitMs;
  let s = await statusOf(token, container);
  while (s.code === "IN_PROGRESS" && Date.now() + 5000 < until) {
    await sleep(5000);
    s = await statusOf(token, container);
  }
  if (s.code === "PUBLISHED") {
    await save(sb, row.id, { status: "publie", published_at: new Date().toISOString(), error: null });
    return "publie";
  }
  if (s.code === "ERROR" || s.code === "EXPIRED") {
    // Préparation perdue : on repart de zéro au prochain passage (si essais restants).
    await sb.from("ig_planned").update({ container_id: null, children: null }).eq("id", row.id);
    return retryLater(s.code === "EXPIRED" ? "Préparation expirée chez Meta." : `Instagram a refusé le fichier${s.detail ? ` (${s.detail})` : ""}.`);
  }
  if (s.code !== "FINISHED") {
    if (row.started_at && Date.now() - Date.parse(row.started_at) > PREP_TIMEOUT_MS) return failNow("Instagram n'a pas fini de préparer la vidéo (40 min).");
    await save(sb, row.id, {});
    return "en_preparation";
  }

  // 3. Publication.
  const pub = await postGraph(`${META_IG_ID}/media_publish`, { creation_id: container }, token, 60_000);
  if (pub.error || !pub.id) {
    // Publiée malgré l'erreur (délai réseau) ? On vérifie avant tout nouvel essai.
    const again = await statusOf(token, container);
    if (again.code === "PUBLISHED") {
      await save(sb, row.id, { status: "publie", published_at: new Date().toISOString(), error: null });
      return "publie";
    }
    const w = why((pub.error as GraphError) ?? { message: "sans_id" });
    return w.retry ? retryLater(w.text) : failNow(w.text);
  }
  const mediaId = String(pub.id);
  const link = await getJson(`${GRAPH}/${mediaId}?fields=permalink&access_token=${enc(token)}`);
  await save(sb, row.id, {
    status: "publie", media_id: mediaId, permalink: link.permalink ? String(link.permalink) : null,
    published_at: new Date().toISOString(), error: null,
  });
  return "publie";
}

/** Compte TTP, derniers posts, quota de publication, permissions du jeton. */
async function status(token: string) {
  const [account, recent, limit, perms] = await Promise.all([
    ownAccount(token),
    getJson(`${GRAPH}/${META_IG_ID}/media?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp&limit=12&access_token=${enc(token)}`),
    getJson(`${GRAPH}/${META_IG_ID}/content_publishing_limit?fields=quota_usage,config&access_token=${enc(token)}`),
    getJson(`${GRAPH}/me/permissions?access_token=${enc(META_TOKEN)}`),
  ]);
  const lim = ((limit.data as { quota_usage?: number; config?: { quota_total?: number } }[] | undefined) ?? [])[0];
  return {
    account,
    recent: ((recent.data as Record<string, unknown>[] | undefined) ?? []).map((m) => ({
      id: String(m.id), caption: String(m.caption ?? "").slice(0, 200), type: String(m.media_type ?? ""), product: String(m.media_product_type ?? ""),
      image: String(m.thumbnail_url ?? m.media_url ?? ""), url: String(m.permalink ?? ""), at: String(m.timestamp ?? ""),
    })),
    limit: lim ? { used: Number(lim.quota_usage ?? 0), total: Number(lim.config?.quota_total ?? 0) || null } : null,
    limitError: limit.error ? (limit.error as GraphError).message ?? "erreur" : null,
    perms: perms.error ? null : ((perms.data as { permission: string; status: string }[] | undefined) ?? []).filter((p) => p.status === "granted").map((p) => p.permission),
  };
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const res = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return res({ error: "methode" }, 405);

  const sb = getServiceClient();
  const who = await caller(req, sb);
  if (!who) return res({ error: "non_autorise" }, 401);
  let body: { mode?: string; id?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    body = {};
  }
  const probe = await sb.from("ig_planned").select("id").limit(1);
  if (probe.error) return res({ error: "migration_manquante" });
  if (!metaReady()) return res({ error: "meta_non_configure" });
  const t0 = Date.now();
  const page = await pageAccess();
  const token = await accountToken();

  if (body.mode === "status") {
    const out = await status(token);
    return res({ ...out, page: page.ok ? "ok" : page.why, pageDetail: page.ok ? null : page.detail ?? null, quota: await saveUsage(sb) });
  }

  if (body.mode === "now") {
    if (who !== "agency" || !body.id) return res({ error: "requete" }, 400);
    const at = new Date().toISOString();
    // Après une erreur, on repart d'une préparation neuve chez Meta.
    await sb.from("ig_planned").update({ status: "programme", scheduled_at: at, error: null, attempts: 0, container_id: null, children: null, started_at: null })
      .eq("id", body.id).eq("status", "erreur");
    await sb.from("ig_planned").update({ status: "programme", scheduled_at: at, error: null, attempts: 0 })
      .eq("id", body.id).in("status", ["brouillon", "programme"]);
    const row = await claim(sb, body.id);
    if (!row) return res({ error: "deja_en_cours" });
    const result = await advance(sb, token, row, 45_000);
    const { data } = await sb.from("ig_planned").select("status, error, permalink").eq("id", body.id).maybeSingle();
    return res({ result, row: data, quota: await saveUsage(sb) });
  }

  // Cron : posts à l'heure + préparations en cours, 6 max par passage.
  const nowIso = new Date().toISOString();
  const { data: due } = await sb.from("ig_planned").select("id")
    .or(`and(status.eq.programme,scheduled_at.lte."${nowIso}"),status.eq.en_cours`)
    .order("scheduled_at", { ascending: true }).limit(6);
  const results: Record<string, number> = {};
  for (const { id } of (due as { id: string }[] | null) ?? []) {
    if (Date.now() - t0 > 100_000) break;
    const row = await claim(sb, id);
    if (!row) continue;
    const r = await advance(sb, token, row, 20_000);
    results[r] = (results[r] ?? 0) + 1;
  }
  if (Object.keys(results).length) await saveState(sb, "publish", { ok: true, results, page: page.ok ? "ok" : page.why });
  return res({ ok: true, results, quota: await saveUsage(sb) });
});
