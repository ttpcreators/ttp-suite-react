// ============================================================================
// ig-inbox/index.ts : les messages privés (DM) du compte Instagram de TTP.
// ----------------------------------------------------------------------------
// Toutes les heures (pg_cron) ou bouton « Actualiser » de la page DM Instagram :
//   1. lit les conversations récentes du compte TTP (API Messenger pour Instagram,
//      jeton de la Page liée) et leurs 20 derniers messages (limite Meta)
//      → ig_threads + ig_messages (recherche dans l'app) ;
//   2. note les emails donnés par l'interlocuteur (ig_threads.emails) ;
//   3. relie chaque conversation à la fiche contact qui porte le même @Instagram,
//      remplit l'email de la fiche s'il manque, et ajoute au journal de prospection
//      (contacts.touches) une touche par jour d'échange : canal Instagram.
// Le Radar à marques (page Sourcing) met de côté les marques déjà en conversation.
// { users: [id Instagram…] } : lecture ciblée de ces conversations seulement (appelé
// par ig-webhook à chaque nouveau message : marche aussi avant la validation Meta pour
// les comptes qui ont un rôle sur l'app, ce qui sert à la démo de l'App Review).
// Conservation : conversations et messages de plus de 3 ans supprimés (politique de
// confidentialité, ttpcreators.pro/confidentialite).
//
// À régler une fois : permissions instagram_manage_messages + pages_manage_metadata
// sur le jeton de l'utilisateur système, et dans l'app Instagram de TTP :
// Paramètres → Messages → Outils connectés → « Autoriser l'accès aux messages ».
// AUTH : verify_jwt = false (config.toml) ; Bearer CRON_SECRET (cron) OU JWT agence.
// ============================================================================

import { CRON_SECRET, corsHeaders, getServiceClient, timingSafeEqualStr } from "../_shared/google.ts";
import { GRAPH, META_IG_ID, getJson, graphWhy, igUser, metaReady, ownAccount, pageAccess, postGraph, saveState, saveUsage, storePicture } from "../_shared/instagram.ts";
import { dmTouches, NO_TEXT, type DmMsg, type Touch } from "../_shared/inbox.ts";
import { emailsIn } from "../_shared/signals.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const PAGE_SIZE = 25; // conversations par demande (liste seule : rapide)
const MAX_PAGES = 6; // 150 conversations max par passage
const PROFILES_PER_RUN = 20; // fiches (nom, photo, abonnés) lues par passage
const BUDGET_MS = 100_000; // au-delà, la suite au passage suivant (les fonctions sont coupées à 150 s)
const MSG_FIELDS = "id,created_time,from,to,message";

type GraphError = { code?: number; error_subcode?: number; message?: string };
type Person = { id?: string; username?: string; name?: string };
type Conv = { id: string; updated_time?: string; participants?: { data?: Person[] }; messages?: { data?: (Person & { created_time?: string; message?: string; from?: Person })[] } };
type ThreadRow = { id: string; username: string | null; contact_id: string | null; emails: string[] | null; picture: string | null; updated_at: string | null };
type ContactRow = { id: string; instagram: string | null; email: string | null; touches: unknown; last_contacted: string | null };

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

