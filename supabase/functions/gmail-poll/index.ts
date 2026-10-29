// ============================================================================
// gmail-poll/index.ts
// ----------------------------------------------------------------------------
// Détecte les nouveaux emails REÇUS sur les boîtes agence (Gmail) depuis le dernier
// passage, les enregistre dans email_activity (direction='in') pour la cloche, et
// envoie un push aux appareils agence (si pref emailReceivedPush) : une notification
// par fil (expéditeur, objet, extrait), au-delà de 3 fils un résumé (_shared/mailNotif.ts).
// Mails des créateurs : un mail venu de l'extérieur et adressé à l'une des adresses d'un
// créateur dont le Mail est activé prévient aussi ce créateur (sa langue, son fil).
// Boîtes : partnerships@ (connexion de l'app) + talent@ (compte de service, si configuré).
//
// Appelé par pg_cron (Bearer CRON_SECRET) OU par l'agence (JWT) pour un check manuel.
// Les demandes de ces mails deviennent des tâches de la To-do (tasks.ts, sans IA).
// État du dernier passage : blob __app_state__ clé `emailPollState` =
//   { lastTs (partnerships@, ms), talentLastTs (talent@, ms) }, écrit par la fonction
//   SQL app_state_set (une seule clé, jamais tout le blob : les réglages ne sont pas écrasés).
// 1er passage d'une boîte (pas de curseur) : on pose seulement la baseline (aucune alerte).
// Plus de 100 nouveaux mails : on traite les 100 plus anciens, le reste au passage suivant
// (rien n'est sauté). Un message illisible : le curseur n'avance pas (dédoublonnage par
// gmail_message_id, donc ni doublon ni nouvelle alerte au passage suivant).
// ============================================================================

import { getServiceClient, getAccessToken, corsHeaders, timingSafeEqualStr } from "../_shared/google.ts";
import { boxToken, talentAddress, type Box } from "../_shared/gmailBox.ts";
import { gfetch, mapPool } from "../_shared/gfetch.ts";
import { sendTo } from "../_shared/push.ts";
import { agencyMailPayloads, creatorMailPayloads, creatorsForMail, type CreatorMailSetting, type Lang, type NewMail } from "../_shared/mailNotif.ts";
import { tasksFromMails } from "./tasks.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const AGENCY_DOMAIN = (Deno.env.get("AGENCY_MAIL_DOMAIN") ?? "ttpcreators.pro").toLowerCase();

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const LIST_PAGE = 100; // ids par page de liste
const LIST_CAP = 500; // ids listés au plus par boîte et par passage
const PER_RUN = 100; // messages traités au plus par boîte et par passage
// En-têtes lus : la notification (expéditeur, objet), les destinataires (mails des créateurs)
// et List-Unsubscribe (newsletter : jamais de tâche tirée de ce mail).
const META_HEADERS = ["From", "Subject", "Message-ID", "To", "Cc", "Delivered-To", "X-Original-To", "List-Unsubscribe"]
  .map((h) => `metadataHeaders=${h}`).join("&");
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

