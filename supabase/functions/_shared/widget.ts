// ============================================================================
// _shared/widget.ts : le widget iPhone de TTP Suite (demande de Marc, 19 nov. 2026).
// ----------------------------------------------------------------------------
// Une webapp ne peut pas poser de widget sur l'écran d'accueil : l'app Scriptable
// (gratuite) le dessine avec un petit script, qui lit la fonction `widget` (lecture seule).
// Ce fichier : les règles PURES (tâches à faire, planning des 7 prochains jours, clé),
// testées par widget.test.ts. Le script Scriptable : src/lib/widgetScript.ts.
// ============================================================================

import { isIgnoredSender, type IgnoredSenders } from "./mailIgnore.ts";

/** Clé du blob agence : empreinte SHA-256 de la clé du widget (la clé elle-même n'est jamais gardée). */
export const WIDGET_KEY = "widgetKey";

export type WidgetKeyState = { hash: string; ts: number };

export type TodoIn = {
  text?: unknown;
  due?: unknown;
  priority?: unknown;
  creator?: unknown;
  creators?: unknown;
  sort_order?: unknown;
};
export type EventIn = { date?: unknown; time?: unknown; title?: unknown; type?: unknown; who?: unknown };

export type Ton = "retard" | "jour" | "bientot" | "";
export type WidgetTache = { t: string; quand: string; ton: Ton; haute: boolean };
/** `court` : l'étiquette d'une ligne de widget (« 17:00 », « Auj. », « Dem. 09:00 », « ven. 21 »). */
export type WidgetEvent = { t: string; quand: string; court: string; heure: string; deadline: boolean; ton: "jour" | "demain" | "" };
export type MailIn = { contact_name?: unknown; contact_email?: unknown; subject?: unknown; created_at?: unknown; read_at?: unknown; box?: unknown; direction?: unknown };
/** Un mail non lu : expéditeur, objet, heure (« 14:32 », « hier », « lun. 17 »), boîte. */
export type WidgetMail = { de: string; objet: string; quand: string; boite: "partnerships" | "talent" | "" };
export type WidgetData = {
  v: 1;
  maj: string;
  taches: { ouvertes: number; retard: number; aujourdhui: number; liste: WidgetTache[] };
  planning: { total: number; liste: WidgetEvent[] };
  mails: { nonLus: number; partnerships: number; talent: number; liste: WidgetMail[] };
};

const TZ = "Europe/Paris";

/** Jour et heure à Paris (« AAAA-MM-JJ », « HH:MM »), robustes au changement d'heure. */
export function parisNow(now: Date): { day: string; time: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now).map((x) => [x.type, x.value]),
  );
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86_400_000);

