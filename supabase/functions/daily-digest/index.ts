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
import { getServiceClient, corsHeaders, timingSafeEqualStr } from "../_shared/google.ts";

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
/** Échéance comprise dans [from, to] (bornes incluses). */
function dueInRange(due: unknown, from: string, to: string): boolean {
  const iso = toISO(due);
  return iso !== "" && iso >= from && iso <= to;
}
/** Heure + jour de semaine à Paris (robuste au changement d'heure été/hiver). */
function parisParts(): { hour: number; weekday: string } {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris", hour: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(new Date());
  return {
    hour: Number(p.find((x) => x.type === "hour")?.value ?? "0"),
    weekday: p.find((x) => x.type === "weekday")?.value ?? "", // "Mon".."Sun"
  };
}
/** "YYYY-MM-DD" + N jours → "YYYY-MM-DD" (calcul en UTC, sans dérive de fuseau). */
function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "UTC" }).format(dt);
}

type CtDeadline = { creator?: string; start?: string; months?: number; type?: string };
type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

type Caller = { role: "cron" | "agency" | "creator"; creatorName?: string | null } | null;

/** Identifie l'appelant : CRON_SECRET (pg_cron), JWT agence (test) ou JWT créateur (activité).
 *  Le secret n'est accepté QUE dans l'en-tête Authorization (pas en query string,
 *  qui finirait dans les logs d'accès). */
async function identify(req: Request): Promise<Caller> {
  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  if (!bearer) return null;
  if (CRON_SECRET && timingSafeEqualStr(bearer, CRON_SECRET)) return { role: "cron" };
  const sb = getServiceClient();
  const { data, error } = await sb.auth.getUser(bearer);
  if (!error && data?.user) {
    const { data: prof } = await sb
      .from("profiles").select("role,creator_name").eq("user_id", data.user.id)
      .maybeSingle<{ role: string; creator_name: string | null }>();
    return prof?.role === "creator"
      ? { role: "creator", creatorName: prof.creator_name }
      : { role: "agency" };
  }
  return null;
}

/** Préférences de notifications (blob agence `notifPrefs`) — tout activé par défaut. */
type NotifPrefs = Record<string, boolean | undefined>;
async function loadPrefs(sb: ReturnType<typeof getServiceClient>): Promise<NotifPrefs> {
  try {
    // Même sélection que le client (appState.ts) : la ligne la plus récente —
    // maybeSingle() planterait si 2 lignes __app_state__ coexistent.
    const { data } = await sb
      .from("module_rows").select("a").eq("module", "__app_state__")
      .order("created_at", { ascending: false }).limit(1);
    const raw = (data?.[0] as { a?: unknown } | undefined)?.a;
    const obj = typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
    return (obj?.notifPrefs as NotifPrefs) ?? {};
  } catch {
    return {};
  }
}
const prefOn = (prefs: NotifPrefs, key: string) => prefs[key] !== false;

/** Envoie un payload aux abonnements AGENCE ; purge les morts (404/410).
 *  Les appareils liés à un compte créateur sont EXCLUS : le digest contient des
 *  infos internes (factures en retard, contrats…) réservées à l'agence. */
async function sendToAll(sb: ReturnType<typeof getServiceClient>, payload: string) {
  const { data: subsRaw } = await sb.from("push_subscriptions").select("id,endpoint,p256dh,auth,user_id");
  const all = ((subsRaw ?? []) as (Sub & { user_id: string | null })[]);
  // ALLOWLIST agence : on n'envoie QU'AUX appareils dont le compte est rôle 'agency'.
  // (Un abonnement sans user_id, ou d'un créateur/compte offboardé, est exclu.)
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
  let removed = 0;
  let firstError: string | null = null;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (!firstError) firstError = `${code ?? ""} ${(e as Error)?.message ?? String(e)}`.trim().slice(0, 200);
      if (code === 404 || code === 410) {
        await sb.from("push_subscriptions").delete().eq("id", s.id);
        removed++;
      }
    }
  }
  return { sent, removed, firstError, total: subs.length };
}

