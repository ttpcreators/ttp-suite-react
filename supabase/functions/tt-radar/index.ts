// ============================================================================
// tt-radar/index.ts : Radar à collabs TikTok (contenus sponsorisés en France).
// ----------------------------------------------------------------------------
// Source : API officielle « Commercial Content » de TikTok (bibliothèque de
// transparence de l'UE). Chaque vidéo marquée « partenariat rémunéré » par une
// créatrice d'un pays de l'EEE, avec les marques qui la paient et le lien de la
// vidéo. Pas de recherche par marque : on lit tout un pays sur une période, puis
// l'app regroupe par marque (page Sourcing → Radar à marques → TikTok).
// Entrées (POST JSON) :
//   {} (cron chaque jour)        → France, 3 derniers jours (30 au 1er passage)
//   { days, country }            → bouton « Lancer le radar » (30 j max)
//   { mode: "creators" }         → contenus sponsorisés des créatrices du roster et du
//                                  Scouting qui ont un @ TikTok (180 derniers jours)
// Jeton : « client credentials » (portée research.adlib.basic) avec les clés reçues
// après l'accord de TikTok : secrets TT_RESEARCH_KEY / TT_RESEARCH_SECRET.
// Conservation : 400 jours (la bibliothèque TikTok garde un an).
// AUTH : verify_jwt = false (config.toml) ; Bearer CRON_SECRET (cron) OU JWT agence.
// ============================================================================

import { CRON_SECRET, corsHeaders, getServiceClient, timingSafeEqualStr } from "../_shared/google.ts";
import { saveState, tidySecret } from "../_shared/instagram.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const KEY = tidySecret(Deno.env.get("TT_RESEARCH_KEY"));
const SECRET = tidySecret(Deno.env.get("TT_RESEARCH_SECRET"));
const API = "https://open.tiktokapis.com/v2";
const FIELDS = "id,create_date,label,brand_names,creator,videos";
const MAX_PAGES = 60; // 50 contenus par page
const BUDGET_MS = 110_000;

type Content = { id?: string | number; create_date?: string; label?: string; brand_names?: string[]; creator?: { username?: string }; videos?: { url?: string; cover_image_url?: string }[] };

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

