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

import { getServiceClient, corsHeaders, timingSafeEqualStr } from "../_shared/google.ts";
import { deepLinkUrl, loadAppBlob, makePayload, pushReady, sendTo, type Audience } from "../_shared/push.ts";
import type { PushKind } from "../_shared/pushPayload.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

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
/** Mois courant "YYYY-MM" à Paris + libellé "juillet 2026". */
function parisMonth(): string {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).format(new Date());
}
function parisMonthLabel(): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", month: "long", year: "numeric" }).format(new Date());
}
/** Capitalise chaque mot d'un nom (créateur) pour l'affichage. */
function capName(s: string): string {
  return s.slice(0, 60).replace(/\p{L}[\p{L}'’-]*/gu, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}
/** Montant texte ("3 000 €", "1 200,50 €") → nombre (miroir de src/lib/money.ts). */
function parseAmount(x: unknown): number {
  const cleaned = String(x ?? "").replace(/\s/g, "").replace(",", ".").replace(/[^0-9.\-]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}
/** "25%", "25,5 %" → 25 ; null si illisible (miroir de src/lib/commission.ts). */
function parseCommissionPct(s: unknown): number | null {
  if (s == null || s === "") return null;
  const m = /(\d+(?:[.,]\d+)?)/.exec(String(s));
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}
/** Montant en euros formaté "3 000 €". */
function euro(n: number): string {
  return Math.round(n).toLocaleString("fr-FR") + " €";
}
/** "YYYY-MM" d'un ISO → clé mois ; "" si illisible. */
function monthKeyOf(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  return m ? `${m[1]}-${m[2]}` : "";
}

type CtDeadline = { creator?: string; start?: string; months?: number; type?: string };

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
    // Fail-closed : on n'accorde le rôle agence QUE si le profil le dit explicitement.
    // Profil absent ou rôle inconnu → créateur (moindre privilège), jamais agence.
    if (prof?.role === "agency") return { role: "agency" };
    return { role: "creator", creatorName: prof?.creator_name ?? null };
  }
  return null;
}

/** Préférences de notifications (blob agence `notifPrefs`) — tout activé par défaut. */
type NotifPrefs = Record<string, boolean | undefined>;
async function loadPrefs(sb: ReturnType<typeof getServiceClient>): Promise<NotifPrefs> {
  // Même sélection que le client (appState.ts) : la ligne la plus récente.
  return ((await loadAppBlob(sb)).notifPrefs as NotifPrefs | undefined) ?? {};
}
const prefOn = (prefs: NotifPrefs, key: string) => prefs[key] !== false;

// Textes de notif personnalisés (blob `notifTexts`) — clé → titre. Vide = défaut.
async function loadNotifTexts(sb: ReturnType<typeof getServiceClient>): Promise<Record<string, string>> {
  return ((await loadAppBlob(sb)).notifTexts as Record<string, string> | undefined) ?? {};
}
const customText = (t: Record<string, string>, key: string, def: string) => (t[key] || "").trim() || def;

/** Une notification : titre, texte, tag ; adresse d'ouverture « / » par défaut. */
type Msg = { title: string; body: string; tag: string; url?: string };

/** Envoie aux appareils AGENCE (rôle 'agency' uniquement) : le digest contient des
 *  infos internes (factures en retard, contrats…) réservées à l'agence.
 *  Notifications sobres (style iPhone, _shared/pushPayload.ts) : sans émojis ni tirets,
 *  même si un titre personnalisé (Paramètres) en contient ; majuscule en tête.
 *  audience : « founders » = fondateurs seuls (messages avec de l'argent, la Finance
 *  leur est réservée), « members » = les autres comptes agence, défaut = tous. */
async function sendToAll(sb: ReturnType<typeof getServiceClient>, msg: Msg, audience: Audience = "all", kind: PushKind = "digest") {
  return await sendTo(sb, { agency: true, audience }, makePayload({ kind, url: "/", ...msg }, { capitalize: true }));
}

/** Push vers les appareils d'UN créateur (résolu par profiles.creator_name).
 *  Réservé à l'agence : la résolution se fait côté serveur, pas de fuite croisée. */
async function pushToCreator(sb: ReturnType<typeof getServiceClient>, creatorName: string, msg: Msg, lang: "fr" | "en") {
  const r = await sendTo(sb, { creator: creatorName }, makePayload({ kind: "agency-activity", url: "/", lang, ...msg }, { capitalize: true }));
  return r.total ? r : { ...r, reason: "creator_sans_appareil" };
}

/** Langue de l'espace d'un créateur (creators.lang), français si la colonne manque. */
async function creatorLang(sb: ReturnType<typeof getServiceClient>, name: string): Promise<"fr" | "en"> {
  const { data, error } = await sb.from("creators").select("lang").eq("name", name).maybeSingle<{ lang: string | null }>();
  return !error && data?.lang === "en" ? "en" : "fr";
}

Deno.serve(async (req: Request) => {
  // CORS — indispensable : le bouton "Envoyer un test" appelle depuis le navigateur.
  const cors = corsHeaders(req.headers.get("Origin"));
  const jsonRes = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const caller = await identify(req);
  if (!caller) return jsonRes({ error: "unauthorized" }, 401);
  if (!pushReady()) return jsonRes({ error: "vapid_not_configured" }, 500);

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
    // Anti-usurpation : pour un JWT créateur, le nom vient de SON profil (pas du corps de requête).
    const rawWho = caller.role === "creator" ? (caller.creatorName || "Un créateur") : String(body.creator ?? "Un créateur");
    const who = rawWho.slice(0, 60).replace(/\p{L}[\p{L}'’-]*/gu, (w) => w.charAt(0).toUpperCase() + w.slice(1));
    const what = String(body.text ?? "").slice(0, 140);
    // Titre personnalisable PAR TYPE d'action du créateur (blob `notifTexts`).
    const texts = await loadNotifTexts(sb);
    const DEFA: Record<string, string> = {
      tache: "{createur} · nouvelle tâche",
      idee: "{createur} · nouvelle idée",
      contact: "{createur} · nouveau contact",
      evenement: "{createur} · nouvel évènement",
      gift: "{createur} · cadeau reçu",
      facture: "{createur} · facture déposée",
      stats: "{createur} · stats envoyées",
      mail: "{createur} · message sur un mail",
    };
    const KEYA: Record<string, string> = {
      tache: "a_task", idee: "a_idea", contact: "a_contact", evenement: "a_event",
      gift: "a_gift", facture: "a_facture", stats: "a_stats", mail: "a_mail",
    };
    const aKind = String(body.kind ?? "tache");
    const activityTitle = customText(texts, KEYA[aKind] ?? "a_task", DEFA[aKind] ?? "{createur} · nouvelle activité")
      .replace(/\{createur\}/g, who)
      .slice(0, 120);
    // Tag STABLE par créateur (pas Date.now()) : deux notifs d'activité du même
    // créateur se REMPLACENT au lieu de s'empiler → borne le spam de notifications
    // qu'un compte créateur pourrait générer en boucle. (audit 2026-07-13)
    const r = await sendToAll(sb, {
      title: activityTitle,
      body: what,
      tag: `ttp-creator-${who}`,
    }, "all", "creator-activity");
    return jsonRes({ ok: true, creatorActivity: true, ...r });
  }

  // Notif de TEST vers les PROPRES appareils de l'appelant (agence OU créateur).
  // Autorisé aux JWT créateurs → le bouton "Envoyer un test" marche des deux côtés.
  if (body?.event === "self_test") {
    const authz = req.headers.get("Authorization") ?? "";
    const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
    const { data: u } = await sb.auth.getUser(bearer);
    const uid = u?.user?.id;
    if (!uid) return jsonRes({ error: "unauthorized" }, 401);
    const en = caller.role === "creator" && !!caller.creatorName && (await creatorLang(sb, caller.creatorName)) === "en";
    const r = await sendTo(sb, { userIds: [uid] }, makePayload({
      kind: "test",
      title: "TTP Suite",
      body: en ? "Notifications are working." : "Les notifications fonctionnent.",
      url: "/",
      tag: "ttp-test",
      ...(en ? { lang: "en" as const } : {}),
    }));
    return jsonRes({ ok: true, test: true, ...r });
  }

  // Les modes ci-dessous (agence→créateur, test, digest) sont réservés à l'agence / au cron.
  if (caller.role === "creator") return jsonRes({ error: "unauthorized" }, 401);

  // Activité agence → créateur : push au créateur concerné (nouvelle tâche, document…).
  if (body?.event === "agency_activity") {
    const creator = String(body.creator ?? "").trim();
    if (!creator) return jsonRes({ error: "creator_manquant" }, 400);
    const what = String(body.text ?? "").slice(0, 140);
    const texts = await loadNotifTexts(sb);
    const DEF: Record<string, string> = {
      document: "Nouveau document",
      brief: "Nouveau brief",
      debrief: "Nouveau débrief",
      event: "Nouvel évènement",
      mediakit: "Media kit mis à jour",
      "task-done": "Ta demande est faite",
      idea: "Nouvelle idée de l'agence",
      gift: "Nouveau cadeau",
      invoice: "Facture mise à jour",
      roadmap: "Feuille de route mise à jour",
      mail: "Un échange a changé de statut",
    };
    const KEY: Record<string, string> = {
      document: "c_document", brief: "c_brief", debrief: "c_debrief", event: "c_event",
      mediakit: "c_mediakit", "task-done": "c_taskdone", idea: "c_idea", gift: "c_gift",
      invoice: "c_invoice", roadmap: "c_roadmap", mail: "c_mail",
    };
    // Créateur à l'espace en anglais : titres par défaut en anglais (un titre
    // personnalisé dans Paramètres reste tel quel).
    const DEF_EN: Record<string, string> = {
      document: "New document",
      brief: "New brief",
      debrief: "New debrief",
      event: "New event",
      mediakit: "Media kit updated",
      "task-done": "Your request is done",
      idea: "New idea from the agency",
      gift: "New gift",
      invoice: "Invoice updated",
      roadmap: "Roadmap updated",
      mail: "An email thread changed status",
    };
    const kind = String(body.kind ?? "");
    const lang = await creatorLang(sb, creator);
    const en = lang === "en";
    const title = customText(texts, KEY[kind] ?? "c_task", (en ? DEF_EN[kind] : DEF[kind]) ?? (en ? "New task" : "Nouvelle tâche"));
    const r = await pushToCreator(sb, creator, {
      title,
      body: what || (en ? "Tap to see the details." : "Touche pour voir le détail."),
      // Statut d'un échange : ouvre directement l'onglet Mail du créateur.
      url: kind === "mail" ? deepLinkUrl({ open: "cs-mails" }) : "/",
      tag: `ttp-agency-${Date.now()}`,
    }, lang);
    return jsonRes({ ok: true, agencyActivity: true, ...r });
  }

  // Mode test (bouton dans l'app) : envoie une notif de contrôle, sans calcul.
  if (body?.test === true) {
    const payload = {
      title: "TTP Suite",
      body: "Les notifications fonctionnent.",
      url: "/",
      tag: "ttp-test",
    };
    const r = await sendToAll(sb, payload, "all", "test");
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
  const statsReminder = body?.kind === "stats";
  const force = (body as { force?: boolean })?.force === true;

  // ─── RAPPEL MENSUEL « données créateurs à jour » ───
  // Chaque jour à 9h Paris : liste les créateurs actifs dont `stats_month` ≠ mois
  // courant. Au 1er du mois, tout le monde bascule « à mettre à jour » → rappel
  // quotidien jusqu'à ce que l'agence ait tout coché. Plus rien de stale → silence.
  if (statsReminder) {
    if (!force && hour !== 9) return jsonRes({ ok: true, skipped: "hors_9h", parisHour: hour });
    const prefsS = await loadPrefs(sb);
    if (!prefOn(prefsS, "digestStats")) return jsonRes({ ok: true, skipped: "pref_off_stats" });
    const month = parisMonth();
    const { data: cr } = await sb.from("creators").select("name,stats_month,status");
    const active = (cr ?? []).filter((c) => String((c as { status?: string }).status ?? "actif").toLowerCase() !== "inactif");
    const stale = active.filter((c) => String((c as { stats_month?: string | null }).stats_month ?? "") !== month);
    if (stale.length === 0) return jsonRes({ ok: true, sent: 0, reason: "tous à jour", month });
    const names = stale.slice(0, 8).map((c) => capName(String((c as { name?: string }).name ?? "")));
    const payloadS = {
      title: "Données à mettre à jour",
      body: stale.length <= 3 ? `${names.join(", ")} · ${parisMonthLabel()}` : `${stale.length} créateurs pas à jour pour ${parisMonthLabel()}`,
      url: "/",
      tag: `ttp-stats-${today}`, // tag daté → relance chaque jour tant que c'est stale
    };
    const rS = await sendToAll(sb, payloadS);
    return jsonRes({ ok: true, statsReminder: true, ...rS, month, stale: stale.length });
  }

  const targetHour = afternoon ? 14 : 8;
  if (!force && hour !== targetHour) return jsonRes({ ok: true, skipped: `hors_${targetHour}h`, parisHour: hour });

  const prefs = await loadPrefs(sb);

  if (afternoon) {
    // Point de MI-JOURNÉE : ce qu'il reste à traiter aujourd'hui (coupe la journée en 2).
    if (!prefOn(prefs, "digestAfternoon")) return jsonRes({ ok: true, skipped: "pref_off_afternoon" });
    const { data: tA } = await sb.from("todos").select("due,done").or("done.is.null,done.eq.false");
    const todosLeft = (tA ?? []).filter((t) => t.done !== true && dueOrPast(t.due, today)).length;
    const { data: bA } = await sb.from("briefs").select("due");
    const briefsLeft = (bA ?? []).filter((b) => dueOrPast(b.due, today)).length;
    const tasksLeft = todosLeft + briefsLeft;
    const { data: evA } = await sb.from("events").select("date")
      .or("deleted.is.null,deleted.eq.false").eq("date", today);
    const evToday = (evA ?? []).length;
    const linesA: string[] = [];
    if (tasksLeft) linesA.push(`${tasksLeft} tâche${tasksLeft > 1 ? "s" : ""} à traiter`);
    if (evToday) linesA.push(`${evToday} évènement${evToday > 1 ? "s" : ""}`);
    if (linesA.length === 0) return jsonRes({ ok: true, sent: 0, reason: "rien à signaler (mi-journée)", today });
    const payloadA = {
      title: "Point de 14 h",
      body: linesA.join(" · "),
      url: "/",
      tag: `ttp-afternoon-${today}`,
    };
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
    const { data: tW } = await sb.from("todos").select("due,done").or("done.is.null,done.eq.false");
    const todosWeek = (tW ?? []).filter((t) => t.done !== true && dueInRange(t.due, monday, sunday)).length;
    const { data: bW } = await sb.from("briefs").select("due");
    const briefsWeek = (bW ?? []).filter((b) => dueInRange(b.due, monday, sunday)).length;
    const tasksWeek = todosWeek + briefsWeek;
    const linesW: string[] = [];
    if (eventsWeek) linesW.push(`${eventsWeek} évènement${eventsWeek > 1 ? "s" : ""}`);
    if (tasksWeek) linesW.push(`${tasksWeek} tâche${tasksWeek > 1 ? "s" : ""} à rendre`);
    if (linesW.length === 0) linesW.push("Rien de prévu pour l'instant");
    const payloadW = {
      title: "Ta semaine",
      body: linesW.join(" · "),
      url: "/",
      tag: `ttp-weekly-${monday}`,
    };
    const rW = await sendToAll(sb, payloadW);
    return jsonRes({ ok: true, weekly: true, ...rW, week: `${monday}→${sunday}` });
  }

  // ─── QUOTIDIEN ───
  // 1) Factures en retard
  const { data: inv } = await sb.from("invoices").select("status").eq("status", "retard");
  const overdue = (inv ?? []).length;

  // 2) Blob agence __app_state__ : contrats à surveiller, commissions (override), reversements payés.
  let contractsSoon = 0;
  let commBlob: Record<string, number> = {};
  let payoutsBlob: Record<string, { amount?: number }[]> = {};
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
    if (obj?.creatorCommission && typeof obj.creatorCommission === "object") commBlob = obj.creatorCommission as Record<string, number>;
    if (obj?.creatorPayouts && typeof obj.creatorPayouts === "object") payoutsBlob = obj.creatorPayouts as Record<string, { amount?: number }[]>;
  } catch {
    /* blob illisible → valeurs par défaut */
  }

  // 3) To-do + 4) Briefs à échéance aujourd'hui ou en retard
  const { data: todos } = await sb.from("todos").select("due,done").or("done.is.null,done.eq.false");
  const todosDue = (todos ?? []).filter((t) => t.done !== true && dueOrPast(t.due, today)).length;
  const { data: briefs } = await sb.from("briefs").select("due");
  const briefsDue = (briefs ?? []).filter((b) => dueOrPast(b.due, today)).length;
  const tasksDue = todosDue + briefsDue;

  // 5) Évènements du jour + 6) RDV de DEMAIN (rappel la veille)
  const tomorrow = addDaysISO(today, 1);
  const { data: ev } = await sb
    .from("events").select("date").or("deleted.is.null,deleted.eq.false").in("date", [today, tomorrow]);
  const eventsToday = (ev ?? []).filter((e) => e.date === today).length;
  const rdvTomorrow = (ev ?? []).filter((e) => e.date === tomorrow).length;

  // 7) Créateurs : anniversaires du jour + taux de commission (pour les reversements)
  const { data: crRows } = await sb.from("creators").select("name,birth,commission,status");
  const creators = (crRows ?? []) as { name: string; birth: string | null; commission: string | null; status: string | null }[];
  const md = today.slice(5); // "MM-DD"
  const mdTomorrow = addDaysISO(today, 1).slice(5);
  const activeCreators = creators.filter((c) => String(c.status ?? "actif").toLowerCase() !== "inactif");
  const bornOn = (mmdd: string) => activeCreators
    .filter((c) => { const iso = toISO(c.birth); return iso !== "" && iso.slice(5) === mmdd; })
    .map((c) => capName(c.name));
  const birthdays = bornOn(md);
  const birthdaysTomorrow = bornOn(mdTomorrow);

  // Anniversaires : notification DÉDIÉE (en plus de la ligne du résumé) le jour J,
  // et un rappel la veille pour préparer un message ou un cadeau. Pref « digestBirthdays ».
  if (prefOn(prefs, "digestBirthdays")) {
    for (const n of birthdays) {
      await sendToAll(sb, {
        title: `Anniversaire de ${n}`,
        body: "C'est aujourd'hui.",
        url: "/",
        tag: `ttp-birthday-${today}-${n}`,
      });
    }
    for (const n of birthdaysTomorrow) {
      await sendToAll(sb, {
        title: `Anniversaire de ${n} demain`,
        body: "Un message ou un petit cadeau ?",
        url: "/",
        tag: `ttp-birthday-eve-${today}-${n}`,
      });
    }
  }

  // 8) Reversements à faire : (encaissé − commission) − déjà reversé, par créateur.
  const { data: invAll } = await sb.from("invoices").select("amount,status,creator,date");
  const invRows = (invAll ?? []) as { amount: string | null; status: string | null; creator: string | null; date: string | null }[];
  const encByCreator = new Map<string, number>();
  for (const iv of invRows) {
    if (iv.status !== "payee") continue;
    const c = (iv.creator ?? "").trim();
    if (!c) continue;
    encByCreator.set(c, (encByCreator.get(c) ?? 0) + parseAmount(iv.amount));
  }
  const rosterRate: Record<string, number | null> = {};
  for (const c of creators) rosterRate[c.name] = parseCommissionPct(c.commission);
  let reverseCount = 0;
  let reverseSum = 0;
  for (const [c, enc] of encByCreator) {
    const rate = rosterRate[c] != null ? (rosterRate[c] as number) : (typeof commBlob[c] === "number" ? commBlob[c] : 20);
    const du = enc - Math.round((enc * rate) / 100);
    const paid = (payoutsBlob[c] ?? []).reduce((a, p) => a + (Number(p?.amount) || 0), 0);
    const reste = du - paid;
    if (reste > 0) { reverseCount++; reverseSum += reste; }
  }

  // 9) Récap mensuel — uniquement le 1er du mois : CA facturé/encaissé du mois précédent.
  let monthlyLine = "";
  if (today.slice(8) === "01") {
    const prevKey = monthKeyOf(addDaysISO(today, -1)); // hier = dernier jour du mois précédent
    let factured = 0;
    let cashed = 0;
    for (const iv of invRows) {
      if (monthKeyOf(toISO(iv.date)) !== prevKey) continue;
      const amt = parseAmount(iv.amount);
      factured += amt;
      if (iv.status === "payee") cashed += amt;
    }
    if (factured > 0 || cashed > 0) monthlyLine = `mois dernier : ${euro(factured)} facturés`;
  }

  // Construit le résumé (rien à dire → on n'envoie pas, pour éviter le bruit).
  // Chaque catégorie respecte les préférences (page Paramètres) — `prefs` chargé plus haut.
  const lines: string[] = [];
  if (eventsToday && prefOn(prefs, "digestEvents")) lines.push(`${eventsToday} évènement${eventsToday > 1 ? "s" : ""}`);
  if (rdvTomorrow && prefOn(prefs, "digestRdvTomorrow")) lines.push(`${rdvTomorrow} RDV demain`);
  if (tasksDue && prefOn(prefs, "digestTasks")) lines.push(`${tasksDue} tâche${tasksDue > 1 ? "s" : ""} à échéance`);
  if (contractsSoon && prefOn(prefs, "digestContracts")) lines.push(`${contractsSoon} contrat${contractsSoon > 1 ? "s" : ""} à renouveler`);
  if (birthdays.length && prefOn(prefs, "digestBirthdays")) lines.push(`anniversaire de ${birthdays.join(", ")}`);
  // Argent : seulement dans la version des fondateurs (la Finance leur est réservée).
  const money: string[] = [];
  if (overdue && prefOn(prefs, "digestInvoices")) money.push(`${overdue} facture${overdue > 1 ? "s" : ""} en retard`);
  if (reverseCount && prefOn(prefs, "digestPayouts")) money.push(`${euro(reverseSum)} à reverser`);
  if (monthlyLine && prefOn(prefs, "digestMonthly")) money.push(monthlyLine);

  const full = [...lines, ...money];
  if (full.length === 0) return jsonRes({ ok: true, sent: 0, reason: "rien à signaler", today });

  const make = (body: string[]): Msg => ({ title: "Ta journée", body: body.join(" · "), url: "/", tag: `ttp-daily-${today}` });
  const rF = await sendToAll(sb, make(full), "founders");
  const rM = lines.length ? await sendToAll(sb, make(lines), "members") : { sent: 0 };
  return jsonRes({ ok: true, founders: rF, members: rM, digest: full.join(" · "), today });
});
