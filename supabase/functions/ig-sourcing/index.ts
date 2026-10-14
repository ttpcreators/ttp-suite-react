// ============================================================================
// ig-sourcing/index.ts : Sourcing de créatrices + Radar à marques (page Sourcing).
// ----------------------------------------------------------------------------
// Toujours via l'outil officiel de Meta (_shared/instagram.ts, comptes PRO) :
//   { mode: "brand", brand: "@gymshark" } → les @ cités dans les 50 derniers posts
//      de la marque (les créatrices avec qui elle travaille), avec leurs chiffres.
//   { mode: "list", handles: [...] } → chiffres d'une liste de @ (30 max par appel).
//   { mode: "similar", creator: "@lea" } → les créatrices qui travaillent avec les
//      mêmes marques qu'elle (« Comme une créatrice »).
// Pour chaque profil : email (bio, sinon page du lien en bio), indice « déjà en
// agence », marques déjà citées en partenariat payé. Chaque réponse inclut le
// relevé du quota Meta (quota), aussi gardé dans ig_quota.
//   { mode: "scan" } (cron chaque nuit, ou bouton « Lancer le radar ») : lit les
//      derniers posts des créatrices du roster et du Scouting, note les marques
//      qu'elles citent (payé ou non), puis lit le profil de ces marques → ig_radar.
// Profils lus gardés dans ig_profiles (7 jours) : on ne redemande pas à Meta.
//
// AUTH : verify_jwt = false (config.toml) ; Bearer CRON_SECRET (cron) OU JWT agence.
// ============================================================================

import { CRON_SECRET, corsHeaders, getServiceClient, timingSafeEqualStr } from "../_shared/google.ts";
import { discover, engagementRate, igUser, metaReady, postsPerWeek, quotaPct, saveUsage, type IgProfile } from "../_shared/instagram.ts";
import { handleCandidates, isCommonWord } from "../_shared/mentions.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type Json = Record<string, unknown>;
type ProfileRow = { username: string; data: Json | null; why: string | null; scanned_at: string | null; at: string };
type RadarPost = { c: string; roster: boolean; url: string; at: string; paid: boolean; likes: number | null; comments: number; cap: string };

const DAY = 86400000;
const FRESH_DAYS = 7;
// Le radar lit autant qu'il peut tant que le quota Meta reste sous QUOTA_MAX % (voir inBudget),
// dans la limite de ces plafonds par passage.
const POOL_PER_SCAN = 40; // créatrices du Scouting lues par passage (les plus anciennes d'abord)
const BRANDS_PER_SCAN = 80; // comptes cités vérifiés par passage (les plus probables d'abord)
const QUOTA_MAX = 80; // au-delà, pause : on ne risque pas le blocage par Meta (le cron des 2 h envoie 60)
const DISCOVER_PER_SCAN = 40; // créatrices hors agence lues par passage (découvertes)
const age = (iso: string | null | undefined) => (iso ? Date.now() - Date.parse(iso) : Infinity);

/** Mots qui signalent un partenariat payé dans une légende. */
const PAID = /#(ad|ads|pub|publicite|publicité|sponsor|sponsorise|sponsorisé|sponsored|partenariat|partenariatremunere|partenariatrémunéré|partnership|collab|collaboration|gifted|ambassador|ambassadrice)(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}])publicit[ée](?![\p{L}\p{N}])|collaboration commerciale|partenariat commercial|code promo|avec le code|code\s*:|-\s?\d{1,2}\s?%|en partenariat|partenariat r[ée]mun[ée]r[ée]|paid partnership|sponsoris[ée] par|offert par/iu;
// Cadeau ou code promo : « (produit offert) », « 10 % de réduction », « avec MARGOT10 ».
const GIFT = /produits?\s+offerts?|\(offert\)|cadeau de|envoy[ée]s? par|\d{1,2}\s?%\s?(de\s)?(r[ée]duction|remise|off)|lien affili|affiliate/iu;
const PROMO_CODE = /\b(code|avec|with)\s+[A-Z][A-Z0-9]{3,}\b/u; // majuscules : un code, pas un mot
/** Le post montre une relation commerciale avec une marque (payé, offert, code promo). */
const isPaid = (caption: string) => PAID.test(caption) || GIFT.test(caption) || PROMO_CODE.test(caption);

