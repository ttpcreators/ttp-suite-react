// ============================================================================
// widget/index.ts : les données du widget iPhone (app Scriptable), en LECTURE SEULE.
// ----------------------------------------------------------------------------
// GET, Authorization: Bearer <clé du widget> → JSON (_shared/widget.ts, resumeWidget) :
//   tâches ouvertes de la page To-do (en retard, du jour, à venir), planning des
//   7 prochains jours et mails reçus non lus (expéditeur, objet, heure ; sans le corps).
//   Ni factures, ni contacts.
// GET ?script=1 (même clé) → le code du dessin (_shared/widgetRenderer.ts), que le
//   lanceur collé dans Scriptable télécharge : retoucher le dessin ne demande rien sur l'iPhone.
// AUTH : verify_jwt = false (config.toml : Scriptable n'a pas de session) + la clé du
// widget, créée dans Paramètres › Notifications › Widget iPhone. Seule son empreinte
// SHA-256 est gardée (blob agence, clé `widgetKey`) ; « Changer la clé » coupe l'ancienne.
// ============================================================================

import { getServiceClient, timingSafeEqualStr } from "../_shared/google.ts";
import { readAppState } from "../_shared/appState.ts";
import { readIgnoredSenders, IGNORED_SENDERS_KEY } from "../_shared/mailIgnore.ts";
import { WIDGET_RENDERER } from "../_shared/widgetRenderer.ts";
import { KEY_RE, WIDGET_KEY, addDays, parisNow, resumeWidget, sha256Hex, widgetKeyOf } from "../_shared/widget.ts";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "method" }, 405);
  const key = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!KEY_RE.test(key)) return json({ error: "unauthorized" }, 401);

  const sb = getServiceClient();
  let stored, blob: Record<string, unknown>;
  try {
    blob = await readAppState(sb);
    stored = widgetKeyOf(blob[WIDGET_KEY]);
  } catch (e) {
    console.error("widget: blob", (e as Error).message);
    return json({ error: "indisponible" }, 503);
  }
  if (!stored || !timingSafeEqualStr(await sha256Hex(key), stored.hash)) return json({ error: "unauthorized" }, 401);

  if (new URL(req.url).searchParams.get("script") === "1") {
    return new Response(WIDGET_RENDERER, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" } });
  }

  const now = new Date();
  const today = parisNow(now).day;
  const [todos, events, mails] = await Promise.all([
    sb.from("todos").select("*").or("done.is.null,done.eq.false").order("sort_order").limit(300),
    sb.from("events").select("date, time, title, type, who").gte("date", today).lte("date", addDays(today, 7))
      .or("deleted.is.null,deleted.eq.false").order("date").limit(200),
    // « * » : marche avec ou sans les colonnes read_at / box.
    sb.from("email_activity").select("*").eq("direction", "in").gte("created_at", new Date(now.getTime() - 7 * 86_400_000).toISOString())
      .order("created_at", { ascending: false }).limit(300),
  ]);
  if (todos.error || events.error) {
    console.error("widget: lecture", todos.error?.message, events.error?.message);
    return json({ error: "indisponible" }, 503);
  }
  // Mails illisibles : le widget garde tâches et planning, sans mails.
  if (mails.error) console.error("widget: mails", mails.error.message);
  return json(resumeWidget(todos.data ?? [], events.data ?? [], now, mails.data ?? [], readIgnoredSenders(blob[IGNORED_SENDERS_KEY])));
});