Deno.serve(async (req: Request) => {
  // CORS — indispensable : le bouton "Envoyer un test" appelle depuis le navigateur.
  const cors = corsHeaders(req.headers.get("Origin"));
  const jsonRes = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const caller = await identify(req);
  if (!caller) return jsonRes({ error: "unauthorized" }, 401);
  if (!VAPID_PRIVATE_KEY) return jsonRes({ error: "vapid_not_configured" }, 500);

  const sb = getServiceClient();
  const today = parisToday();

  let body: { test?: boolean; event?: string; kind?: string; creator?: string; text?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* pas de corps → digest normal */
  }

  // Activité créateur : push immédiat quand un créateur ajoute une tâche/idée/évènement.
  // Seul mode ouvert aux JWT créateurs (le digest/test restent agence + cron).
  if (body?.event === "creator_activity") {
    const prefs = await loadPrefs(sb);
    if (!prefOn(prefs, "pushCreatorActivity")) return jsonRes({ ok: true, skipped: "pref_off" });
    const kindLabel = body.kind === "idee" ? "idée" : body.kind === "evenement" ? "évènement" : "tâche";
    // Anti-usurpation : pour un JWT créateur, le nom vient de SON profil (pas du corps de requête).
    const rawWho = caller.role === "creator" ? (caller.creatorName || "Un créateur") : String(body.creator ?? "Un créateur");
    const who = rawWho.slice(0, 60).replace(/\p{L}[\p{L}'’-]*/gu, (w) => w.charAt(0).toUpperCase() + w.slice(1));
    const what = String(body.text ?? "").slice(0, 140);
    const payload = JSON.stringify({
      title: `${who} a ajouté une ${kindLabel}`,
      body: what,
      url: "/",
      tag: `ttp-creator-${Date.now()}`,
    });
    const r = await sendToAll(sb, payload);
    return jsonRes({ ok: true, creatorActivity: true, ...r });
  }

  // Les modes ci-dessous (test + digest) sont réservés à l'agence / au cron.
  if (caller.role === "creator") return jsonRes({ error: "unauthorized" }, 401);

  // Mode test (bouton dans l'app) : envoie une notif de contrôle, sans calcul.
  if (body?.test === true) {
    const payload = JSON.stringify({
      title: "TTP Suite ✓",
      body: "Test réussi — tes notifications fonctionnent ! 🎉",
      url: "/",
      tag: "ttp-test",
    });
    const r = await sendToAll(sb, payload);
    return jsonRes({ ok: true, test: true, ...r });
  }

  // ─── Résumé poussé (cron) : QUOTIDIEN 8h (défaut) · HEBDO lundi 8h (kind="weekly")
  //     · MI-JOURNÉE 14h (kind="afternoon") ───
  // Chaque cron tape à 2 heures UTC encadrant l'heure voulue ; on ne garde QUE le
  // passage où il est l'heure cible à Paris (robuste au changement d'heure).
  // `force:true` permet un test manuel hors créneau.
  const { hour, weekday } = parisParts();
  const weekly = body?.kind === "weekly";
  const afternoon = body?.kind === "afternoon";
  const force = (body as { force?: boolean })?.force === true;
  const targetHour = afternoon ? 14 : 8;
  if (!force && hour !== targetHour) return jsonRes({ ok: true, skipped: `hors_${targetHour}h`, parisHour: hour });

  const prefs = await loadPrefs(sb);

  if (afternoon) {
    // Point de MI-JOURNÉE : ce qu'il reste à traiter aujourd'hui (coupe la journée en 2).
    if (!prefOn(prefs, "digestAfternoon")) return jsonRes({ ok: true, skipped: "pref_off_afternoon" });
    const { data: tA } = await sb.from("todos").select("due,done");
    const todosLeft = (tA ?? []).filter((t) => t.done !== true && dueOrPast(t.due, today)).length;
    const { data: bA } = await sb.from("briefs").select("due");
    const briefsLeft = (bA ?? []).filter((b) => dueOrPast(b.due, today)).length;
    const tasksLeft = todosLeft + briefsLeft;
    const { data: evA } = await sb.from("events").select("date")
      .or("deleted.is.null,deleted.eq.false").eq("date", today);
    const evToday = (evA ?? []).length;
    const linesA: string[] = [];
    if (tasksLeft) linesA.push(`✓ ${tasksLeft} tâche${tasksLeft > 1 ? "s" : ""}/brief${tasksLeft > 1 ? "s" : ""} encore à traiter`);
    if (evToday) linesA.push(`📅 ${evToday} évènement${evToday > 1 ? "s" : ""} aujourd'hui`);
    if (linesA.length === 0) return jsonRes({ ok: true, sent: 0, reason: "rien à signaler (mi-journée)", today });
    const payloadA = JSON.stringify({
      title: "TTP Suite — point de mi-journée",
      body: linesA.join("\n"),
      url: "/",
      tag: `ttp-afternoon-${today}`,
    });
    const rA = await sendToAll(sb, payloadA);
    return jsonRes({ ok: true, afternoon: true, ...rA, today });
  }

  if (weekly) {
    // Résumé du LUNDI : tâches + évènements de la semaine (lundi → dimanche).
    if (!force && weekday !== "Mon") return jsonRes({ ok: true, skipped: "pas_lundi", weekday });
    if (!prefOn(prefs, "digestWeekly")) return jsonRes({ ok: true, skipped: "pref_off_weekly" });
    const monday = today; // le cron hebdo ne se déclenche que le lundi
    const sunday = addDaysISO(today, 6);
    const { data: evW } = await sb.from("events").select("date")
      .or("deleted.is.null,deleted.eq.false").gte("date", monday).lte("date", sunday);
    const eventsWeek = (evW ?? []).length;
    const { data: tW } = await sb.from("todos").select("due,done");
    const todosWeek = (tW ?? []).filter((t) => t.done !== true && dueInRange(t.due, monday, sunday)).length;
    const { data: bW } = await sb.from("briefs").select("due");
    const briefsWeek = (bW ?? []).filter((b) => dueInRange(b.due, monday, sunday)).length;
    const tasksWeek = todosWeek + briefsWeek;
    const linesW: string[] = [];
    if (eventsWeek) linesW.push(`📅 ${eventsWeek} évènement${eventsWeek > 1 ? "s" : ""} cette semaine`);
    if (tasksWeek) linesW.push(`✓ ${tasksWeek} tâche${tasksWeek > 1 ? "s" : ""}/brief${tasksWeek > 1 ? "s" : ""} à rendre`);
    if (linesW.length === 0) linesW.push("Semaine dégagée — rien de prévu pour l'instant 👌");
    const payloadW = JSON.stringify({
      title: "TTP Suite — ta semaine",
      body: linesW.join("\n"),
      url: "/",
      tag: `ttp-weekly-${monday}`,
    });
    const rW = await sendToAll(sb, payloadW);
    return jsonRes({ ok: true, weekly: true, ...rW, week: `${monday}→${sunday}` });
  }

  // ─── QUOTIDIEN ───
  // 1) Factures en retard
  const { data: inv } = await sb.from("invoices").select("status").eq("status", "retard");
  const overdue = (inv ?? []).length;

  // 2) Contrats (depuis le blob agence __app_state__)
  let contractsSoon = 0;
  try {
    const { data: blob } = await sb
      .from("module_rows").select("a").eq("module", "__app_state__")
      .order("created_at", { ascending: false }).limit(1);
    const raw = (blob?.[0] as { a?: unknown } | undefined)?.a;
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

  // Construit le résumé (rien à dire → on n'envoie pas, pour éviter le bruit).
  // Chaque catégorie respecte les préférences (page Paramètres) — `prefs` chargé plus haut.
  const lines: string[] = [];
  if (eventsToday && prefOn(prefs, "digestEvents")) lines.push(`📅 ${eventsToday} évènement${eventsToday > 1 ? "s" : ""} aujourd'hui`);
  if (tasksDue && prefOn(prefs, "digestTasks")) lines.push(`✓ ${tasksDue} tâche${tasksDue > 1 ? "s" : ""}/brief${tasksDue > 1 ? "s" : ""} à échéance`);
  if (contractsSoon && prefOn(prefs, "digestContracts")) lines.push(`📄 ${contractsSoon} contrat${contractsSoon > 1 ? "s" : ""} à surveiller`);
  if (overdue && prefOn(prefs, "digestInvoices")) lines.push(`💶 ${overdue} facture${overdue > 1 ? "s" : ""} en retard`);

  if (lines.length === 0) return jsonRes({ ok: true, sent: 0, reason: "rien à signaler", today });

  const payload = JSON.stringify({
    title: "TTP Suite — ta journée",
    body: lines.join("\n"),
    url: "/",
    tag: `ttp-daily-${today}`,
  });
  const r = await sendToAll(sb, payload);
  return jsonRes({ ok: true, ...r, digest: lines.join(" · "), today });
});
