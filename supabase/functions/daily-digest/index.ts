// ============================================================================
// daily-digest/index.ts
// ----------------------------------------------------------------------------
// Résumé matinal poussé sur les téléphones (Web Push). Appelé par pg_cron une
// fois par jour. Calcule 4 catégories depuis les vraies données puis envoie
// UNE notification groupée à chaque abonnement (table push_subscriptions).
//
// AUTH : verify_jwt=false + on exige le CRON_SECRET (même secret que google-sync).
// Secrets requis : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET.
// ============================================================================

import webpush from "npm:web-push@3.6.7";
import { getServiceClient } from "../_shared/google.ts";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:marc@ttpcreators.pro";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// ─── Helpers de date (fuseau Europe/Paris) ───────────────────────────────────
function parisToday(): string {
  // fr-CA formate en "AAAA-MM-JJ".
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date());
}
/** Texte libre / ISO → "YYYY-MM-DD" ou "" (identique à src/lib/dates.ts). */
function toISO(s: unknown): string {
  const t = String(s ?? "").trim();
  if (!t || t === "—") return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(t);
  if (!fr) return "";
  const y = fr[3].length === 2 ? "20" + fr[3] : fr[3];
  return `${y}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}`;
}
function contractEnd(start: string, months: number): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(start);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1 + (months || 0), Number(m[3]));
}
function daysUntil(end: Date, todayStr: string): number {
  const [y, mo, d] = todayStr.split("-").map(Number);
  const t0 = new Date(y, mo - 1, d).getTime();
  const e0 = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  return Math.round((e0 - t0) / 86400000);
}
/** Échéance datée aujourd'hui OU passée. */
function dueOrPast(due: unknown, todayStr: string): boolean {
  const iso = toISO(due);
  return iso !== "" && iso <= todayStr;
}

type CtDeadline = { creator?: string; start?: string; months?: number; type?: string };
type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

/** Autorise : soit le CRON_SECRET (pg_cron), soit un JWT agence (bouton "Tester" dans l'app). */
async function authorize(req: Request): Promise<boolean> {
  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  const key = bearer || new URL(req.url).searchParams.get("key") || "";
  if (CRON_SECRET && key === CRON_SECRET) return true; // appel pg_cron
  if (bearer) {
    const sb = getServiceClient();
    const { data, error } = await sb.auth.getUser(bearer);
    if (!error && data?.user) {
      const { data: prof } = await sb
        .from("profiles").select("role").eq("user_id", data.user.id).maybeSingle<{ role: string }>();
      if (prof?.role !== "creator") return true; // membre agence
    }
  }
  return false;
}

/** Envoie un payload à tous les abonnements ; purge les morts (404/410). */
async function sendToAll(sb: ReturnType<typeof getServiceClient>, payload: string) {
  const { data: subs } = await sb.from("push_subscriptions").select("id,endpoint,p256dh,auth");
  let sent = 0;
  let removed = 0;
  for (const s of (subs ?? []) as Sub[]) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) {
        await sb.from("push_subscriptions").delete().eq("id", s.id);
        removed++;
      }
    }
  }
  return { sent, removed };
}

Deno.serve(async (req: Request) => {
  const jsonRes = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

  if (!(await authorize(req))) return jsonRes({ error: "unauthorized" }, 401);
  if (!VAPID_PRIVATE_KEY) return jsonRes({ error: "vapid_not_configured" }, 500);

  const sb = getServiceClient();
  const today = parisToday();

  // Mode test (bouton dans l'app) : envoie une notif de contrôle, sans calcul.
  let body: { test?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* pas de corps → digest normal */
  }
  if (body?.test === true) {
    const payload = JSON.stringify({
      title: "TTP Suite ✓",
      body: "Test réussi — tes notifications fonctionnent ! 🎉",
      url: "/",
      tag: "ttp-test",
    });
    const { sent, removed } = await sendToAll(sb, payload);
    return jsonRes({ ok: true, test: true, sent, removed });
  }

  // 1) Factures en retard
  const { data: inv } = await sb.from("invoices").select("status").eq("status", "retard");
  const overdue = (inv ?? []).length;

  // 2) Contrats (depuis le blob agence __app_state__)
  let contractsSoon = 0;
  try {
    const { data: blob } = await sb
      .from("module_rows").select("a").eq("module", "__app_state__").maybeSingle();
    const raw = (blob as { a?: unknown } | null)?.a;
    const obj = typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
    const deadlines: CtDeadline[] = Array.isArray(obj?.contractDeadlines) ? obj.contractDeadlines : [];
    for (const d of deadlines) {
      const end = contractEnd(d.start ?? "", d.months ?? 0);
      if (end && daysUntil(end, today) <= 60) contractsSoon++;
    }
  } catch {
    /* blob illisible → 0 contrat */
  }

  // 3) To-do + 4) Briefs à échéance aujourd'hui ou en retard
  const { data: todos } = await sb.from("todos").select("due,done");
  const todosDue = (todos ?? []).filter((t) => t.done !== true && dueOrPast(t.due, today)).length;
  const { data: briefs } = await sb.from("briefs").select("due");
  const briefsDue = (briefs ?? []).filter((b) => dueOrPast(b.due, today)).length;
  const tasksDue = todosDue + briefsDue;

  // 5) Évènements du jour
  const { data: ev } = await sb
    .from("events").select("date").or("deleted.is.null,deleted.eq.false").eq("date", today);
  const eventsToday = (ev ?? []).length;

  // Construit le résumé (rien à dire → on n'envoie pas, pour éviter le bruit)
  const lines: string[] = [];
  if (eventsToday) lines.push(`📅 ${eventsToday} évènement${eventsToday > 1 ? "s" : ""} aujourd'hui`);
  if (tasksDue) lines.push(`✓ ${tasksDue} tâche${tasksDue > 1 ? "s" : ""}/brief${tasksDue > 1 ? "s" : ""} à échéance`);
  if (contractsSoon) lines.push(`📄 ${contractsSoon} contrat${contractsSoon > 1 ? "s" : ""} à surveiller`);
  if (overdue) lines.push(`💶 ${overdue} facture${overdue > 1 ? "s" : ""} en retard`);

  if (lines.length === 0) return jsonRes({ ok: true, sent: 0, reason: "rien à signaler", today });

  const payload = JSON.stringify({
    title: "TTP Suite — ta journée",
    body: lines.join("\n"),
    url: "/",
    tag: `ttp-daily-${today}`,
  });
  const { sent, removed } = await sendToAll(sb, payload);
  return jsonRes({ ok: true, sent, removed, digest: lines.join(" · "), today });
});