const enc = encodeURIComponent;

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const res = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return res({ error: "methode" }, 405);

  const sb = getServiceClient();
  const who = await caller(req, sb);
  if (!who) return res({ error: "non_autorise" }, 401);
  const probe = await sb.from("ig_threads").select("id").limit(1);
  if (probe.error) return res({ error: "migration_manquante" });
  if (!metaReady()) return res({ error: "meta_non_configure" });
  let body: { users?: unknown } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    body = {};
  }
  const targets = Array.isArray(body.users) ? [...new Set(body.users.map(String).filter((x) => /^\d{5,25}$/.test(x)))].slice(0, 10) : [];
  const stateKey = targets.length ? "inbox_direct" : "inbox";
  // En attente de la validation Meta : le cron ne réessaie qu'une fois par jour (le bouton, toujours).
  if (who === "cron" && !targets.length) {
    const { data: st } = await sb.from("ig_sync_state").select("data, at").eq("key", "inbox").maybeSingle<{ data: { why?: string }; at: string }>();
    if (st?.data?.why === "meta_validation" && Date.now() - Date.parse(st.at) < 24 * 3600e3) return res({ ok: false, skipped: "meta_validation" });
  }
  const t0 = Date.now();
  const fail = async (why: string, detail?: string) => {
    console.log("ig-inbox échec", why, detail ?? "");
    await saveState(sb, stateKey, { ok: false, why, detail: detail ?? null });
    return res({ error: why, detail, quota: await saveUsage(sb) });
  };

  // 1. Jeton de la Page liée au compte TTP, et le @ de TTP (pour savoir qui parle).
  const page = await pageAccess();
  if (!page.ok) return fail(page.why, page.detail);
  const me = await ownAccount(page.token);
  const meUser = me?.username ?? "";
  const isMe = (p?: Person) => !!p && (p.id === META_IG_ID || (!!meUser && (p.username ?? "").toLowerCase() === meUser));

  // Réception en direct (ig-webhook) : la Page doit avoir l'app installée. Une fois suffit.
  if (!targets.length) {
    const { data: st } = await sb.from("ig_sync_state").select("data").eq("key", "webhook").maybeSingle<{ data: { subscribed?: boolean } }>();
    if (!st?.data?.subscribed) {
      // Les messages Instagram arrivent par l'objet « Instagram » réglé dans le tableau de bord
      // Meta ; la Page n'a qu'à avoir l'app installée. Le champ Page « messages » est celui de
      // Messenger (autorisation pages_messaging, que l'app n'a pas) : on installe l'app avec un
      // champ Page sans bruit (« name », puis « feed » en secours), couverts par pages_manage_metadata.
      let sub: Record<string, unknown> = {};
      let used = "";
      for (const fields of ["name", "feed"]) {
        sub = await postGraph(`${page.pageId}/subscribed_apps`, { subscribed_fields: fields }, page.token);
        used = fields;
        if (!sub.error && sub.success) break;
      }
      await saveState(sb, "webhook", {
        subscribed: !sub.error && !!sub.success,
        fields: used,
        detail: sub.error ? (sub.error as GraphError).message ?? "erreur" : null,
      });
    }
  }

  // 2. Conversations récentes (liste seule, sans les messages : Meta met trop de temps
  //    à tout renvoyer d'un coup). On s'arrête dès qu'une page entière n'a rien de neuf.
  const { data: knownRaw } = await sb.from("ig_threads").select("id, username, contact_id, emails, picture, updated_at");
  const known = new Map(((knownRaw as ThreadRow[] | null) ?? []).map((t) => [t.id, t]));
  let url: string | null = targets.length ? null : `${GRAPH}/${page.pageId}/conversations?platform=instagram&limit=${PAGE_SIZE}&fields=${enc("id,updated_time,participants")}&access_token=${enc(page.token)}`;
  const todo: Conv[] = [];
  // Lecture ciblée : la conversation de chaque compte signalé par le webhook.
  for (const uid of targets) {
    const one = await getJson(`${GRAPH}/${page.pageId}/conversations?platform=instagram&user_id=${enc(uid)}&fields=${enc("id,updated_time,participants")}&access_token=${enc(page.token)}`, 20_000);
    if (one.error) {
      const e = one.error as GraphError;
      console.log("ig-inbox ciblé", uid, e.code, e.message);
      continue;
    }
    for (const conv of (one.data as Conv[] | undefined) ?? []) if (!todo.some((c) => c.id === conv.id)) todo.push(conv);
  }
  for (let n = 0; url && n < MAX_PAGES && Date.now() - t0 < 40_000; n++) {
    const body = await getJson(url, 30_000);
    if (body.error) {
      const e = body.error as GraphError;
      // Code -2 « Timeout » (sous-code 2534084) : trop de conversations avec des comptes sans rôle
      // sur l'app → Meta exige l'accès avancé à instagram_manage_messages (App Review).
      const why = e.message === "reseau" ? "reseau" : e.code === -2 || e.error_subcode === 2534084 ? "meta_validation" : graphWhy(e).why;
      if (n === 0) return fail(why, `liste des conversations : ${e.message === "reseau" ? "pas de réponse de Meta en 30 s" : `${e.message ?? ""} (code ${e.code ?? "?"}${e.error_subcode ? `/${e.error_subcode}` : ""})`}`);
      break;
    }
    const list = (body.data as Conv[] | undefined) ?? [];
    let fresh = 0;
    for (const conv of list) {
      const prev = known.get(conv.id);
      if (prev?.updated_at && conv.updated_time && Date.parse(prev.updated_at) >= Date.parse(conv.updated_time)) continue;
      fresh++;
      todo.push(conv);
    }
    if (!fresh) break;
    url = ((body.paging as { next?: string } | undefined)?.next) ?? null;
  }

  //    Puis les 20 derniers messages de chaque conversation nouvelle ou modifiée, 3 à la
  //    fois, les plus récentes d'abord. Ce qui ne tient pas dans le temps : au passage suivant.
  const changed: { conv: Conv; other: Person; msgs: DmMsg[] }[] = [];
  let skipped = 0;
  const readOne = async (conv: Conv) => {
    const body = await getJson(`${GRAPH}/${conv.id}?fields=${enc(`messages.limit(20){${MSG_FIELDS}}`)}&access_token=${enc(page.token)}`, 25_000);
    if (body.error) {
      skipped++;
      return;
    }
    let raw = ((body.messages as Conv["messages"]) ?? {}).data ?? [];
    // Si Meta ne détaille pas les messages, on les lit un par un.
    if (raw.length && raw.every((m) => m.message === undefined && !m.from)) {
      const full = await Promise.all(raw.slice(0, 20).map((m) => getJson(`${GRAPH}/${m.id}?fields=${MSG_FIELDS}&access_token=${enc(page.token)}`)));
      raw = full.filter((m) => !m.error) as typeof raw;
    }
    const other = (conv.participants?.data ?? []).find((p) => !isMe(p)) ?? {};
    const msgs: DmMsg[] = raw
      .filter((m) => m.id && m.created_time)
      .map((m) => ({ id: String(m.id), at: new Date(String(m.created_time)).toISOString(), me: isMe(m.from), text: String(m.message ?? "").trim() || NO_TEXT }));
    changed.push({ conv, other, msgs });
  };
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      if (Date.now() - t0 > BUDGET_MS - 30_000) {
        skipped += todo.length - next;
        next = todo.length;
        return;
      }
      await readOne(todo[next++]);
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  // 3. Enregistre conversations et messages.
  const now = new Date().toISOString();
  let saved = 0;
  for (const { conv, other, msgs } of changed) {
    const prev = known.get(conv.id);
    const username = igUser(other.username).toLowerCase() || prev?.username || null;
    const last = [...msgs].sort((a, b) => b.at.localeCompare(a.at))[0];
    const emails = [...new Set([...(prev?.emails ?? []), ...msgs.filter((m) => !m.me).flatMap((m) => emailsIn(m.text))])].slice(0, 10);
    const row = {
      id: conv.id, username, igsid: other.id ?? null,
      updated_at: conv.updated_time ? new Date(conv.updated_time).toISOString() : last?.at ?? now,
      last_text: last ? last.text.slice(0, 300) : null, last_from_me: last ? last.me : null,
      emails, synced_at: now,
    };
    const { error } = await sb.from("ig_threads").upsert(row);
    if (error) continue;
    if (msgs.length) await sb.from("ig_messages").upsert(msgs.map((m) => ({ id: m.id, thread_id: conv.id, at: m.at, me: m.me, text: m.text.slice(0, 4000) })));
    known.set(conv.id, { id: conv.id, username, contact_id: prev?.contact_id ?? null, emails, picture: prev?.picture ?? null, updated_at: row.updated_at });
    saved++;
  }

  // 4. Fiche de l'interlocuteur (nom, photo, abonnés) pour les nouvelles conversations.
  const noPic = changed.filter(({ conv, other }) => other.id && !known.get(conv.id)?.picture).slice(0, PROFILES_PER_RUN);
  await Promise.all(noPic.map(async ({ conv, other }) => {
    const p = await getJson(`${GRAPH}/${other.id}?fields=name,username,profile_pic,follower_count&access_token=${enc(page.token)}`);
    if (p.error) return;
    const user = igUser(String(p.username ?? "")).toLowerCase() || known.get(conv.id)?.username || "";
    const pic = user && p.profile_pic ? await storePicture(sb, user, String(p.profile_pic)) : { url: null };
    const patch: Record<string, unknown> = { name: p.name ? String(p.name) : null, followers: typeof p.follower_count === "number" ? p.follower_count : null };
    if (user) patch.username = user;
    if (pic.url) patch.picture = pic.url;
    await sb.from("ig_threads").update(patch).eq("id", conv.id);
  }));

  // 5. Fiches contact : même @Instagram → conversation reliée, email, journal de prospection.
  const { data: ctRaw } = await sb.from("contacts").select("id, instagram, email, touches, last_contacted").not("instagram", "is", null);
  const contacts = (ctRaw as ContactRow[] | null) ?? [];
  const byHandle = new Map<string, ContactRow>();
  for (const c of contacts) {
    const u = igUser(c.instagram).toLowerCase();
    if (u && !byHandle.has(u)) byHandle.set(u, c);
  }
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const { data: allThreads } = await sb.from("ig_threads").select("id, username, contact_id, emails, picture, updated_at");
  const pairs: { t: ThreadRow; c: ContactRow }[] = [];
  for (const t of (allThreads as ThreadRow[] | null) ?? []) {
    const c = (t.contact_id && byId.get(t.contact_id)) || (t.username ? byHandle.get(t.username) : undefined);
    if (c) pairs.push({ t, c });
  }
  let linked = 0;
  let touchesAdded = 0;
  let emailsAdded = 0;
  for (let i = 0; i < pairs.length; i += 50) {
    const chunk = pairs.slice(i, i + 50);
    const { data: msgRaw } = await sb.from("ig_messages").select("id, thread_id, at, me, text").in("thread_id", chunk.map((p) => p.t.id)).order("at");
    const msgsOf = new Map<string, DmMsg[]>();
    for (const m of (msgRaw as (DmMsg & { thread_id: string })[] | null) ?? []) {
      const l = msgsOf.get(m.thread_id) ?? [];
      l.push(m);
      msgsOf.set(m.thread_id, l);
    }
    for (const { t, c } of chunk) {
      if (!t.contact_id) {
        const { error } = await sb.from("ig_threads").update({ contact_id: c.id }).eq("id", t.id);
        if (!error) linked++;
      }
      const existing: Touch[] = Array.isArray(c.touches) ? (c.touches as Touch[]) : [];
      const add = dmTouches(t.id, msgsOf.get(t.id) ?? [], existing, c.last_contacted);
      const patch: Record<string, unknown> = {};
      if (add.length) {
        const next = [...add.reverse(), ...existing];
        patch.touches = next;
        const newest = Math.max(...add.map((x) => Date.parse(x.date)));
        if (!c.last_contacted || newest > Date.parse(c.last_contacted)) patch.last_contacted = new Date(newest).toISOString();
      }
      if (!c.email?.trim() && t.emails?.length) patch.email = t.emails[0];
      if (!Object.keys(patch).length) continue;
      const { error } = await sb.from("contacts").update(patch).eq("id", c.id);
      if (error) continue;
      if (patch.touches) {
        c.touches = patch.touches;
        touchesAdded += add.length;
      }
      if (patch.last_contacted) c.last_contacted = patch.last_contacted as string;
      if (patch.email) {
        c.email = patch.email as string;
        emailsAdded++;
      }
    }
  }

  // 6. Conservation : rien au-delà de 3 ans après le dernier échange.
  if (!targets.length) {
    const limit = new Date(Date.now() - 3 * 365 * 86400000).toISOString();
    await sb.from("ig_threads").delete().lt("updated_at", limit);
    await sb.from("ig_messages").delete().lt("at", limit);
  }

  const out = { ok: true, threads: changed.length, left: skipped, saved, linked, touches: touchesAdded, emails: emailsAdded, me: meUser || null, ms: Date.now() - t0 };
  await saveState(sb, stateKey, out);
  console.log("ig-inbox", JSON.stringify(out));
  return res({ ...out, quota: await saveUsage(sb) });
});
