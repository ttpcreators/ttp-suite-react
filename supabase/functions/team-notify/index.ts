// ============================================================================
// team-notify/index.ts : notifications « qui fait quoi » de l'équipe agence.
// ----------------------------------------------------------------------------
// Appelée par l'app juste après une action d'un compte agence (ajout, « Fait »,
// suppression, avancée). Elle lit les lignes que la BASE a notées pour CE compte
// (table agency_activity, remplie par un déclencheur) et pas encore envoyées, puis
// envoie une notification push aux AUTRES comptes agence (jamais à l'auteur).
// Rien n'est repris du corps de la requête : impossible d'inventer une action.
//
// Sécurité : JWT requis (verify_jwt) + rôle agence vérifié dans profiles.
// Préférence : notifPrefs.pushTeamActivity (blob agence), activée par défaut.
// Secrets : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mêmes que daily-digest).
// ============================================================================

import webpush from "npm:web-push@3.6.7";
import { getServiceClient, corsHeaders } from "../_shared/google.ts";
import { activityText, type ActivityRow } from "../_shared/activityText.ts";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:marc@ttpcreators.pro";
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

type Sb = ReturnType<typeof getServiceClient>;
type Row = ActivityRow & { id: string; actor_name: string | null };

/** Préférence de l'agence (blob notifPrefs) : activée sauf si coupée. */
async function prefOn(sb: Sb, key: string): Promise<boolean> {
  try {
    const { data } = await sb.from("module_rows").select("a").eq("module", "__app_state__")
      .order("created_at", { ascending: false }).limit(1);
    const raw = (data?.[0] as { a?: unknown } | undefined)?.a;
    const obj = typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
    return (obj?.notifPrefs as Record<string, boolean | undefined> | undefined)?.[key] !== false;
  } catch {
    return true;
  }
}

/** Texte de notification sobre (sans émoji, sans retour à la ligne). */
const tidy = (t: string) => t.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const res = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return res({ error: "methode" }, 405);

  const sb = getServiceClient();
  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  const { data: u } = bearer ? await sb.auth.getUser(bearer) : { data: null };
  const uid = u?.user?.id;
  if (!uid) return res({ error: "non_autorise" }, 401);
  const { data: prof } = await sb.from("profiles").select("role").eq("user_id", uid).maybeSingle<{ role: string }>();
  if (prof?.role !== "agency") return res({ error: "non_autorise" }, 403);

  // Actions de l'appelant, notées par la base dans les 10 dernières minutes et pas encore envoyées.
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: rowsRaw, error } = await sb.from("agency_activity")
    .select("id, actor_name, verb, entity, label, detail")
    .eq("actor_id", uid).is("pushed_at", null).gte("created_at", since)
    .order("created_at").limit(20);
  if (error) return res({ ok: true, sent: 0, skipped: "journal_absent" });
  const rows = (rowsRaw ?? []) as Row[];
  if (!rows.length) return res({ ok: true, sent: 0 });
  // Marquées AVANT l'envoi : deux appels rapprochés n'envoient jamais deux fois la même chose.
  await sb.from("agency_activity").update({ pushed_at: new Date().toISOString() }).in("id", rows.map((r) => r.id));
  if (!(await prefOn(sb, "pushTeamActivity"))) return res({ ok: true, sent: 0, skipped: "pref_off" });
  if (!VAPID_PRIVATE_KEY) return res({ ok: true, sent: 0, skipped: "vapid_absent" });

  const who = (rows[rows.length - 1].actor_name || "L'équipe").slice(0, 40);
  const texts = rows.map((r) => activityText(r));
  const title = tidy(rows.length === 1 ? `${who} ${texts[0].action}` : `${who} · ${rows.length} actions`).slice(0, 120);
  const bodyText = tidy(rows.length === 1 ? texts[0].what : texts.slice(-4).map((t) => `${t.action} : ${t.what}`).join(" · "));
  const payload = JSON.stringify({
    title,
    body: bodyText.length > 140 ? bodyText.slice(0, 139).trimEnd() + "…" : bodyText,
    url: "/",
    tag: `ttp-team-${uid}`.slice(0, 120),
  });

  // Appareils des AUTRES comptes agence uniquement.
  const { data: subsRaw } = await sb.from("push_subscriptions").select("id,endpoint,p256dh,auth,user_id");
  const subs = (subsRaw ?? []) as { id: string; endpoint: string; p256dh: string; auth: string; user_id: string | null }[];
  const others = [...new Set(subs.map((s) => s.user_id).filter((x): x is string => !!x && x !== uid))];
  const agency = new Set<string>();
  if (others.length) {
    const { data: profs } = await sb.from("profiles").select("user_id,role").in("user_id", others);
    for (const p of (profs ?? []) as { user_id: string; role: string }[]) if (p.role === "agency") agency.add(p.user_id);
  }
  let sent = 0;
  for (const s of subs.filter((x) => x.user_id && agency.has(x.user_id))) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) await sb.from("push_subscriptions").delete().eq("id", s.id);
    }
  }
  return res({ ok: true, actions: rows.length, sent });
});
