// ============================================================================
// gmail-poll/index.ts
// ----------------------------------------------------------------------------
// Détecte les nouveaux emails REÇUS sur les boîtes agence (Gmail) depuis le dernier
// passage, les enregistre dans email_activity (direction='in') pour la cloche, et
// envoie un push aux appareils agence (si pref emailReceivedPush).
// Boîtes : partnerships@ (connexion de l'app) + talent@ (compte de service, si configuré).
//
// Appelé par pg_cron (Bearer CRON_SECRET) OU par l'agence (JWT) pour un check manuel.
// État du dernier passage : blob __app_state__ clé `emailPollState` =
//   { lastTs (partnerships@, ms), talentLastTs (talent@, ms) }, écrit par la fonction
//   SQL app_state_set (une seule clé, jamais tout le blob : les réglages ne sont pas écrasés).
// 1er passage d'une boîte (pas de curseur) : on pose seulement la baseline (aucune alerte).
// Plus de 100 nouveaux mails : on traite les 100 plus anciens, le reste au passage suivant
// (rien n'est sauté). Un message illisible : le curseur n'avance pas (dédoublonnage par
// gmail_message_id, donc ni doublon ni nouvelle alerte au passage suivant).
// ============================================================================

import webpush from "npm:web-push@3.6.7";
import { getServiceClient, getAccessToken, corsHeaders, timingSafeEqualStr } from "../_shared/google.ts";
import { boxToken, talentAddress, type Box } from "../_shared/gmailBox.ts";
import { gfetch, mapPool } from "../_shared/gfetch.ts";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:marc@ttpcreators.pro";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const LIST_PAGE = 100; // ids par page de liste
const LIST_CAP = 500; // ids listés au plus par boîte et par passage
const PER_RUN = 100; // messages traités au plus par boîte et par passage
type Sb = ReturnType<typeof getServiceClient>;
type Header = { name: string; value: string };

async function authorized(req: Request, sb: Sb): Promise<boolean> {
  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  if (!bearer) return false;
  if (CRON_SECRET && timingSafeEqualStr(bearer, CRON_SECRET)) return true;
  const { data, error } = await sb.auth.getUser(bearer);
  if (error || !data?.user) return false;
  const { data: prof, error: pe } = await sb.from("profiles").select("role").eq("user_id", data.user.id).maybeSingle<{ role: string }>();
  return !pe && prof?.role === "agency";
}

/** Blob agence : lecture (ligne la plus récente). Sert aussi au repli d'écriture. */
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
/**
 * Écrit UNE clé du blob via la fonction SQL app_state_set (jsonb_set sous verrou de
 * ligne) : un réglage enregistré pendant le passage n'est plus écrasé. Ancienne
 * réécriture du blob entier seulement si la fonction SQL n'existe pas encore.
 */
async function saveStateKey(sb: Sb, key: string, value: unknown) {
  const { error } = await sb.rpc("app_state_set", { p_key: key, p_value: value });
  if (!error) return;
  const missing = error.code === "42883" || error.code === "PGRST202" ||
    /function .* does not exist|could not find the function/i.test(error.message ?? "");
  if (!missing) {
    console.error("gmail-poll app_state_set", error.message);
    return;
  }
  const { id, obj } = await readBlob(sb);
  const json = JSON.stringify({ ...obj, [key]: value });
  if (id) await sb.from("module_rows").update({ a: json }).eq("id", id);
  else await sb.from("module_rows").insert({ module: "__app_state__", a: json });
}

type Fresh = { id: string; threadId: string; from: string; subject: string; snippet: string; ts: number; rfcId: string; box: Box };

/**
 * Nouveaux messages d'une boîte depuis `cursor` (ms). Liste paginée (Gmail : du plus
 * récent au plus ancien), puis les PER_RUN plus anciens sont lus (8 à la fois).
 * `next` = nouveau curseur (inchangé si un message n'a pas pu être lu).
 */