/** Échéance d'une tâche : « AAAA-MM-JJ », ancien « jj/mm/aaaa », sinon "" (même règle que le connecteur). */
export function dueIso(v: unknown): string {
  const t = String(v ?? "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(t);
  return fr ? `${fr[3].length === 2 ? "20" + fr[3] : fr[3]}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}` : "";
}

/** Heure d'un évènement (« 14:00 ») ou "" (journée entière, « — »). */
export function timeOf(v: unknown): string {
  const m = /^(\d{1,2})[:h](\d{2})/.exec(String(v ?? "").trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
}

/** « jeu. 20 nov. » */
export function jourCourt(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("fr-FR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
}

/** Nom lisible : « LÉNA MOREL » → « Léna Morel ». */
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

function namesOf(t: TodoIn): string[] {
  const list = Array.isArray(t.creators) ? (t.creators as unknown[]).map((x) => String(x ?? "").trim()).filter(Boolean) : [];
  return list.length ? list : t.creator ? [String(t.creator).trim()].filter(Boolean) : [];
}

const PRIO: Record<string, number> = { haute: 0, moyenne: 1, basse: 2 };

/** Libellé de l'échéance d'une tâche et sa couleur. */
export function quandTache(due: string, today: string): { quand: string; ton: Ton } {
  if (!due) return { quand: "", ton: "" };
  const d = daysBetween(today, due);
  if (d < 0) return { quand: `${-d} j de retard`, ton: "retard" };
  if (d === 0) return { quand: "aujourd'hui", ton: "jour" };
  if (d === 1) return { quand: "demain", ton: "bientot" };
  return { quand: jourCourt(due), ton: d <= 3 ? "bientot" : "" };
}

/**
 * Ce que montre le widget. Tâches ouvertes : en retard d'abord (la plus en retard en
 * tête), puis celles du jour, puis par échéance, puis sans échéance (priorité haute
 * d'abord, puis l'ordre de la page To-do). Planning : du moment présent à J+7 ; un
 * rendez-vous du jour déjà passé n'est plus montré (sauf journée entière).
 */
export function resumeWidget(
  todos: readonly TodoIn[],
  events: readonly EventIn[],
  now: Date,
  mails: readonly MailIn[] = [],
  ignored: IgnoredSenders = {},
  max = { taches: 12, planning: 14, mails: 8 },
): WidgetData {
  const { day: today, time } = parisNow(now);
  const rows = todos
    .map((t, i) => ({ t, i, due: dueIso(t.due), prio: PRIO[String(t.priority ?? "")] ?? 3, order: Number(t.sort_order) }))
    .filter((r) => String(r.t.text ?? "").trim());
  rows.sort((a, b) => {
    if (a.due && b.due) return a.due < b.due ? -1 : a.due > b.due ? 1 : a.prio - b.prio;
    if (a.due || b.due) return a.due ? -1 : 1;
    if (a.prio !== b.prio) return a.prio - b.prio;
    const oa = Number.isFinite(a.order) ? a.order : Infinity, ob = Number.isFinite(b.order) ? b.order : Infinity;
    return oa !== ob ? oa - ob : a.i - b.i;
  });
  const retard = rows.filter((r) => r.due && r.due < today).length;
  const aujourdhui = rows.filter((r) => r.due === today).length;
  const liste: WidgetTache[] = rows.slice(0, max.taches).map((r) => {
    const names = namesOf(r.t).map(titleCase);
    const label = String(r.t.text).trim().replace(/\s+/g, " ");
    return {
      t: clip(names.length ? `${label} · ${names.join(", ")}` : label, 80),
      ...quandTache(r.due, today),
      haute: r.prio === 0,
    };
  });

  const end = addDays(today, 7);
  const evs = events
    .map((e) => ({ e, day: dueIso(e.date), heure: timeOf(e.time) }))
    .filter((x) => x.day && x.day >= today && x.day <= end && String(x.e.title ?? "").trim())
    .filter((x) => !(x.day === today && x.heure && x.heure < time))
    .sort((a, b) => (a.day !== b.day ? (a.day < b.day ? -1 : 1) : (a.heure || "00:00") < (b.heure || "00:00") ? -1 : (a.heure || "00:00") > (b.heure || "00:00") ? 1 : 0));
  const planning: WidgetEvent[] = evs.slice(0, max.planning).map((x) => {
    const who = String(x.e.who ?? "").trim();
    const d = daysBetween(today, x.day);
    return {
      t: clip(who ? `${String(x.e.title).trim()} · ${titleCase(who)}` : String(x.e.title).trim(), 80),
      quand: d === 0 ? "Aujourd'hui" : d === 1 ? "Demain" : jourCourt(x.day),
      court: d === 0 ? x.heure || "Auj." : d === 1 ? `Dem.${x.heure ? " " + x.heure : ""}` : jourCourt(x.day).replace(/\s+\S+$/, ""),
      heure: x.heure,
      deadline: String(x.e.type ?? "") === "deadline",
      ton: d === 0 ? "jour" : d === 1 ? "demain" : "",
    };
  });

  return {
    v: 1,
    maj: now.toISOString(),
    taches: { ouvertes: rows.length, retard, aujourdhui, liste },
    planning: { total: evs.length, liste: planning },
    mails: resumeMails(mails, ignored, now, max.mails),
  };
}

/** « 14:32 » aujourd'hui, « hier », sinon « lun. 17 » (heure de Paris). */
export function quandMail(iso: string, now: Date): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  const a = parisNow(t), n = parisNow(now);
  const d = daysBetween(a.day, n.day);
  return d <= 0 ? a.time : d === 1 ? "hier" : jourCourt(a.day).replace(/\s+\S+$/, "");
}

/**
 * Mails reçus non lus (ni dans l'app, ni dans Gmail ou Spark : email_activity.read_at),
 * sans les expéditeurs « Pas à traiter ». Les plus récents d'abord.
 */
export function resumeMails(rows: readonly MailIn[], ignored: IgnoredSenders, now: Date, max = 8): WidgetData["mails"] {
  const keep = rows
    .filter((r) => (r.direction == null || r.direction === "in") && !r.read_at)
    .filter((r) => !isIgnoredSender(String(r.contact_email ?? ""), ignored))
    .map((r) => ({ r, at: Date.parse(String(r.created_at ?? "")) }))
    .filter((x) => Number.isFinite(x.at))
    .sort((a, b) => b.at - a.at);
  const boxOf = (v: unknown) => (v === "partnerships" || v === "talent" ? v : "");
  return {
    nonLus: keep.length,
    partnerships: keep.filter((x) => boxOf(x.r.box) === "partnerships").length,
    talent: keep.filter((x) => boxOf(x.r.box) === "talent").length,
    liste: keep.slice(0, max).map(({ r }) => {
      const nom = String(r.contact_name ?? "").trim().replace(/^"|"$/g, "");
      const mail = String(r.contact_email ?? "").trim();
      return {
        de: clip(nom || mail.replace(/^.*<([^>]+)>.*$/, "$1") || "Inconnu", 40),
        objet: clip(String(r.subject ?? "").trim().replace(/\s+/g, " ") || "(sans objet)", 90),
        quand: quandMail(String(r.created_at), now),
        boite: boxOf(r.box),
      };
    }),
  };
}

/** État de la clé lu dans le blob, ou null s'il est absent ou abîmé. */
export function widgetKeyOf(v: unknown): WidgetKeyState | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return typeof o.hash === "string" && /^[0-9a-f]{64}$/.test(o.hash) ? { hash: o.hash, ts: Number(o.ts) || 0 } : null;
}

/** Une clé de widget valable : 43 caractères base64url (32 octets aléatoires). */
export const KEY_RE = /^[A-Za-z0-9_-]{43}$/;

export async function sha256Hex(s: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
