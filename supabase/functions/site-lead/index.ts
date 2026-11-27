// ============================================================================
// site-lead/index.ts : formulaires publics du site ttpcreators.pro.
// ----------------------------------------------------------------------------
// « Recevoir le roster » : POST { email, marque, nom?, message?, site? (piège à robots) }
// (CORS : ttpcreators.pro seulement) → contact « Lead site » du carnet (ou touche ajoutée
// au contact existant), tâche de tri pour Gianni, push générique à l'agence.
// Renvoie { ok, roster } : le site affiche tout de suite le lien du deck agence.
// « Rejoindre l'agence » : POST { type: "createur", nom, email, compte, niche?, message?, site? }
// → profil au scouting créateurs (creator_pool, ou note ajoutée au profil du même compte),
// tâche de tri, push générique. Renvoie { ok }. Une ancienne version déployée répond 400
// (« marque » manquante) : le site ouvre alors un e-mail pré-rempli à la place.
// AUTH : verify_jwt = false (site public). Garde-fous : piège à robots, 30 demandes par
// heure au plus, aucun texte du visiteur dans la notification. Règles : _shared/siteLead.ts.
// ============================================================================

import { getServiceClient } from "../_shared/google.ts";
import { makePayload, pushReady, sendTo } from "../_shared/push.ts";
import { CANDIDATURE_TACHE, LEADS_PAR_HEURE, LEAD_ORIGINS, LEAD_TAG, ROSTER_URL, ilikeExact, ligneScouting, lireCandidature, lireLead, noteCandidature, tacheCandidature, tacheLead, toucheLead } from "../_shared/siteLead.ts";

type Json = (b: unknown, status?: number) => Response;

/** Un créateur veut rejoindre l'agence : profil au scouting, tâche de tri, push sans texte du visiteur. */
async function candidature(body: unknown, json: Json): Promise<Response> {
  const r = lireCandidature(body);
  if ("robot" in r) return json({ ok: true });
  if ("erreur" in r) return json({ error: r.erreur }, 400);
  const { cand } = r;

  const sb = getServiceClient();
  const now = new Date();
  // Plafond compté sur les tâches « Candidature site : … », créées à CHAQUE candidature.
  const { count } = await sb.from("todos").select("id", { count: "exact", head: true }).like("text", `${CANDIDATURE_TACHE}%`).gte("created_at", new Date(now.getTime() - 3600_000).toISOString());
  if ((count ?? 0) >= LEADS_PAR_HEURE) return json({ error: "trop" }, 429);

  // Même compte déjà au scouting (enregistré avec ou sans @) : on complète sa note.
  const h = cand.compte.slice(1);
  let ex: { id: string; note: string | null } | undefined;
  for (const v of [h, `@${h}`]) {
    const { data } = await sb.from("creator_pool").select("id, note").ilike("handle", ilikeExact(v)).limit(1);
    ex = (data as { id: string; note: string | null }[] | null)?.[0];
    if (ex) break;
  }
  if (ex) {
    const { error } = await sb.from("creator_pool").update({ note: [ex.note, noteCandidature(cand, now)].filter(Boolean).join("\n").slice(-2000) }).eq("id", ex.id);
    if (error) return json({ error: "indisponible" }, 503);
  } else {
    const { data: top } = await sb.from("creator_pool").select("sort_order").order("sort_order", { ascending: false }).limit(1);
    const rang = ((top as { sort_order: number | null }[] | null)?.[0]?.sort_order ?? 0) + 1;
    const { error } = await sb.from("creator_pool").insert({ ...ligneScouting(cand, now), sort_order: rang });
    if (error) {
      console.error("site-lead candidature", error.message);
      return json({ error: "indisponible" }, 503);
    }
  }
  const descr = `${cand.email}\n${cand.compte}${cand.niche ? ` · ${cand.niche}` : ""}${cand.message ? `\n${cand.message}` : ""}`;
  await sb.from("todos").insert({ text: tacheCandidature(cand), descr, priority: "moyenne", due: now.toISOString().slice(0, 10), done: false }).then(() => {}, () => {});
  if (pushReady()) {
    await sendTo(sb, { agency: true }, makePayload({ kind: "team", title: "Candidature sur le site", body: "Un créateur veut rejoindre l'agence. Détail dans la to-do.", url: "/?open=view&view=todo", tag: "ttp-site-candidature" })).catch(() => {});
  }
  return json({ ok: true });
}

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

  const body = await req.json().catch(() => null);
  if (body && typeof body === "object" && (body as Record<string, unknown>).type === "createur") return candidature(body, json);
  const r = lireLead(body);
  if ("robot" in r) return json({ ok: true, roster: ROSTER_URL });
  if ("erreur" in r) return json({ error: r.erreur }, 400);
  const { lead } = r;

  const sb = getServiceClient();
  const now = new Date();
  // Plafond compté sur les tâches « Lead site : … », créées à CHAQUE demande (un contact déjà
  // au carnet n'en crée pas, il ne peut donc pas servir à compter).
  const { count } = await sb.from("todos").select("id", { count: "exact", head: true }).like("text", "Lead site : %").gte("created_at", new Date(now.getTime() - 3600_000).toISOString());
  if ((count ?? 0) >= LEADS_PAR_HEURE) return json({ error: "trop" }, 429);

  const touche = toucheLead(lead, now);
  const { data: existants } = await sb.from("contacts").select("id, touches").ilike("email", ilikeExact(lead.email)).limit(1);
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