async function scanBox(box: Box, token: string, cursor: number): Promise<{ fresh: Fresh[]; next: number; failed: boolean; more: boolean }> {
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  // `after:` est à la seconde : petite marge, le filtre exact se fait sur internalDate.
  const afterSec = Math.max(0, Math.floor(cursor / 1000) - 60);
  const ids: string[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ q: `in:inbox after:${afterSec}`, maxResults: String(LIST_PAGE) });
    if (pageToken) params.set("pageToken", pageToken);
    const r = await gfetch(`${GMAIL}/messages?${params}`, auth);
    const d = await r.json().catch(() => ({})) as { messages?: { id: string }[]; nextPageToken?: string };
    if (!r.ok) throw new Error("lecture_echouee");
    for (const m of d.messages ?? []) ids.push(m.id);
    pageToken = d.nextPageToken ?? "";
  } while (pageToken && ids.length < LIST_CAP);

  // Les plus anciens d'abord : jamais de mail sauté quand il en arrive beaucoup.
  const batch = ids.slice(-PER_RUN);
  const metas = await mapPool(batch, 8, async (id): Promise<Fresh | null | "fail"> => {
    try {
      const mr = await gfetch(`${GMAIL}/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID`, auth);
      if (mr.status === 404) return null; // supprimé entre-temps
      const m = await mr.json().catch(() => null);
      if (!mr.ok || !m) return "fail";
      const ts = Number(m.internalDate ?? 0);
      if (!ts || ts <= cursor) return null;
      const headers: Header[] = m.payload?.headers ?? [];
      const h = (n: string) => headers.find((x) => x.name.toLowerCase() === n)?.value ?? "";
      return {
        id: m.id, threadId: m.threadId, from: h("from"), subject: h("subject"),
        snippet: String(m.snippet ?? "").slice(0, 180), ts, rfcId: h("message-id").trim(), box,
      };
    } catch {
      return "fail";
    }
  });
  const fresh = metas.filter((x): x is Fresh => x !== null && x !== "fail");
  const failed = metas.includes("fail");
  const next = failed ? cursor : Math.max(cursor, ...fresh.map((f) => f.ts));
  return { fresh, next, failed, more: ids.length > PER_RUN };
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

  // Jetons des boîtes disponibles (une boîte indisponible n'empêche pas l'autre).
  const tokens: Partial<Record<Box, string>> = {};
  try {
    tokens.partnerships = await getAccessToken(sb);
  } catch { /* Google non connecté : talent@ seul */ }
  if (talentAddress()) {
    try {
      tokens.talent = await boxToken(sb, "talent", "read");
    } catch (e) {
      console.error("gmail-poll talent@", (e as Error)?.message);
    }
  }
  const boxes = (["partnerships", "talent"] as Box[]).filter((b) => tokens[b]);
  if (!boxes.length) return jsonRes({ ok: true, skipped: "google_non_connecte" });

  const { obj: blob } = await readBlob(sb);
  const prefs = (blob.notifPrefs as Record<string, boolean | undefined>) ?? {};
  const pollState = ((blob.emailPollState && typeof blob.emailPollState === "object") ? blob.emailPollState : {}) as { lastTs?: number; talentLastTs?: number };
  const cursorKey = (b: Box) => (b === "talent" ? "talentLastTs" : "lastTs") as "lastTs" | "talentLastTs";
  const nextState: Record<string, unknown> = { ...pollState };

  const fresh: Fresh[] = [];
  const failedBoxes: Box[] = [];
  let baseline = false;
  let more = false;
  await Promise.all(boxes.map(async (box) => {
    const cursor = Number(pollState[cursorKey(box)] ?? 0);
    // 1er passage de cette boîte : baseline seulement (évite d'alerter sur d'anciens mails).
    if (!cursor) {
      nextState[cursorKey(box)] = Date.now();
      baseline = true;
      return;
    }
    try {
      const got = await scanBox(box, tokens[box]!, cursor);
      fresh.push(...got.fresh);
      nextState[cursorKey(box)] = got.next;
      if (got.failed) failedBoxes.push(box);
      if (got.more) more = true;
    } catch (e) {
      console.error("gmail-poll", box, (e as Error)?.message);
      failedBoxes.push(box);
    }
  }));

  // Enregistre les mails reçus (pour la cloche) — dédoublonné par gmail_message_id
  // (et, dans un même passage, par Message-ID : un mail adressé aux deux boîtes compte une fois).
  fresh.sort((a, b) => a.ts - b.ts);
  const seenRfc = new Set<string>();
  const added: Fresh[] = [];
  for (const f of fresh) {
    if (f.rfcId) {
      if (seenRfc.has(f.rfcId)) continue;
      seenRfc.add(f.rfcId);
    }
    const { email, name } = parseFrom(f.from);
    const { data: exists, error: selError } = await sb.from("email_activity").select("id").eq("gmail_message_id", f.id).limit(1);
    if (selError) console.error("gmail-poll lecture journal", selError.message);
    if (exists && exists.length) continue;
    // Le constructeur de requête Supabase n'a pas de .catch : on lit { error }.
    const { error } = await sb.from("email_activity").insert({
      contact_email: email, contact_name: name, direction: "in",
      subject: f.subject, snippet: f.snippet, source: "inbox",
      thread_id: f.threadId, gmail_message_id: f.id,
    });
    if (error) {
      // 23505 = déjà enregistré par un passage simultané (index unique) : pas de nouvelle alerte.
      if (error.code === "23505") continue;
      console.error("gmail-poll journal", error.message);
    }
    added.push(f);
  }

  const changed = boxes.some((b) => nextState[cursorKey(b)] !== pollState[cursorKey(b)]);
  if (changed) await saveStateKey(sb, "emailPollState", nextState);

  // Toutes les boîtes lues ont échoué (et aucune baseline posée) : erreur comme avant.
  if (!baseline && failedBoxes.length === boxes.length && !fresh.length) {
    return jsonRes({ ok: false, error: "lecture_echouee", failedBoxes }, 502);
  }

  let pushed = 0;
  if (added.length && prefs.emailReceivedPush !== false) {
    const newest = [...added].sort((a, b) => b.ts - a.ts);
    const first = parseFrom(newest[0].from);
    const maxTs = newest[0].ts;
    const payload = JSON.stringify({
      title: added.length === 1 ? `Email de ${first.name}` : `${added.length} nouveaux emails`,
      body: newest[0].subject || first.email,
      url: "/",
      tag: `ttp-inbox-${maxTs}`,
    });
    pushed = await pushAgency(sb, payload);
  }

  return jsonRes({
    ok: true, new: added.length, pushed,
    ...(baseline ? { baseline: true } : {}),
    ...(more ? { more: true } : {}),
    ...(failedBoxes.length ? { partial: true, failedBoxes } : {}),
  });
});