async function clientToken(): Promise<string | { error: string }> {
  try {
    const r = await fetch(`${API}/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: new URLSearchParams({ client_key: KEY, client_secret: SECRET, grant_type: "client_credentials" }),
      signal: AbortSignal.timeout(15_000),
    });
    const b = await r.json().catch(() => ({}));
    if (!r.ok || !b.access_token) return { error: String(b.error_description || b.error || `http_${r.status}`) };
    return String(b.access_token);
  } catch {
    return { error: "reseau" };
  }
}

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
const isoDay = (s?: string) => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);
const clean = (u?: string) => (u ?? "").trim().replace(/^@/, "").toLowerCase();

/** Une recherche paginée ; renvoie les lignes à enregistrer (ou l'erreur de TikTok). */
async function search(token: string, filters: Record<string, unknown>, country: string, t0: number) {
  const rows: Record<string, unknown>[] = [];
  let searchId: string | undefined;
  let why: string | null = null;
  for (let page = 0; page < MAX_PAGES && Date.now() - t0 < BUDGET_MS; page++) {
    let b: { data?: { commercial_contents?: Content[]; has_more?: boolean | string; search_id?: string }; error?: { code?: string; message?: string } } = {};
    try {
      const r = await fetch(`${API}/research/adlib/commercial_content/query/?fields=${FIELDS}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ filters, max_count: 50, ...(searchId ? { search_id: searchId } : {}) }),
        signal: AbortSignal.timeout(25_000),
      });
      b = await r.json().catch(() => ({}));
    } catch {
      why = "reseau";
      break;
    }
    if (b.error?.code && b.error.code !== "ok") {
      why = b.error.code;
      break;
    }
    for (const c of b.data?.commercial_contents ?? []) {
      if (c.id == null) continue;
      const v = (c.videos ?? [])[0] ?? {};
      rows.push({
        id: String(c.id), created: isoDay(c.create_date), label: c.label ?? null,
        brands: (c.brand_names ?? []).map((x) => String(x).trim()).filter(Boolean).slice(0, 10),
        creator: clean(c.creator?.username) || null, video_url: v.url ?? null, cover: v.cover_image_url ?? null,
        country, fetched_at: new Date().toISOString(),
      });
    }
    const more = b.data?.has_more === true || b.data?.has_more === "true";
    if (!more || !b.data?.search_id) break;
    searchId = b.data.search_id;
  }
  return { rows, why };
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const res = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return res({ error: "methode" }, 405);

  const sb = getServiceClient();
  if (!(await caller(req, sb))) return res({ error: "non_autorise" }, 401);
  let body: { mode?: string; days?: number; country?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    body = {};
  }
  const probe = await sb.from("tt_commercial").select("id").limit(1);
  if (probe.error) return res({ error: "migration_manquante" });
  if (!KEY || !SECRET) {
    await saveState(sb, "tt_radar", { ok: false, why: "non_configure" });
    return res({ error: "non_configure" });
  }
  const t0 = Date.now();
  const tok = await clientToken();
  if (typeof tok !== "string") {
    await saveState(sb, "tt_radar", { ok: false, why: "jeton", detail: tok.error });
    return res({ error: "jeton", detail: tok.error });
  }
  const country = /^[A-Z]{2}$/.test(String(body.country ?? "")) ? String(body.country) : "FR";
  const today = new Date();

  let out: { rows: Record<string, unknown>[]; why: string | null };
  if (body.mode === "creators") {
    // @ TikTok du roster et du Scouting (fiche « TikTok » ou lien tiktok.com/@…).
    const [cr, pl] = await Promise.all([sb.from("creators").select("tiktok"), sb.from("creator_pool").select("handle")]);
    const handles = new Set<string>();
    const take = (raw: string | null) => {
      const m = /tiktok\.com\/@([\w.]+)/i.exec(raw ?? "") ?? /^@?([\w.]{2,24})$/.exec((raw ?? "").trim());
      if (m) handles.add(m[1].toLowerCase());
    };
    for (const c of (cr.data as { tiktok: string | null }[] | null) ?? []) take(c.tiktok);
    for (const p of (pl.data as { handle: string | null }[] | null) ?? []) if (/tiktok\.com/i.test(p.handle ?? "")) take(p.handle);
    const list = [...handles].slice(0, 100);
    const min = new Date(today.getTime() - 180 * 86400000);
    out = { rows: [], why: null };
    for (let i = 0; i < list.length && Date.now() - t0 < BUDGET_MS; i += 10) {
      const r = await search(tok, { content_published_date_range: { min: ymd(min), max: ymd(today) }, creator_usernames: list.slice(i, i + 10) }, country, t0);
      out.rows.push(...r.rows);
      out.why = out.why ?? r.why;
    }
  } else {
    const { count } = await sb.from("tt_commercial").select("id", { count: "exact", head: true });
    const days = Math.min(30, Math.max(1, Number(body.days) || (count ? 3 : 30)));
    const min = new Date(today.getTime() - days * 86400000);
    out = await search(tok, { content_published_date_range: { min: ymd(min), max: ymd(today) }, creator_country_code: country }, country, t0);
  }

  // Un même contenu peut revenir deux fois (pages qui se chevauchent) : une ligne par id.
  const rows = [...new Map(out.rows.map((r) => [String(r.id), r])).values()];
  let saved = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("tt_commercial").upsert(rows.slice(i, i + 500));
    if (!error) saved += Math.min(500, rows.length - i);
  }
  // Conservation : 400 jours.
  await sb.from("tt_commercial").delete().lt("created", new Date(today.getTime() - 400 * 86400000).toISOString().slice(0, 10));
  const result = { ok: !out.why || saved > 0, saved, why: out.why, mode: body.mode ?? "scan", ms: Date.now() - t0 };
  await saveState(sb, "tt_radar", result);
  console.log("tt-radar", JSON.stringify(result));
  return res(result);
});
