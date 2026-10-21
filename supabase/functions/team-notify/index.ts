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

import { getServiceClient, corsHeaders } from "../_shared/google.ts";
import { activityText, type ActivityRow } from "../_shared/activityText.ts";
import { loadNotifPrefs, makePayload, pushReady, sendTo } from "../_shared/push.ts";

type Sb = ReturnType<typeof getServiceClient>;
type Row = ActivityRow & { id: string; actor_name: string | null };

/** Préférence de l'agence (blob notifPrefs) : activée sauf si coupée. */
async function prefOn(sb: Sb, key: string): Promise<boolean> {
  return (await loadNotifPrefs(sb))[key] !== false;
}

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
  if (!pushReady()) return res({ ok: true, sent: 0, skipped: "vapid_absent" });

  const who = (rows[rows.length - 1].actor_name || "L'équipe").slice(0, 40);
  const texts = rows.map((r) => activityText(r));
  const payload = makePayload({
    kind: "team",
    title: rows.length === 1 ? `${who} ${texts[0].action}` : `${who} · ${rows.length} actions`,
    body: rows.length === 1 ? texts[0].what : texts.slice(-4).map((t) => `${t.action} : ${t.what}`).join(" · "),
    url: "/",
    tag: `ttp-team-${uid}`,
  });

  // Appareils des AUTRES comptes agence uniquement (jamais l'auteur).
  const { sent } = await sendTo(sb, { agency: true, exclude: uid }, payload);
  return res({ ok: true, actions: rows.length, sent });
});