/** Comptes cités dans un texte (Meta retire les @ : voir _shared/mentions.ts), poids ≥ `min`. */
const KNOWN = new Set<string>(); // marques déjà connues : contacts, radar (rempli par loadKnown)
function cited(caption: string, min = 2): { u: string; w: number }[] {
  return handleCandidates(caption, KNOWN, isPaid(caption)).filter((c) => c.w >= min);
}
/** Poids d'un compte dans un texte (0 = pas cité). */
function citedAll(caption: string): Map<string, number> {
  return new Map(handleCandidates(caption, KNOWN, isPaid(caption)).map((c) => [c.u, c.w]));
}

const LINK_IN_BIO = /(linktr\.ee|beacons\.ai|linkin\.bio|lnk\.bio|solo\.to|campsite\.bio|bio\.site|tap\.bio|msha\.ke|hoo\.be|snipfeed|stan\.store|allmylinks|linkbio|later\.com|flowcode|komi\.io|direct\.me|instabio)/i;
const BRANDISH = /(shop|store|boutique|officiel|official|marque|brand|livraison|delivery|e-?shop|collection|®|™|since \d{4}|depuis \d{4}|made in|fabriqué|cosm[eé]ti|skincare|nutrition|restaurant|hôtel|hotel|studio|maison|atelier|paris \d|\.com|\.fr)/i;
const PERSONISH = /(she\/her|il\/lui|elle\/she|maman|mum|mom|ugc|influenc|créatrice|creatrice|content creator|créateur de contenu|collab ?(dm|📩)|contact pro|management|📍)/i;

/** Devine si un compte est une marque (score ≥ 2) : site, bio, ratio abonnés/abonnements. */
function brandScore(p: IgProfile): number {
  let s = 0;
  if (p.website && !LINK_IN_BIO.test(p.website)) s += 2;
  if (BRANDISH.test(`${p.name} ${p.bio}`)) s += 1;
  if (p.followers >= 3000 && p.following * 5 < p.followers) s += 1;
  if (PERSONISH.test(p.bio)) s -= 2;
  return s;
}

