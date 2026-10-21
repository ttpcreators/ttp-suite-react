// ============================================================================
// meet-invite/index.ts : « Proposer un rendez-vous » depuis l'app (page Mails).
// ----------------------------------------------------------------------------
// Crée un évènement dans le Google Agenda relié à l'app (partnerships@), avec un
// lien Google Meet, et laisse Google envoyer l'invitation aux invités
// (sendUpdates=all). L'évènement arrive ensuite dans le Planning par la sync.
// Droit utilisé : calendar.events (déjà accordé à la connexion Google de l'app).
//
// Entrée : { title, date "AAAA-MM-JJ", time "HH:MM", duration (min), guests[],
//            meet?: bool (défaut oui), invite?: bool (défaut oui), note?, who? }
// Sortie : { ok, meetUrl, htmlLink, eventId, invited } ou { error } :
//   unauthorized 401, bad_request / titre_requis / date_invalide / heure_invalide /
//   duree_invalide / invite_invalide / trop_d_invites 400,
//   google_non_connecte 409, agenda_droit_manquant 403, agenda_echec 502.
// ============================================================================

import { APP_TIMEZONE, CALENDAR_ID, corsHeaders, gcalFetch, getServiceClient, triggerSync } from "../_shared/google.ts";
import { meetEventBody, meetLinkOf, parseMeetRequest } from "../_shared/meetEvent.ts";

async function isAgency(req: Request, sb: ReturnType<typeof getServiceClient>): Promise<boolean> {
  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  if (!bearer) return false;
  const { data, error } = await sb.auth.getUser(bearer);
  if (error || !data?.user) return false;
  const { data: prof, error: profErr } = await sb
    .from("profiles").select("role").eq("user_id", data.user.id).maybeSingle<{ role: string }>();
  if (profErr || !prof) return false;
  return prof.role === "agency";
}

type GEvent = { id?: string; htmlLink?: string; hangoutLink?: string; conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] } };

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const jsonRes = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);

  const sb = getServiceClient();
  if (!(await isAgency(req, sb))) return jsonRes({ error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: "bad_request" }, 400);
  }
  const r = parseMeetRequest(body ?? {});
  if ("error" in r) return jsonRes({ error: r.error }, 400);

  const cal = `/calendars/${encodeURIComponent(CALENDAR_ID)}/events`;
  let res: Response;
  try {
    res = await gcalFetch(sb, `${cal}?conferenceDataVersion=1&sendUpdates=${r.invite ? "all" : "none"}`, {
      method: "POST",
      body: JSON.stringify(meetEventBody(r, APP_TIMEZONE, crypto.randomUUID())),
    }, { maxRetries: 2 });
  } catch (e) {
    const msg = String((e as Error)?.message ?? "");
    if (msg === "not_connected" || msg === "invalid_grant") return jsonRes({ error: "google_non_connecte" }, 409);
    return jsonRes({ error: "agenda_echec" }, 502);
  }
  const ev = await res.json().catch(() => ({})) as GEvent;
  if (!res.ok || !ev.id) {
    if (res.status === 403) return jsonRes({ error: "agenda_droit_manquant" }, 403);
    if (res.status === 401) return jsonRes({ error: "google_non_connecte" }, 409);
    console.error("meet-invite", res.status, JSON.stringify(ev).slice(0, 300));
    return jsonRes({ error: "agenda_echec" }, 502);
  }

  // Le lien Meet est presque toujours prêt tout de suite ; sinon on relit une fois.
  let meetUrl = r.meet ? meetLinkOf(ev) : "";
  if (r.meet && !meetUrl) {
    await new Promise((ok) => setTimeout(ok, 1500));
    const again = await gcalFetch(sb, `${cal}/${encodeURIComponent(ev.id)}`, {}, { maxRetries: 1 }).catch(() => null);
    if (again?.ok) meetUrl = meetLinkOf(await again.json().catch(() => ({})) as GEvent);
  }

  // Lien Meet aussi dans la description (lisible dans le Planning de l'app), sans renvoyer d'invitation.
  if (meetUrl) {
    const description = [r.note, `Lien Google Meet : ${meetUrl}`].filter(Boolean).join("\n\n");
    await gcalFetch(sb, `${cal}/${encodeURIComponent(ev.id)}?sendUpdates=none`, {
      method: "PATCH",
      body: JSON.stringify({ description }),
    }, { maxRetries: 1 }).catch(() => null);
  }

  triggerSync("webhook"); // l'évènement arrive dans le Planning
  return jsonRes({ ok: true, eventId: ev.id, htmlLink: ev.htmlLink ?? "", meetUrl, invited: r.invite ? r.guests.length : 0 });
});