type Fresh = NewMail & { rfcId: string; listUnsub?: boolean };

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
      const mr = await gfetch(`${GMAIL}/messages/${encodeURIComponent(id)}?format=metadata&${META_HEADERS}`, auth);
      if (mr.status === 404) return null; // supprimé entre-temps
      const m = await mr.json().catch(() => null);
      if (!mr.ok || !m) return "fail";
      const ts = Number(m.internalDate ?? 0);
      if (!ts || ts <= cursor) return null;
      const headers: Header[] = m.payload?.headers ?? [];
      const h = (n: string) => headers.find((x) => x.name.toLowerCase() === n)?.value ?? "";
      // Plusieurs Delivered-To possibles (transferts) : tous gardés.
      const all = (n: string) => headers.filter((x) => x.name.toLowerCase() === n).map((x) => x.value).join(", ");
      return {
        id: m.id, threadId: m.threadId, from: h("from"), subject: h("subject"),
        snippet: String(m.snippet ?? "").slice(0, 300), ts, rfcId: h("message-id").trim(), box,
        to: h("to"), cc: h("cc"), deliveredTo: all("delivered-to"), originalTo: all("x-original-to"),
        labelIds: Array.isArray(m.labelIds) ? m.labelIds : [],
        listUnsub: !!h("list-unsubscribe"),
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

/**
 * Réglages Mail des créateurs dont le Mail est activé. La colonne `aliases` (adresses
 * en plus) est lue si elle existe ; sinon l'alias seul (base pas encore migrée).
 */
async function creatorMailSettings(sb: Sb): Promise<CreatorMailSetting[]> {
  const full = await sb.from("creator_mail_settings").select("creator, alias, aliases, label_id, enabled").eq("enabled", true);
  if (!full.error) return (full.data ?? []) as CreatorMailSetting[];
  const base = await sb.from("creator_mail_settings").select("creator, alias, label_id, enabled").eq("enabled", true);
  if (base.error) console.error("gmail-poll réglages Mail créateurs", base.error.message);
  return (base.data ?? []) as CreatorMailSetting[];
}

/** Langue de l'espace de chaque créateur (creators.lang), français si la colonne manque. */
async function creatorLangs(sb: Sb, names: string[]): Promise<Map<string, Lang>> {
  const out = new Map<string, Lang>();
  if (!names.length) return out;
  const { data, error } = await sb.from("creators").select("name, lang").in("name", names);
  if (error) return out;
  for (const r of (data ?? []) as { name: string; lang: string | null }[]) out.set(r.name, r.lang === "en" ? "en" : "fr");
  return out;
}

/**
 * Prévient chaque créateur concerné par les nouveaux mails : pas de réglage côté
 * créateur pour l'instant, donc activé par défaut dès que son Mail est activé.
 */
async function pushCreators(sb: Sb, mails: Fresh[]): Promise<number> {
  if (!mails.length) return 0;
  const settings = await creatorMailSettings(sb);
  if (!settings.length) return 0;
  const byCreator = new Map<string, Fresh[]>();
  for (const m of mails) {
    for (const c of creatorsForMail(m, settings, AGENCY_DOMAIN)) {
      const list = byCreator.get(c) ?? [];
      list.push(m);
      byCreator.set(c, list);
    }
  }
  if (!byCreator.size) return 0;
  const langs = await creatorLangs(sb, [...byCreator.keys()]);
  let sent = 0;
  for (const [creator, list] of byCreator) {
    sent += (await sendTo(sb, { creator }, creatorMailPayloads(list, langs.get(creator) ?? "fr"))).sent;
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
      subject: f.subject, snippet: f.snippet.slice(0, 180), source: "inbox",
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
    // Agence uniquement (rôle 'agency') : une notification par fil, au-delà de 3 fils un résumé.
    pushed = (await sendTo(sb, { agency: true }, agencyMailPayloads(added))).sent;
  }

  // Créateurs : la copie du mail dans la boîte que lit leur section Mail (talent@ si
  // configurée, sinon partnerships@, comme creator-mail : mêmes ids de fil). Seuls les
  // mails nouveaux de CE passage (dédoublonnés par le journal) comptent.
  let creatorPushed = 0;
  if (added.length) {
    const creatorBox: Box = talentAddress() ? "talent" : "partnerships";
    const addedKeys = new Set(added.flatMap((f) => (f.rfcId ? [f.id, f.rfcId] : [f.id])));
    const seenIds = new Set<string>();
    const forCreators = fresh.filter((f) => {
      if (f.box !== creatorBox || seenIds.has(f.id)) return false;
      seenIds.add(f.id);
      return addedKeys.has(f.id) || (!!f.rfcId && addedKeys.has(f.rfcId));
    });
    try {
      creatorPushed = await pushCreators(sb, forCreators);
    } catch (e) {
      console.error("gmail-poll push créateurs", (e as Error)?.message);
    }
  }

  // Demandes des mails reçus → tâches de la To-do (règles fixes, sans IA ; voir tasks.ts).
  let tasks = 0;
  if (added.length && prefs.mailTasks !== false) {
    try {
      tasks = await tasksFromMails(sb, tokens, added, blob, AGENCY_DOMAIN, await creatorMailSettings(sb));
    } catch (e) {
      console.error("gmail-poll tâches", (e as Error)?.message);
    }
  }

  return jsonRes({
    ok: true, new: added.length, pushed, creatorPushed, tasks,
    ...(baseline ? { baseline: true } : {}),
    ...(more ? { more: true } : {}),
    ...(failedBoxes.length ? { partial: true, failedBoxes } : {}),
  });
});
