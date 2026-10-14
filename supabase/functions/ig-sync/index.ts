// ============================================================================
// ig-sync/index.ts : chiffres Instagram mis à jour tout seuls, chaque jour.
// ----------------------------------------------------------------------------
// Via l'outil officiel de Meta (_shared/instagram.ts, comptes PRO seulement) :
//   1. Roster : abonnés, engagement public (12 derniers posts), posts/semaine,
//      dernier post, relevé quotidien des abonnés → creators.ig. Les abonnés
//      remplacent aussi creators.followers (si Instagram est le réseau principal)
//      et la ligne Instagram du media kit (mediakit.platforms).
//      Si la créatrice a connecté SON Instagram (ig-connect) : couverture, vues,
//      interactions (28 j) et audience (âge, genre, villes, pays), reportées
//      aussi dans son media kit.
//   2. Collabs (étape 4 et plus) : repère dans les derniers posts de la créatrice
//      ceux qui citent la marque (@, # ou nom) depuis le début de la collab →
//      collabs.ig.posts (lien, date, likes, commentaires ; + couverture,
//      enregistrements, partages, vues si elle a connecté son compte).
//   3. Marques (contacts avec un @Instagram) : abonnés, rythme, dernier post →
//      contacts.ig (une fois par semaine, 20 marques par passage).
//
// Entrée (POST JSON) : {} = tout (cron quotidien) ; { scope: "creator" |
// "collab" | "contact", id } = une seule fiche (bouton « Actualiser » de l'app),
// la réponse contient alors { ig } à jour.
// AUTH : verify_jwt = false (config.toml) ; Bearer CRON_SECRET (cron) OU JWT agence.
// ============================================================================

import { CRON_SECRET, corsHeaders, getServiceClient, timingSafeEqualStr } from "../_shared/google.ts";
import { discover, engagementRate, igUser, metaReady, postsPerWeek, saveUsage, type IgPost, type IgResult } from "../_shared/instagram.ts";
import { accountTotals, audience, freshToken, loginReady, postInsights, type IgAccount, type Split } from "../_shared/instagram-login.ts";
import { citesHandle } from "../_shared/mentions.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type Json = Record<string, unknown>;
type CreatorRow = { id: string; name: string; handle: string | null; platform: string | null; instagram: string | null; status: string | null; mediakit: Json | null; ig: Json | null };
type CollabRow = { id: string; brand: string; creator: string | null; step: number; status: string; created_at: string; ig: Json | null };
type ContactRow = { id: string; brand: string; instagram: string | null; ig: Json | null };

const DAY = 86400000;
const CREATOR_COLS = "id, name, handle, platform, instagram, status, mediakit, ig";
const COLLAB_COLS = "id, brand, creator, step, status, created_at, ig";
const BRANDS_PER_RUN = 20; // Meta limite les demandes par heure

const today = () => new Date().toISOString().slice(0, 10);
const fmtInt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const frPct = (n: number) => String(n).replace(".", ",");
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const age = (iso: unknown) => (typeof iso === "string" && iso ? Date.now() - Date.parse(iso) : Infinity);

/** @ Instagram d'une créatrice : colonne instagram, sinon handle si son réseau principal est Instagram. */
function creatorHandle(c: CreatorRow): string {
  return igUser(c.instagram) || ((c.platform ?? "").toLowerCase().includes("insta") ? igUser(c.handle) : "");
}
function mainIsInstagram(c: CreatorRow): boolean {
  const p = (c.platform ?? "").toLowerCase();
  return p ? p.includes("insta") : !!igUser(c.instagram);
}

/** Relevé d'abonnés : un point par jour, 400 jours max. */
function pushDay(hist: unknown, n: number): { d: string; f: number }[] {
  const d = today();
  const list = Array.isArray(hist) ? (hist as { d?: string; f?: number }[]).filter((x) => x?.d && x.d !== d) : [];
  return [...(list as { d: string; f: number }[]), { d, f: n }].slice(-400);
}

