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
//
// À régler une fois : permissions instagram_manage_messages + pages_manage_metadata
// sur le jeton de l'utilisateur système, et dans l'app Instagram de TTP :
// Paramètres → Messages → Outils connectés → « Autoriser l'accès aux messages ».
// AUTH : verify_jwt = false (config.toml) ; Bearer CRON_SECRET (cron) OU JWT agence.
// ============================================================================

import { CRON_SECRET, corsHeaders, getServiceClient, timingSafeEqualStr } from "../_shared/google.ts";
import { GRAPH, META_IG_ID, getJson, graphWhy, igUser, metaReady, ownAccount, pageAccess, saveState, saveUsage, storePicture } from "../_shared/instagram.ts";
import { dmTouches, NO_TEXT, type DmMsg, type Touch } from "../_shared/inbox.ts";
import { emailsIn } from "../_shared/signals.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const PAGE_SIZE = 25; // conversations par demande
const MAX_PAGES = 6; // 150 conversations max par passage
const PROFILES_PER_RUN = 20; // fiches (nom, photo, abonnés) lues par passage
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
  if (!(await caller(req, sb))) return res({ error: "non_autorise" }, 401);
  const probe = await sb.from("ig_threads").select("id").limit(1);
  if (probe.error) return res({ error: "migration_manquante" });
  if (!metaReady()) return res({ error: "meta_non_configure" });
  const t0 = Date.now();
  const fail = async (why: string, detail?: string) => {
    await saveState(sb, "inbox", { ok: false, why, detail: detail ?? null });
    return res({ error: why, detail, quota: await saveUsage(sb) });
  };

  // 1. Jeton de la Page liée au compte TTP, et le @ de TTP (pour savoir qui parle).
  const page = await pageAccess();
  if (!page.ok) return fail(page.why, page.detail);
  const me = await ownAccount(page.token);
  const meUser = me?.username ?? "";
  const isMe = (p?: Person) => !!p && (p.id === META_IG_ID || (!!meUser && (p.username ?? "").toLowerCase() === meUser));

  // 2. Conversations récentes : on s'arrête dès qu'une page entière n'a rien de neuf.
  const { data: knownRaw } = await sb.from("ig_threads").select("id, username, contact_id, emails, picture, updated_at");
  const known = new Map(((knownRaw as ThreadRow[] | null) ?? []).map((t) => [t.id, t]));
  const fields = `id,updated_time,participants,messages.limit(20){${MSG_FIELDS}}`;
  let url: string | null = `${GRAPH}/${page.pageId}/conversations?platform=instagram&limit=${PAGE_SIZE}&fields=${enc(fields)}&access_token=${enc(page.token)}`;
  const changed: { conv: Conv; other: Person; msgs: DmMsg[] }[] = [];
  for (let n = 0; url && n < MAX_PAGES && Date.now() - t0 < 60_000; n++) {
    const body = await getJson(url, 25_000);
    if (body.error) {
      const e = body.error as GraphError;
      if (n === 0) return fail(e.message === "reseau" ? "reseau" : graphWhy(e).why, e.message);
      break;
    }
    const list = (body.data as Conv[] | undefined) ?? [];
    let fresh = 0;
    for (const conv of list) {
      const prev = known.get(conv.id);
      if (prev?.updated_at && conv.updated_time && Date.parse(prev.updated_at) >= Date.parse(conv.updated_time)) continue;
      fresh++;
      const other = (conv.participants?.data ?? []).find((p) => !isMe(p)) ?? {};
      let raw = conv.messages?.data ?? [];
      // Si Meta ne détaille pas les messages dans la liste, on les lit un par un.
      if (raw.length && raw.every((m) => m.message === undefined && !m.from)) {
        const full = await Promise.all(raw.slice(0, 20).map((m) => getJson(`${GRAPH}/${m.id}?fields=${MSG_FIELDS}&access_token=${enc(page.token)}`)));
        raw = full.filter((m) => !m.error) as typeof raw;
      }
      const msgs: DmMsg[] = raw
        .filter((m) => m.id && m.created_time)
        .map((m) => ({ id: String(m.id), at: new Date(String(m.created_time)).toISOString(), me: isMe(m.from), text: String(m.message ?? "").trim() || NO_TEXT }));
      changed.push({ conv, other, msgs });
    }
    if (!fresh) break;
    url = ((body.paging as { next?: string } | undefined)?.next) ?? null;
  }

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

  const out = { ok: true, threads: changed.length, saved, linked, touches: touchesAdded, emails: emailsAdded, me: meUser || null, ms: Date.now() - t0 };
  await saveState(sb, "inbox", out);
  console.log("ig-inbox", JSON.stringify(out));
  return res({ ...out, quota: await saveUsage(sb) });
});
