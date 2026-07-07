// ============================================================================
// report-error/index.ts
// ----------------------------------------------------------------------------
// Reçoit un crash de rendu depuis l'ErrorBoundary du front, le JOURNALISE dans
// public.error_log, et envoie UNE notif push à l'agence (« ⚠️ bug survenu »).
//
// AUTH : verify_jwt=false — le crash peut survenir même déconnecté (écran login).
// Anti-spam : on ne pousse QUE la première occurrence d'un même message sur 30 min
// (mais on journalise toujours). Respecte la préférence notifPrefs.pushErrors.
// ============================================================================

import webpush from "npm:web-push@3.6.7";
import { getServiceClient, corsHeaders } from "../_shared/google.ts";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:marc@ttpcreators.pro";
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

type Sub = { id: string; endpoint: string; p256dh: string; auth: string; user_id: string | null };

/** Push vers les appareils AGENCE uniquement ; purge les abonnements morts. */
async function pushAgency(sb: ReturnType<typeof getServiceClient>, payload: string): Promise<number> {
  const { data: subsRaw } = await sb.from("push_subscriptions").select("id,endpoint,p256dh,auth,user_id");
  const all = (subsRaw ?? []) as Sub[];
  const userIds = [...new Set(all.map((s) => s.user_id).filter(Boolean))] as string[];
  const agencyIds = new Set<string>();
  if (userIds.length) {
    const { data: profs } = await sb.from("profiles").select("user_id,role").in("user_id", userIds);
    for (const pr of (profs ?? []) as { user_id: string; role: string }[]) {
      if (pr.role !== "creator") agencyIds.add(pr.user_id);
    }
  }
  const subs = all.filter((s) => s.user_id && agencyIds.has(s.user_id));
  let sent = 0;
  for (const s of subs) {
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

/** notifPrefs depuis le blob agence (tout activé par défaut). */
async function pushErrorsEnabled(sb: ReturnType<typeof getServiceClient>): Promise<boolean> {
  try {
    const { data } = await sb.from("module_rows").select("a").eq("module", "__app_state__")
      .order("created_at", { ascending: false }).limit(1);
    const raw = (data?.[0] as { a?: unknown } | undefined)?.a;
    const obj = typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
    return (obj?.notifPrefs?.pushErrors as boolean | undefined) !== false;
  } catch {
    return true;
  }
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const jsonRes = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonRes({ error: "method" }, 405);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: "bad_request" }, 400);
  }
  const message = String(body.message ?? "").slice(0, 500).trim();
  if (!message) return jsonRes({ error: "empty" }, 400);
  const page = String(body.page ?? "").slice(0, 80);
  const stack = String(body.stack ?? "").slice(0, 4000);
  const componentStack = String(body.componentStack ?? "").slice(0, 4000);
  const url = String(body.url ?? "").slice(0, 300);
  const userAgent = String(body.userAgent ?? "").slice(0, 300);
  const role = String(body.role ?? "").slice(0, 20);

  const sb = getServiceClient();

  // 1) Journalise toujours (service role → bypass RLS).
  await sb.from("error_log").insert({
    message, page, stack, component_stack: componentStack, url, user_agent: userAgent, role,
  }).then(() => {}, () => {});

  // 2) Push agence — seulement la 1re occurrence de ce message sur 30 min (anti-spam).
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { count } = await sb.from("error_log")
    .select("id", { count: "exact", head: true })
    .eq("message", message).gte("created_at", since);
  const occurrences = count ?? 1;

  let pushed = 0;
  if (occurrences <= 1 && VAPID_PRIVATE_KEY && (await pushErrorsEnabled(sb))) {
    const payload = JSON.stringify({
      title: "⚠️ Bug dans l'app",
      body: `${page ? page + " — " : ""}${message}`.slice(0, 180),
      url: "/",
      tag: `ttp-error-${message}`.slice(0, 120),
    });
    pushed = await pushAgency(sb, payload);
  }

  return jsonRes({ ok: true, logged: true, occurrences, pushed });
});