type Ctx = {
  sb: SupabaseClient;
  stop: string; // raison d'arrêt (jeton Meta, limite) : plus aucun appel ensuite
  t0: number;
  profiles: Map<string, Promise<IgResult>>;
  accounts: Map<string, IgAccount>;
  brandHandles: Map<string, string[]>;
};
const inBudget = (ctx: Ctx) => !ctx.stop && Date.now() - ctx.t0 < 110_000; // marge sous la limite de 150 s

/** business discovery, une fois par @ et par passage (créatrice + ses collabs). */
function profileOf(ctx: Ctx, handle: string): Promise<IgResult> {
  const key = handle.toLowerCase();
  if (ctx.stop) return Promise.resolve({ ok: false, why: ctx.stop });
  let p = ctx.profiles.get(key);
  if (!p) {
    p = discover(handle, 25).then((r) => {
      if (!r.ok && r.stop) ctx.stop = r.why;
      return r;
    });
    ctx.profiles.set(key, p);
  }
  return p;
}

/** Applique `fn` à chaque élément, 3 à la fois, tant qu'il reste du temps. */
async function each<T>(ctx: Ctx, items: T[], fn: (t: T) => Promise<unknown>): Promise<number> {
  let i = 0;
  let done = 0;
  const worker = async () => {
    while (i < items.length && inBudget(ctx)) {
      const t = items[i++];
      try {
        await fn(t);
        done++;
      } catch (e) {
        console.error("ig-sync", e);
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return done;
}

// ── Media kit : abonnés (+ vues et audience si compte connecté) ──────────────
const COUNTRY = (() => {
  try {
    return new Intl.DisplayNames(["fr"], { type: "region" });
  } catch {
    return null;
  }
})();
const top = (s: Split | undefined, n: number) => (s ?? []).filter((x) => x.pct > 0).slice(0, n);

function updateKit(mk: Json, ig: Json): Json | null {
  if (!Array.isArray(mk.platforms)) return null;
  const platforms = [...(mk.platforms as Json[])];
  const i = platforms.findIndex((p) => p?.key === "instagram");
  if (i === -1) return null; // pas de ligne Instagram dans ce kit : on n'en crée pas
  const block: Json = { ...platforms[i] };
  if (typeof ig.followers === "number" && ig.followers > 0) block.followers = String(ig.followers);
  const ins = ig.insights as Json | undefined;
  let audienceOut = mk.audience as Json | undefined;
  if (ins) {
    if (typeof ins.views === "number" && ins.views > 0) block.views30j = String(ins.views);
    const ages = top(ins.age as Split, 5);
    if (ages[0]) block.ageBracket = ages[0].label.replace("-", "–");
    const g = (ins.gender as Split | undefined) ?? [];
    const pct = (k: string) => g.find((x) => x.label === k)?.pct;
    const aud: Json = { ...(audienceOut ?? {}) };
    if (ages.length) aud.age = ages.map((a) => ({ label: `${a.label.replace("-", "–")} ans`, pct: frPct(a.pct) }));
    if (pct("F") !== undefined || pct("M") !== undefined) aud.gender = { femmes: frPct(pct("F") ?? 0), hommes: frPct(pct("M") ?? 0) };
    const cities = top(ins.city as Split, 5);
    if (cities.length) aud.villes = cities.map((c) => ({ name: c.label.split(",")[0].trim(), pct: frPct(c.pct) }));
    const countries = top(ins.country as Split, 5);
    if (countries.length) aud.pays = countries.map((c) => ({ name: COUNTRY?.of(c.label) ?? c.label, pct: frPct(c.pct) }));
    audienceOut = aud;
  }
  platforms[i] = block;
  const next = { ...mk, platforms, ...(audienceOut ? { audience: audienceOut } : {}) };
  return JSON.stringify(next) === JSON.stringify(mk) ? null : next;
}

// ── 1. Roster ────────────────────────────────────────────────────────────────
async function syncCreator(ctx: Ctx, c: CreatorRow): Promise<Json> {
  const prev = (c.ig ?? {}) as Json;
  const now = new Date().toISOString();
  const h = creatorHandle(c);
  const patch: Json = {};
  let next: Json;
  if (!h) next = { ...prev, at: now, why: "sans_handle" };
  else {
    const r = await profileOf(ctx, h);
    if (!r.ok) next = { ...prev, at: now, why: r.why };
    else {
      const p = r.profile;
      const last12 = p.media.slice(0, 12);
      next = {
        ...prev, at: now, ok: now, why: null,
        username: p.username, followers: p.followers, following: p.following, posts: p.posts,
        er: engagementRate(last12, p.followers), perWeek: postsPerWeek(last12), lastPost: p.media[0]?.at ?? null,
        history: pushDay(prev.history, p.followers),
      };
      if (mainIsInstagram(c) && p.followers > 0) patch.followers = fmtInt(p.followers);
    }
  }
  // Statistiques privées : seulement si la créatrice a connecté son compte.
  const acc = ctx.accounts.get(c.id);
  if (acc && loginReady()) {
    const token = await freshToken(ctx.sb, acc);
    const [tot, aud] = await Promise.all([accountTotals(token, acc.ig_user_id), audience(token, acc.ig_user_id)]);
    if ("error" in tot) next.insightsWhy = /token|session|oauth/i.test(tot.error) ? "jeton" : "insights";
    else {
      next.insights = { at: now, reach: tot.reach, views: tot.views, interactions: tot.interactions, engaged: tot.engaged, ...(aud ?? {}) };
      next.insightsWhy = null;
    }
  }
  if (c.mediakit && typeof c.mediakit === "object") {
    const kit = updateKit(c.mediakit, next);
    if (kit) patch.mediakit = kit;
  }
  patch.ig = next;
  const { error } = await ctx.sb.from("creators").update(patch).eq("id", c.id);
  if (error) console.error("ig-sync creators", c.name, error.message);
  return next;
}

// ── 2. Collabs : publications de la marque ───────────────────────────────────
/** Le post cite-t-il la marque ? @ ou # du compte, nom du compte seul (Meta retire les @), ou nom de la marque. */
function brandMatcher(brand: string, handles: string[]): (caption: string) => boolean {
  const words = new Set<string>();
  for (const h of handles) {
    words.add(h.toLowerCase());
    words.add(h.toLowerCase().replace(/[._]/g, ""));
  }
  const flat = norm(brand).replace(/[^a-z0-9]/g, "");
  if (flat.length >= 3) words.add(flat);
  const word = norm(brand).trim();
  const re = word.length >= 4 ? new RegExp(`(^|[^a-z0-9@#])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`) : null;
  return (caption) => {
    const c = norm(caption);
    for (const w of words) if (citesHandle(c, w)) return true;
    return re ? re.test(c) : false;
  };
}

async function syncCollab(ctx: Ctx, col: CollabRow, creator: CreatorRow | undefined): Promise<Json> {
  const prev = (col.ig ?? {}) as Json;
  const now = new Date().toISOString();
  const h = creator ? creatorHandle(creator) : "";
  let next: Json;
  if (!creator) next = { ...prev, at: now, why: "sans_createur" };
  else if (!h) next = { ...prev, at: now, why: "sans_handle" };
  else {
    const r = await profileOf(ctx, h);
    if (!r.ok) next = { ...prev, at: now, why: r.why };
    else {
      const since = (Date.parse(col.created_at) || 0) - 3 * DAY;
      const match = brandMatcher(col.brand, ctx.brandHandles.get(norm(col.brand).trim()) ?? []);
      const posts = new Map(((prev.posts as Json[] | undefined) ?? []).map((p) => [String(p.id), p]));
      for (const p of r.profile.media as IgPost[]) {
        if (Date.parse(p.at) < since || !match(p.caption)) continue;
        posts.set(p.id, {
          ...(posts.get(p.id) ?? {}),
          id: p.id, url: p.url, at: p.at, type: p.type, product: p.product,
          likes: p.likes, comments: p.comments, caption: p.caption.slice(0, 160),
        });
      }
      const list = [...posts.values()].sort((a, b) => String(a.at).localeCompare(String(b.at)));
      const acc = ctx.accounts.get(creator.id);
      if (acc && loginReady() && list.length) {
        const token = await freshToken(ctx.sb, acc);
        for (const p of list.slice(-10)) {
          const ins = await postInsights(token, String(p.id));
          // Seules les mesures reçues remplacent les anciennes (une réponse partielle n'efface rien).
          if (ins) Object.assign(p, Object.fromEntries(Object.entries(ins).filter(([, v]) => v !== undefined)), { insAt: now });
        }
      }
      next = { at: now, ok: now, why: null, posts: list };
    }
  }
  const { error } = await ctx.sb.from("collabs").update({ ig: next }).eq("id", col.id);
  if (error) console.error("ig-sync collabs", col.id, error.message);
  return next;
}

// ── 3. Marques ───────────────────────────────────────────────────────────────
/** À rafraîchir ? 7 j si trouvée, 30 j si compte perso / nom invalide, 1 j sinon. */
function brandStale(ig: Json | null): boolean {
  if (!ig?.at) return true;
  const why = String(ig.why ?? "");
  const wait = !why ? 7 : why === "compte_perso" || why === "nom_invalide" ? 30 : 1;
  return age(ig.at) > wait * DAY - 3600000;
}

async function syncContact(ctx: Ctx, ct: ContactRow): Promise<Json> {
  const prev = (ct.ig ?? {}) as Json;
  const now = new Date().toISOString();
  const h = igUser(ct.instagram);
  let next: Json;
  if (!h) next = { at: now, why: "nom_invalide" };
  else {
    const r = await profileOf(ctx, h);
    if (!r.ok) next = { ...prev, at: now, why: r.why };
    else {
      const p = r.profile;
      const last12 = p.media.slice(0, 12);
      next = {
        at: now, ok: now, why: null, username: p.username, name: p.name, website: p.website,
        followers: p.followers, posts: p.posts, er: engagementRate(last12, p.followers), perWeek: postsPerWeek(last12),
        lastPost: p.media[0] ? { at: p.media[0].at, url: p.media[0].url } : null,
      };
    }
  }
  const { error } = await ctx.sb.from("contacts").update({ ig: next }).eq("id", ct.id);
  if (error) console.error("ig-sync contacts", ct.id, error.message);
  return next;
}

// ── Chargements communs ──────────────────────────────────────────────────────
async function loadShared(ctx: Ctx) {
  const [acc, brands] = await Promise.all([
    ctx.sb.from("ig_accounts").select("creator_id, ig_user_id, username, token, expires_at, refreshed_at"),
    ctx.sb.from("contacts").select("brand, instagram").not("instagram", "is", null),
  ]);
  for (const a of (acc.data as IgAccount[] | null) ?? []) ctx.accounts.set(a.creator_id, a);
  for (const b of (brands.data as { brand: string; instagram: string }[] | null) ?? []) {
    const u = igUser(b.instagram);
    if (!u) continue;
    const k = norm(b.brand ?? "").trim();
    ctx.brandHandles.set(k, [...new Set([...(ctx.brandHandles.get(k) ?? []), u])]);
  }
}
const sameName = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

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

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const res = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return res({ error: "methode" }, 405);

  const sb = getServiceClient();
  if (!(await caller(req, sb))) return res({ error: "non_autorise" }, 401);
  let body: { scope?: string; id?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    body = {};
  }
  if (!metaReady()) return res({ error: "meta_non_configure" });

  const ctx: Ctx = { sb, stop: "", t0: Date.now(), profiles: new Map(), accounts: new Map(), brandHandles: new Map() };
  await loadShared(ctx);
  const id = typeof body.id === "string" ? body.id : "";

  // ── Une seule fiche (bouton « Actualiser ») ──
  if (body.scope === "creator" && id) {
    const { data: c, error } = await sb.from("creators").select(CREATOR_COLS).eq("id", id).maybeSingle<CreatorRow>();
    if (error || !c) return res({ error: error ? "migration_manquante" : "introuvable" }, error ? 500 : 404);
    const ig = await syncCreator(ctx, c);
    const { data: cols } = await sb.from("collabs").select(COLLAB_COLS).in("status", ["active", "gagnee"]).gte("step", 4);
    for (const col of ((cols as CollabRow[] | null) ?? []).filter((x) => sameName(x.creator, c.name))) await syncCollab(ctx, col, c);
    return res({ ig, stopped: ctx.stop || undefined, quota: await saveUsage(sb) });
  }
  if (body.scope === "collab" && id) {
    const { data: col, error } = await sb.from("collabs").select(COLLAB_COLS).eq("id", id).maybeSingle<CollabRow>();
    if (error || !col) return res({ error: error ? "migration_manquante" : "introuvable" }, error ? 500 : 404);
    const { data: cs } = await sb.from("creators").select(CREATOR_COLS).ilike("name", (col.creator ?? "").trim() || "∅");
    const ig = await syncCollab(ctx, col, ((cs as CreatorRow[] | null) ?? [])[0]);
    return res({ ig, stopped: ctx.stop || undefined, quota: await saveUsage(sb) });
  }
  if (body.scope === "contact" && id) {
    const { data: ct, error } = await sb.from("contacts").select("id, brand, instagram, ig").eq("id", id).maybeSingle<ContactRow>();
    if (error || !ct) return res({ error: error ? "migration_manquante" : "introuvable" }, error ? 500 : 404);
    const ig = await syncContact(ctx, ct);
    return res({ ig, stopped: ctx.stop || undefined, quota: await saveUsage(sb) });
  }

  // ── Passage complet (cron) ──
  const { data: cr, error: crErr } = await sb.from("creators").select(CREATOR_COLS);
  if (crErr) return res({ error: "migration_manquante", detail: crErr.message }, 500);
  const creators = ((cr as CreatorRow[] | null) ?? []).filter((c) => (c.status ?? "actif").toLowerCase() !== "inactif");
  // Les plus anciennes d'abord : si le temps manque, les suivantes passent demain en tête.
  creators.sort((a, b) => age(b.ig?.at) - age(a.ig?.at));
  const nCreators = await each(ctx, creators, (c) => syncCreator(ctx, c));

  const { data: cols } = await sb.from("collabs").select(COLLAB_COLS).in("status", ["active", "gagnee"]).gte("step", 4)
    .gte("created_at", new Date(Date.now() - 365 * DAY).toISOString());
  const byName = new Map(creators.map((c) => [c.name.trim().toLowerCase(), c]));
  const nCollabs = await each(ctx, (cols as CollabRow[] | null) ?? [], (col) => syncCollab(ctx, col, byName.get((col.creator ?? "").trim().toLowerCase())));

  const { data: cts } = await sb.from("contacts").select("id, brand, instagram, ig").not("instagram", "is", null);
  const brands = ((cts as ContactRow[] | null) ?? []).filter((c) => igUser(c.instagram) && brandStale(c.ig));
  brands.sort((a, b) => age(b.ig?.at) - age(a.ig?.at));
  const nContacts = await each(ctx, brands.slice(0, BRANDS_PER_RUN), (ct) => syncContact(ctx, ct));

  const out = { creators: nCreators, collabs: nCollabs, contacts: nContacts, stopped: ctx.stop || undefined, ms: Date.now() - ctx.t0 };
  console.log("ig-sync", JSON.stringify(out));
  return res({ ...out, quota: await saveUsage(sb) });
});