// ── Email et agence : dans la bio, puis sur le lien du profil (Linktree, site) ──
const DATA_V = 3; // version des données gardées : la monter fait relire les profils
const FREE_MAIL = /@(gmail|googlemail|hotmail|outlook|live|icloud|me|yahoo|orange|free|sfr|laposte|wanadoo|proton|protonmail|gmx)\./i;
const AGENCY = /(management|mgmt|managed by|g[ée]r[ée]e? par|repr[ée]sent[ée]e? par|represented by|\bagence\b|\bagency\b|\bagent\s*:|booking|talent manager|@[a-z0-9._]*(agency|agence|mgmt|management|talents?)\b)/i;
/** Indice « déjà en agence » (le passage trouvé), ou null. */
function agencyHint(text: string, email: string): string | null {
  const m = AGENCY.exec(text);
  if (m) return text.slice(Math.max(0, m.index - 25), m.index + m[0].length + 25).replace(/\s+/g, " ").trim();
  const domain = email.split("@")[1] ?? "";
  if (email && !FREE_MAIL.test(email) && /(agency|agence|mgmt|management|talent|booking)/i.test(domain)) return email;
  return null;
}
/** Emails d'un texte, les plus « pro » d'abord (collab, contact, booking…). */
function emailsIn(text: string): string[] {
  const all = [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((m) => m[0].toLowerCase())
    .filter((e) => !/\.(png|jpe?g|gif|webp|svg|css|js)$/.test(e) && !/(example|sentry|wixpress|domain|email)\./.test(e));
  const uniq = [...new Set(all)];
  return uniq.sort((a, b) => Number(/(collab|contact|booking|partenariat|business|hello|pr)/.test(b)) - Number(/(collab|contact|booking|partenariat|business|hello|pr)/.test(a)));
}
/** Pas d'adresse interne (anti-rebond vers le réseau du serveur). */
function safeHost(h: string): boolean {
  const host = h.toLowerCase();
  if (host === "localhost" || /\.(local|internal|localhost)$/.test(host)) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":") || host.startsWith("[")) return false;
  return host.includes(".");
}
/** Texte de la page du lien en bio (6 s max, 2 Mo max, 3 redirections). */
async function siteText(raw: string): Promise<string> {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return "";
  }
  for (let hop = 0; hop < 4; hop++) {
    if (!/^https?:$/.test(u.protocol) || !safeHost(u.hostname)) return "";
    let r: Response;
    try {
      r = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(6000), headers: { "User-Agent": "Mozilla/5.0 (compatible; TTPCreators/1.0)", Accept: "text/html" } });
    } catch {
      return "";
    }
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      await r.body?.cancel();
      if (!loc) return "";
      try {
        u = new URL(loc, u);
      } catch {
        return "";
      }
      continue;
    }
    const type = r.headers.get("content-type") ?? "";
    if (!r.ok || !type.includes("text/html") || Number(r.headers.get("content-length") ?? 0) > 2_000_000) {
      await r.body?.cancel();
      return "";
    }
    const html = new TextDecoder().decode((await r.arrayBuffer()).slice(0, 2_000_000));
    const mailtos = [...html.matchAll(/mailto:([^"'?>\s]+)/gi)].map((m) => decodeURIComponent(m[1]));
    return `${mailtos.join(" ")} ${html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ")}`;
  }
  return "";
}

/** Chiffres utiles d'un profil (gardés dans ig_profiles.data), + email et indice d'agence. */
async function toData(p: IgProfile): Promise<Json> {
  const last12 = p.media.slice(0, 12);
  const score = brandScore(p);
  let email = emailsIn(p.bio)[0] ?? "";
  let emailFrom = email ? "bio" : "";
  let agency = agencyHint(`${p.name} ${p.bio}`, email);
  if (p.website && (!email || !agency)) {
    const text = await siteText(p.website);
    if (text) {
      const siteEmail = emailsIn(text)[0] ?? "";
      if (!email && siteEmail) {
        email = siteEmail;
        emailFrom = "lien";
      }
      agency = agency ?? agencyHint(text.slice(0, 20000), siteEmail);
    }
  }
  // Marques citées dans ses posts : « payé » (#ad, code promo…) = elle a déjà fait des partenariats.
  const me = p.username.toLowerCase();
  const deals = new Set<string>();
  const cites = new Set<string>();
  for (const m of p.media) {
    for (const { u } of cited(m.caption, 3)) {
      if (u === me) continue;
      cites.add(u);
      if (isPaid(m.caption)) deals.add(u);
    }
  }
  return {
    v: DATA_V, name: p.name, followers: p.followers, following: p.following, posts: p.posts,
    deals: [...deals].slice(0, 8), cites: [...cites].slice(0, 15),
    er: last12.length ? engagementRate(last12, p.followers) : null,
    perWeek: last12.length ? postsPerWeek(last12) : null,
    lastPost: p.media[0]?.at ?? null,
    bio: p.bio.slice(0, 300), website: p.website, email, emailFrom, agency,
    picture: p.picture, brandScore: score, isBrand: score >= 2,
  };
}

type Ctx = { sb: SupabaseClient; stop: string; t0: number; cache: Map<string, ProfileRow>; quotaMax: number };
function inBudget(ctx: Ctx): boolean {
  if (!ctx.stop && (quotaPct() ?? 0) >= ctx.quotaMax) ctx.stop = "quota_proche";
  return !ctx.stop && Date.now() - ctx.t0 < 110_000;
}

/** Profil d'un @ : depuis ig_profiles s'il est frais, sinon demandé à Meta (et gardé). */
async function profile(ctx: Ctx, user: string, mediaLimit: number, force = false): Promise<{ row: ProfileRow; media?: IgProfile["media"] }> {
  const u = user.toLowerCase();
  const known = ctx.cache.get(u);
  const freshDays = known?.why === "compte_perso" ? 30 : FRESH_DAYS;
  const current = !!known && (!!known.why || known.data?.v === DATA_V);
  if (!force && known && current && age(known.at) < freshDays * DAY) return { row: known };
  if (ctx.stop) return { row: known ?? { username: u, data: null, why: ctx.stop, scanned_at: null, at: new Date().toISOString() } };
  const r = await discover(u, mediaLimit);
  const now = new Date().toISOString();
  if (!r.ok) {
    if (r.stop) ctx.stop = r.why;
    const row: ProfileRow = { username: u, data: known?.data ?? null, why: r.why, scanned_at: known?.scanned_at ?? null, at: now };
    if (!r.stop && r.why !== "reseau") {
      ctx.cache.set(u, row);
      await ctx.sb.from("ig_profiles").upsert({ username: u, data: row.data, why: row.why, at: now });
    }
    return { row };
  }
  const row: ProfileRow = { username: u, data: await toData(r.profile), why: null, scanned_at: known?.scanned_at ?? null, at: now };
  ctx.cache.set(u, row);
  await ctx.sb.from("ig_profiles").upsert({ username: u, data: row.data, why: null, at: now });
  return { row, media: r.profile.media };
}

/** Applique `fn` à chaque élément, 4 à la fois, tant qu'il reste du temps. */
async function each<T>(ctx: Ctx, items: T[], fn: (t: T) => Promise<unknown>) {
  let i = 0;
  const worker = async () => {
    while (i < items.length && inBudget(ctx)) {
      const t = items[i++];
      try {
        await fn(t);
      } catch (e) {
        console.error("ig-sourcing", e);
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

async function loadCache(ctx: Ctx, users: string[]) {
  const list = [...new Set(users.map((u) => u.toLowerCase()))].filter((u) => !ctx.cache.has(u));
  for (let i = 0; i < list.length; i += 200) {
    const { data } = await ctx.sb.from("ig_profiles").select("username, data, why, scanned_at, at").in("username", list.slice(i, i + 200));
    for (const r of (data as ProfileRow[] | null) ?? []) ctx.cache.set(r.username, r);
  }
}

/**
 * Marques déjà connues, reconnues même sans @ dans un texte : contacts avec un @ et
 * marques que l'agence a mises au Pipeline depuis le radar (validées à la main, pour
 * qu'une erreur du radar ne s'auto-entretienne pas). Nettoie au passage le radar des
 * mots courants pris à tort pour une marque (« notre » → @notre).
 */
async function loadKnown(ctx: Ctx) {
  if (KNOWN.size) return;
  const [ct, rd] = await Promise.all([
    ctx.sb.from("contacts").select("instagram").not("instagram", "is", null),
    ctx.sb.from("ig_radar").select("brand, status").limit(5000),
  ]);
  for (const c of (ct.data as { instagram: string | null }[] | null) ?? []) {
    const u = igUser(c.instagram).toLowerCase();
    if (u && !isCommonWord(u)) KNOWN.add(u);
  }
  const rows = (rd.data as { brand: string; status: string }[] | null) ?? [];
  for (const r of rows) if (r.status === "pipeline" && !isCommonWord(r.brand)) KNOWN.add(r.brand);
  const junk = rows.filter((r) => r.status === "nouveau" && isCommonWord(r.brand)).map((r) => r.brand);
  if (junk.length) await ctx.sb.from("ig_radar").delete().in("brand", junk);
}

/** Additionne les poids d'un compte sur plusieurs textes : garde ceux qui atteignent 2. */
function tally(captions: { text: string; at?: string; url?: string }[], skip: Set<string>) {
  const seen = new Map<string, { count: number; weight: number; lastAt: string; url: string }>();
  for (const p of captions) {
    for (const [u, w] of citedAll(p.text)) {
      if (skip.has(u)) continue;
      const cur = seen.get(u);
      if (cur) {
        cur.count++;
        cur.weight += w;
      } else seen.set(u, { count: 1, weight: w, lastAt: p.at ?? "", url: p.url ?? "" });
    }
  }
  return new Map([...seen.entries()].filter(([, v]) => v.weight >= 2));
}

// ── Sourcing : depuis une marque, ou une liste de @ ──────────────────────────
async function fromBrand(ctx: Ctx, brand: string) {
  const b = igUser(brand).toLowerCase();
  if (!b) return { error: "nom_invalide" };
  await loadKnown(ctx);
  await loadCache(ctx, [b]);
  const r = await discover(b, 50);
  if (!r.ok) return { error: r.why };
  const now = new Date().toISOString();
  const brandData = await toData(r.profile);
  await ctx.sb.from("ig_profiles").upsert({ username: b, data: brandData, why: null, at: now });
  // Qui la marque cite (sans @ : voir cited), combien de fois, et quand pour la dernière fois.
  const seen = tally(r.profile.media.map((p) => ({ text: p.caption, at: p.at, url: p.url })), new Set([b]));
  const users = [...seen.entries()].sort((x, y) => y[1].weight - x[1].weight || y[1].count - x[1].count).slice(0, 30).map(([u]) => u);
  await loadCache(ctx, users);
  await each(ctx, users, (u) => profile(ctx, u, 12));
  return {
    brand: { username: b, ...brandData },
    candidates: users.map((u) => ({ username: u, count: seen.get(u)?.count, lastAt: seen.get(u)?.lastAt, url: seen.get(u)?.url, data: ctx.cache.get(u)?.data ?? null, why: ctx.cache.get(u)?.why ?? (ctx.stop || null) })),
    stopped: ctx.stop || undefined,
  };
}

async function fromList(ctx: Ctx, handles: unknown[]) {
  const users = [...new Set(handles.map((h) => igUser(String(h ?? "")).toLowerCase()).filter(Boolean))].slice(0, 30);
  await loadCache(ctx, users);
  await each(ctx, users, (u) => profile(ctx, u, 12));
  return {
    candidates: users.map((u) => ({ username: u, data: ctx.cache.get(u)?.data ?? null, why: ctx.cache.get(u)?.why ?? (ctx.stop || null) })),
    stopped: ctx.stop || undefined,
  };
}

/**
 * « Comme une créatrice » : les marques qu'elle cite (payées d'abord), puis les
 * créatrices que ces marques citent. Plus une créatrice partage de marques avec
 * elle, plus elle lui ressemble (même niche, mêmes clients).
 */
async function similar(ctx: Ctx, creator: string) {
  const c = igUser(creator).toLowerCase();
  if (!c) return { error: "nom_invalide" };
  await loadKnown(ctx);
  await loadCache(ctx, [c]);
  const { row, media } = await profile(ctx, c, 25, true);
  if (!media) return { error: row.why ?? "erreur" };
  // Ses marques : citées dans ses posts (les posts payés comptent double).
  const weight = new Map<string, number>();
  for (const p of media) {
    for (const [m, w] of citedAll(p.caption)) if (m !== c) weight.set(m, (weight.get(m) ?? 0) + w * (isPaid(p.caption) ? 2 : 1));
  }
  const brands = [...weight.entries()].filter(([, w]) => w >= 2).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([b]) => b);
  const via = new Map<string, Set<string>>();
  await each(ctx, brands, async (b) => {
    const r = await discover(b, 50);
    if (!r.ok) {
      if (r.stop) ctx.stop = r.why;
      return;
    }
    const seen = tally(r.profile.media.map((p) => ({ text: p.caption })), new Set([b, c]));
    for (const m of seen.keys()) {
      const set = via.get(m) ?? new Set<string>();
      set.add(b);
      via.set(m, set);
    }
  });
  const users = [...via.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 30).map(([u]) => u);
  await loadCache(ctx, users);
  await each(ctx, users, (u) => profile(ctx, u, 12));
  return {
    creator: { username: c, ...(row.data ?? {}) },
    brands,
    candidates: users.map((u) => ({ username: u, count: via.get(u)?.size ?? 0, via: [...(via.get(u) ?? [])], data: ctx.cache.get(u)?.data ?? null, why: ctx.cache.get(u)?.why ?? (ctx.stop || null) })),
    stopped: ctx.stop || undefined,
  };
}

/**
 * Vérifie un compte cité (est-ce une marque ?) et, si c'en est une, met en file les
 * créatrices qu'elle cite dans ses posts : elles seront lues aux passages suivants
 * (« hors agence »). Le réseau du radar grandit ainsi tout seul. 1 demande Meta.
 */
async function verifyBrand(ctx: Ctx, b: string) {
  const { row, media } = await profile(ctx, b, 12);
  if (!media || !row.data?.isBrand) return;
  const cited = [...tally(media.map((p) => ({ text: p.caption })), new Set([b])).keys()].filter((u) => !ctx.cache.has(u));
  if (!cited.length) return;
  await loadCache(ctx, cited);
  const fresh = cited.filter((u) => !ctx.cache.has(u)).slice(0, 15);
  if (fresh.length) {
    await ctx.sb.from("ig_profiles").upsert(
      fresh.map((u) => ({ username: u, data: { pending: true, from: b }, why: null, at: new Date(0).toISOString() })),
      { onConflict: "username", ignoreDuplicates: true },
    );
  }
}

/**
 * « Vérifier » : lit le profil des comptes du radar pas encore vérifiés (les plus
 * cités d'abord), sans relire les créatrices. S'arrête à QUOTA_MAX % du quota Meta.
 */
async function verify(ctx: Ctx) {
  const { data } = await ctx.sb.from("ig_radar").select("brand, posts").eq("status", "nouveau").limit(5000);
  const rows = (data as { brand: string; posts: unknown[] }[] | null) ?? [];
  await loadCache(ctx, rows.map((r) => r.brand));
  const todo = rows
    .filter((r) => { const k = ctx.cache.get(r.brand); return !k || (!k.why && k.data?.v !== DATA_V); })
    .sort((a, b) => (b.posts?.length ?? 0) - (a.posts?.length ?? 0))
    .slice(0, 150)
    .map((r) => r.brand);
  let verified = 0;
  await each(ctx, todo, async (b) => {
    await verifyBrand(ctx, b);
    verified++;
  });
  return { verified, left: Math.max(0, todo.length - verified), stopped: ctx.stop || undefined };
}

// ── Radar : marques citées par les créatrices ────────────────────────────────
async function scan(ctx: Ctx) {
  const [cr, pool] = await Promise.all([
    ctx.sb.from("creators").select("name, handle, platform, instagram, status"),
    ctx.sb.from("creator_pool").select("handle"),
  ]);
  type C = { name: string; handle: string | null; platform: string | null; instagram: string | null; status: string | null };
  const roster = ((cr.data as C[] | null) ?? [])
    .filter((c) => (c.status ?? "actif").toLowerCase() !== "inactif")
    .map((c) => igUser(c.instagram) || ((c.platform ?? "").toLowerCase().includes("insta") ? igUser(c.handle) : ""))
    .filter(Boolean).map((u) => u.toLowerCase());
  const poolUsers = ((pool.data as { handle: string | null }[] | null) ?? []).map((p) => igUser(p.handle).toLowerCase()).filter(Boolean);
  const ours = new Set([...roster, ...poolUsers, "ttp.creators"]);
  await loadKnown(ctx);
  await loadCache(ctx, [...ours]);
  // Scouting : les moins récemment lues d'abord, 30 par nuit.
  const poolTodo = [...new Set(poolUsers)].filter((u) => !roster.includes(u))
    .sort((a, b) => age(ctx.cache.get(b)?.scanned_at) - age(ctx.cache.get(a)?.scanned_at)).slice(0, POOL_PER_SCAN);
  const rosterSet = new Set(roster);
  // Hors agence : créatrices découvertes (Sourcing, ou citées par les marques du radar),
  // les moins récemment lues d'abord. Les comptes qui s'avèrent être des marques sont sautés.
  const { data: disc } = await ctx.sb.from("ig_profiles").select("username, data, why, scanned_at, at")
    .or("data->>pending.eq.true,data->>isBrand.eq.false").is("why", null)
    .order("scanned_at", { ascending: true, nullsFirst: true }).limit(300);
  const discovered = ((disc as ProfileRow[] | null) ?? [])
    .filter((r) => !ours.has(r.username) && (r.data?.pending || Number(r.data?.followers ?? 0) >= 3000))
    .slice(0, DISCOVER_PER_SCAN);
  for (const r of discovered) if (!ctx.cache.has(r.username)) ctx.cache.set(r.username, r);
  const discoveredSet = new Set(discovered.map((r) => r.username));
  let discoveredRead = 0;

  const found = new Map<string, RadarPost[]>();
  const scanned: string[] = [];
  // Compteurs pour comprendre un radar vide : posts reçus, avec texte, avec un @.
  const diag = { posts: 0, withText: 0, withAt: 0, withName: 0 };
  const weightOf = new Map<string, number>();
  await each(ctx, [...new Set(roster), ...poolTodo, ...discoveredSet], async (u) => {
    const { row, media } = await profile(ctx, u, 25, true);
    if (!media) return;
    scanned.push(u);
    if (discoveredSet.has(u)) {
      if (row.data?.isBrand) return; // une marque, pas une créatrice
      discoveredRead++;
    }
    for (const p of media) {
      diag.posts++;
      if (p.caption.trim()) diag.withText++;
      if (p.caption.includes("@")) diag.withAt++;
      const names = citedAll(p.caption);
      if ([...names.values()].some((w) => w >= 2)) diag.withName++;
      for (const [m, w] of names) {
        if (ours.has(m) || m === u) continue;
        weightOf.set(m, (weightOf.get(m) ?? 0) + w);
        const list = found.get(m) ?? [];
        list.push({ c: u, roster: rosterSet.has(u), url: p.url, at: p.at, paid: isPaid(p.caption), likes: p.likes, comments: p.comments, cap: p.caption.slice(0, 300) });
        found.set(m, list);
      }
    }
  });
  const now = new Date().toISOString();
  if (scanned.length) await ctx.sb.from("ig_profiles").update({ scanned_at: now }).in("username", scanned);

  // Fusion avec le radar existant (un post n'est compté qu'une fois). Un nom vu une
  // seule fois avec un indice faible (poids < 2) n'est pas gardé, sauf s'il est déjà au radar.
  const brands = [...found.keys()].filter((b) => (weightOf.get(b) ?? 0) >= 2 || KNOWN.has(b));
  const existing = new Map<string, { posts: RadarPost[] }>();
  for (let i = 0; i < brands.length; i += 200) {
    const { data } = await ctx.sb.from("ig_radar").select("brand, posts").in("brand", brands.slice(i, i + 200));
    for (const r of (data as { brand: string; posts: RadarPost[] }[] | null) ?? []) existing.set(r.brand, r);
  }
  const rows = brands.map((b) => {
    const byUrl = new Map<string, RadarPost>();
    for (const p of [...(existing.get(b)?.posts ?? []), ...(found.get(b) ?? [])]) byUrl.set(p.url || `${p.c}:${p.at}`, p);
    const posts = [...byUrl.values()].sort((x, y) => y.at.localeCompare(x.at)).slice(0, 40);
    return { brand: b, posts, last_seen: now };
  });
  for (let i = 0; i < rows.length; i += 200) await ctx.sb.from("ig_radar").upsert(rows.slice(i, i + 200));

  // Profil des marques (est-ce vraiment une marque ?), les plus citées d'abord.
  await loadCache(ctx, brands);
  const todo = brands
    .filter((b) => { const k = ctx.cache.get(b); return !k || age(k.at) > (k.why === "compte_perso" ? 30 : FRESH_DAYS) * DAY; })
    .sort((a, b) => (weightOf.get(b) ?? 0) - (weightOf.get(a) ?? 0))
    .slice(0, BRANDS_PER_SCAN);
  await each(ctx, todo, (b) => verifyBrand(ctx, b));
  // Puis les marques en attente des passages précédents, avec le quota qui reste.
  const backlog = inBudget(ctx) ? await verify(ctx) : null;
  return { creators: scanned.length, discovered: discoveredRead, brands: brands.length, profiles: todo.length + (backlog?.verified ?? 0), diag, stopped: ctx.stop || undefined };
}

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
  let body: { mode?: string; brand?: string; creator?: string; handles?: unknown; quota?: number } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    body = {};
  }
  if (!metaReady()) return res({ error: "meta_non_configure" });
  // Seuil de pause : 80 % à la main ; le passage automatique toutes les 2 h envoie 60 pour
  // laisser de la marge aux recherches de l'agence pendant la journée.
  const quotaMax = Math.min(85, Math.max(30, Number(body.quota) || QUOTA_MAX));
  const ctx: Ctx = { sb, stop: "", t0: Date.now(), cache: new Map(), quotaMax };
  // Table absente (SQL pas encore lancé) : on le dit clairement.
  const probe = await sb.from("ig_profiles").select("username").limit(1);
  if (probe.error) return res({ error: "migration_manquante" });

  const done = async (b: Record<string, unknown>) => res({ ...b, quota: await saveUsage(sb) });
  if (body.mode === "brand") return done(await fromBrand(ctx, String(body.brand ?? "")));
  if (body.mode === "list") return done(await fromList(ctx, Array.isArray(body.handles) ? body.handles : []));
  if (body.mode === "similar") return done(await similar(ctx, String(body.creator ?? "")));
  if (body.mode === "verify") return done(await verify(ctx));
  const out = await scan(ctx);
  console.log("ig-sourcing scan", JSON.stringify({ ...out, ms: Date.now() - ctx.t0 }));
  return done(out);
});
