// ============================================================================
// gmail-poll/index.ts
// ----------------------------------------------------------------------------
// Détecte les nouveaux emails REÇUS sur la boîte agence (Gmail) depuis le dernier
// passage, les enregistre dans email_activity (direction='in') pour la cloche, et
// envoie un push aux appareils agence (si pref emailReceivedPush).
//
// Appelé par pg_cron (Bearer CRON_SECRET) OU par l'agence (JWT) pour un check manuel.
// État du dernier passage : blob __app_state__ clé `emailPollState.lastTs` (ms).
// 1er passage (pas de lastTs) : on pose seulement la baseline (aucune alerte).
// ============================================================================

import webpush from "npm:web-push@3.6.7";
import { getServiceClient, getAccessToken, corsHeaders } from "../_shared/google.ts";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:marc@ttpcreators.pro";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
type Sb = ReturnType<typeof getServiceClient>;
type Header = { name: string; value: string };

async function authorized(req: Request, sb: Sb): Promise<boolean> {
  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  if (!bearer) return false;
  if (CRON_SECRET && bearer === CRON_SECRET) return true;
  const { data, error } = await sb.auth.getUser(bearer);
  if (error || !data?.user) return false;
  const { data: prof, error: pe } = await sb.from("profiles").select("role").eq("user_id", data.user.id).maybeSingle<{ role: string }>();
  return !pe && prof?.role === "agency";
}

/** Blob agence : lecture (ligne la plus récente). */
async function readBlob(sb: Sb): Promise<{ id: string | null; obj: Record<string, unknown> }> {
  const { data } = await sb.from("module_rows").select("id,a").eq("module", "__app_state__").order("created_at", { ascending: false }).limit(1);
  const row = data?.[0] as { id: string; a: string } | undefined;
  if (!row) return { id: null, obj: {} };
  try {
    const o = JSON.parse(row.a);
    return { id: row.id, obj: o && typeof o === "object" ? o : {} };
  } catch {
    return { id: row.id, obj: {} };
  }
}
async function writeBlobKey(sb: Sb, id: string | null, obj: Record<string, unknown>, key: string, value: unknown) {
  const next = { ...obj, [key]: value };
  const json = JSON.stringify(next);
  if (id) await sb.from("module_rows").update({ a: json }).eq("id", id);
  else await sb.from("module_rows").insert({ module: "__app_state__", a: json });
}

function parseFrom(from: string): { email: string; name: string } {
  const m = /<([^>]+)>/.exec(from);
  const email = (m ? m[1] : from).trim().toLowerCase();
  const nm = /^\s*"?([^"<]+?)"?\s*</.exec(from);
  return { email, name: (nm ? nm[1] : from.replace(/[<>]/g, "")).trim() };
}

/** Push aux appareils AGENCE uniquement (allowlist par rôle), purge 404/410. */
async function pushAgency(sb: Sb, payload: string): Promise<number> {
  const { data: subsRaw } = await sb.from("push_subscriptions").select("id,endpoint,p256dh,auth,user_id");
  const all = (subsRaw ?? []) as { id: string; endpoint: string; p256dh: string; auth: string; user_id: string | null }[];
  const userIds = [...new Set(all.map((s) => s.user_id).filter(Boolean))] as string[];
  const agency = new Set<string>();
  if (userIds.length) {
    const { data: profs } = await sb.from("profiles").select("user_id,role").in("user_id", userIds);
    for (const p of (profs ?? []) as { user_id: string; role: string }[]) if (p.role !== "creator") agency.add(p.user_id);
  }
  let sent = 0;
  for (const s of all.filter((s) => s.user_id && agency.has(s.user_id))) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) await sb.from("push_subscriptions").delete().eq("id", s.id);
    }
  }
  return sent;
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const jsonRes = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const sb = getServiceClient();
  if (!(await authorized(req, sb))) return jsonRes({ error: "unauthorized" }, 401);

  let token: string;
  try {
    token = await getAccessToken(sb);
  } catch {
    return jsonRes({ ok: true, skipped: "google_non_connecte" });
  }

  const { id: blobId, obj: blob } = await readBlob(sb);
  const prefs = (blob.notifPrefs as Record<string, boolean | undefined>) ?? {};
  const pollState = (blob.emailPollState as { lastTs?: number }) ?? {};
  const lastTs = Number(pollState.lastTs ?? 0);

  // 1er passage : baseline seulement (évite d'alerter sur d'anciens mails).
  if (!lastTs) {
    await writeBlobKey(sb, blobId, blob, "emailPollState", { lastTs: Date.now() });
    return jsonRes({ ok: true, baseline: true });
  }

  const afterSec = Math.floor(lastTs / 1000);
  const q = encodeURIComponent(`in:inbox after:${afterSec}`);
  const listRes = await fetch(`${GMAIL}/messages?q=${q}&maxResults=25`, { headers: { Authorization: `Bearer ${token}` } });
  const list = await listRes.json().catch(() => ({}));
  if (!listRes.ok) return jsonRes({ ok: false, error: "lecture_echouee" }, 502);
  const ids: string[] = ((list as { messages?: { id: string }[] }).messages ?? []).map((m) => m.id);

  let maxTs = lastTs;
  const fresh: { id: string; threadId: string; from: string; subject: string; snippet: string }[] = [];
  for (const id of ids) {
    const mr = await fetch(`${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, { headers: { Authorization: `Bearer ${token}` } });
    if (!mr.ok) continue;
    const m = await mr.json().catch(() => null);
    if (!m) continue;
    const ts = Number(m.internalDate ?? 0);
    if (ts <= lastTs) continue;
    if (ts > maxTs) maxTs = ts;
    const headers: Header[] = m.payload?.headers ?? [];
    const h = (n: string) => headers.find((x) => x.name.toLowerCase() === n)?.value ?? "";
    fresh.push({ id: m.id, threadId: m.threadId, from: h("from"), subject: h("subject"), snippet: String(m.snippet ?? "").slice(0, 180) });
  }

  // Enregistre les mails reçus (pour la cloche) — dédoublonné par gmail_message_id.
  for (const f of fresh) {
    const { email, name } = parseFrom(f.from);
    const { data: exists } = await sb.from("email_activity").select("id").eq("gmail_message_id", f.id).limit(1);
    if (exists && exists.length) continue;
    await sb.from("email_activity").insert({
      contact_email: email, contact_name: name, direction: "in",
      subject: f.subject, snippet: f.snippet, source: "inbox",
      thread_id: f.threadId, gmail_message_id: f.id,
    }).catch(() => {});
  }

  await writeBlobKey(sb, blobId, blob, "emailPollState", { lastTs: maxTs });

  let pushed = 0;
  if (fresh.length && prefs.emailReceivedPush !== false) {
    const first = parseFrom(fresh[0].from);
    const payload = JSON.stringify({
      title: fresh.length === 1 ? `Nouvel email — ${first.name}` : `${fresh.length} nouveaux emails`,
      body: fresh[0].subject || first.email,
      url: "/",
      tag: `ttp-inbox-${maxTs}`,
    });
    pushed = await pushAgency(sb, payload);
  }

  return jsonRes({ ok: true, new: fresh.length, pushed });
});
