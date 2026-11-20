// ============================================================================
// site-lead/index.ts : formulaire « Recevoir le roster » du site ttpcreators.pro.
// ----------------------------------------------------------------------------
// POST { email, marque, nom?, message?, site? (piège à robots) } depuis le site
// (CORS : ttpcreators.pro seulement) → contact « Lead site » du carnet (ou touche ajoutée
// au contact existant), tâche de tri pour Gianni, push générique à l'agence.
// Renvoie { ok, roster } : le site affiche tout de suite le lien du deck agence.
// AUTH : verify_jwt = false (site public). Garde-fous : piège à robots, 30 demandes par
// heure au plus, aucun texte du visiteur dans la notification. Règles : _shared/siteLead.ts.
// ============================================================================

import { getServiceClient } from "../_shared/google.ts";
import { makePayload, pushReady, sendTo } from "../_shared/push.ts";
import { LEADS_PAR_HEURE, LEAD_ORIGINS, LEAD_TAG, ROSTER_URL, lireLead, tacheLead, toucheLead } from "../_shared/siteLead.ts";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const cors: Record<string, string> = {
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
    ...(origin && LEAD_ORIGINS.includes(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
  };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (origin && !LEAD_ORIGINS.includes(origin)) return json({ error: "origin" }, 403);

  const r = lireLead(await req.json().catch(() => null));
  if ("robot" in r) return json({ ok: true, roster: ROSTER_URL });
  if ("erreur" in r) return json({ error: r.erreur }, 400);
  const { lead } = r;

  const sb = getServiceClient();
  const now = new Date();
  const { count } = await sb.from("contacts").select("id", { count: "exact", head: true }).eq("tag", LEAD_TAG).gte("created_at", new Date(now.getTime() - 3600_000).toISOString());
  if ((count ?? 0) >= LEADS_PAR_HEURE) return json({ error: "trop" }, 429);

  const touche = toucheLead(lead, now);
  const { data: existants } = await sb.from("contacts").select("id, touches").ilike("email", lead.email).limit(1);
  const ex = (existants as { id: string; touches: unknown }[] | null)?.[0];
  if (ex) {
    const touches = Array.isArray(ex.touches) ? ex.touches : [];
    const { error } = await sb.from("contacts").update({ touches: [...touches, touche] }).eq("id", ex.id);
    if (error) return json({ error: "indisponible" }, 503);
  } else {
    const { error } = await sb.from("contacts").insert({ brand: lead.marque, person: lead.nom || null, email: lead.email, tag: LEAD_TAG, touches: [touche] });
    if (error) {
      console.error("site-lead contact", error.message);
      return json({ error: "indisponible" }, 503);
    }
  }
  await sb.from("todos").insert({ text: tacheLead(lead), descr: `${lead.email}${lead.message ? `\n${lead.message}` : ""}`, priority: "haute", due: now.toISOString().slice(0, 10), done: false }).then(() => {}, () => {});
  if (pushReady()) {
    await sendTo(sb, { agency: true }, makePayload({ kind: "team", title: "Demande de roster sur le site", body: "Une marque veut recevoir le roster. Détail dans la to-do.", url: "/?open=view&view=todo", tag: "ttp-site-lead" })).catch(() => {});
  }
  return json({ ok: true, roster: ROSTER_URL });
});
