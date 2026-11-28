// ============================================================================
// site-lead/index.ts : formulaires publics du site ttpcreators.pro.
// ----------------------------------------------------------------------------
// « Recevoir le roster » : POST { email, marque, nom?, message?, site? (piège à robots) }
// (CORS : ttpcreators.pro seulement) → contact « Lead site » du carnet (ou touche ajoutée
// au contact existant), tâche de tri pour Gianni, push générique à l'agence.
// Renvoie { ok, roster } : le site affiche tout de suite le lien du deck agence.
// « Rejoindre l'agence » : POST { type: "createur", nom, email, compte, reseau?, niche?, message?, site? }
// → tâche de tri (écrite d'abord : c'est elle que compte le plafond), puis profil au scouting
// créateurs (creator_pool) : une ligne ajoutée à la note du profil du même compte sur le même
// réseau, sans jamais couper la note de l'agence, sinon un nouveau profil (si le même compte n'y
// est que sur l'autre réseau, les deux profils se citent dans leur note), push générique. Renvoie
// { ok }. Une lecture ou une écriture du scouting qui échoue retire la tâche et répond 503 (sauf la
// ligne ajoutée au profil de l'autre réseau, notée au journal). Une ancienne version déployée
// répond 400 (« marque » manquante) : le site propose alors un e-mail pré-rempli.
// AUTH : verify_jwt = false (site public). Garde-fous : piège à robots, 30 demandes par
// heure au plus, aucun texte du visiteur dans la notification. Règles : _shared/siteLead.ts.
// ============================================================================

import { getServiceClient } from "../_shared/google.ts";
import { makePayload, pushReady, sendTo } from "../_shared/push.ts";
import { CANDIDATURE_TACHE, LEADS_PAR_HEURE, LEAD_ORIGINS, LEAD_TAG, ROSTER_URL, chercherProfil, ilikeExact, jourParis, ligneAutreReseau, ligneCandidature, ligneScouting, lireCandidature, lireLead, noteFusionnee, tacheCandidature, tacheLead, toucheLead } from "../_shared/siteLead.ts";

type Json = (b: unknown, status?: number) => Response;

/** Un créateur veut rejoindre l'agence : profil au scouting, tâche de tri, push sans texte du visiteur. */
async function candidature(body: unknown, json: Json): Promise<Response> {
  const r = lireCandidature(body);
  if ("robot" in r) return json({ ok: true });
  if ("erreur" in r) return json({ error: r.erreur }, 400);
  const { cand } = r;

  const sb = getServiceClient();
  const now = new Date();
  // La tâche d'abord, puis le plafond compté en l'incluant : des demandes simultanées ne passent pas
  // toutes (une tâche en trop est retirée aussitôt).
  const reseau = cand.reseau === "tiktok" ? "TikTok" : "Instagram";
  const descr = `${cand.email}\n${cand.compte} (${reseau})${cand.niche ? ` · ${cand.niche}` : ""}${cand.message ? `\n${cand.message}` : ""}`;
  const { data: tache, error: eT } = await sb.from("todos").insert({ text: tacheCandidature(cand), descr, priority: "moyenne", due: jourParis(now), done: false }).select("id").single<{ id: string }>();
  if (eT || !tache) return json({ error: "indisponible" }, 503);
  const retirer = () => sb.from("todos").delete().eq("id", tache.id).then(({ error }) => {
    if (error) console.error("site-lead candidature : tâche non retirée", error.message);
  }, () => {});
  const { count } = await sb.from("todos").select("id", { count: "exact", head: true }).like("text", `${CANDIDATURE_TACHE}%`).gte("created_at", new Date(now.getTime() - 3600_000).toISOString());
  if ((count ?? 0) > LEADS_PAR_HEURE) {
    await retirer();
    return json({ error: "trop" }, 429);
  }

  // Même compte, sur le même réseau, déjà au scouting (@compte ou lien Instagram, lien TikTok, quelle
  // que soit la casse) : une ligne courte est ajoutée à sa note, sans jamais couper ce que l'agence y a
  // écrit. Toutes les lignes proches sont lues, page par page (ordre des id) ; une lecture échouée n'est
  // jamais prise pour « aucun profil », ce qui créerait un doublon.
  const motif = `*${ilikeExact(cand.compte.slice(1).toLowerCase())}*`;
  const trouve = await chercherProfil((apres, taille) => {
    const q = sb.from("creator_pool").select("id, note, handle").ilike("handle", motif);
    return (apres ? q.gt("id", apres) : q).order("id").limit(taille);
  }, cand);
  if ("erreur" in trouve) {
    console.error("site-lead candidature : recherche du profil", trouve.erreur);
    await retirer();
    return json({ error: "indisponible" }, 503);
  }
  if ("profil" in trouve) {
    const { error } = await sb.from("creator_pool").update({ note: noteFusionnee(trouve.profil.note, ligneCandidature(cand, now)) }).eq("id", trouve.profil.id);
    if (error) {
      console.error("site-lead candidature : note", error.message);
      await retirer();
      return json({ error: "indisponible" }, 503);
    }
  } else {
    // Rang après le dernier profil rangé. Un profil sans rang (NULL) ne compte pas : Postgres le met en
    // tête d'un tri décroissant, et la candidature aurait pris le rang 1.
    const { data: top, error: eR } = await sb.from("creator_pool").select("sort_order").not("sort_order", "is", null).order("sort_order", { ascending: false }).limit(1);
    if (eR) {
      console.error("site-lead candidature : rang", eR.message);
      await retirer();
      return json({ error: "indisponible" }, 503);
    }
    const rang = ((top as { sort_order: number }[] | null)?.[0]?.sort_order ?? 0) + 1;
    const autre = "autreReseau" in trouve ? trouve.autreReseau : null;
    const { error } = await sb.from("creator_pool").insert({ ...ligneScouting(cand, now, autre !== null), sort_order: rang });
    if (error) {
      console.error("site-lead candidature", error.message);
      await retirer();
      return json({ error: "indisponible" }, 503);
    }
    // Même compte au scouting sur l'autre réseau seulement (souvent la même personne) : son profil reçoit
    // une ligne qui signale la candidature, sans couper la note de l'agence. Le nouveau profil est déjà
    // écrit : un échec ici est noté au journal, sans faire échouer la candidature.
    if (autre) {
      const { error: eA } = await sb.from("creator_pool").update({ note: noteFusionnee(autre.note, ligneAutreReseau(cand, now)) }).eq("id", autre.id);
      if (eA) console.error("site-lead candidature : note du profil de l'autre réseau", eA.message);
    }
  }
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
  const { data: existants } = await sb.from("contacts").select("id, touches, email").ilike("email", ilikeExact(lead.email)).limit(5);
  const ex = ((existants as { id: string; touches: unknown; email: string | null }[] | null) ?? []).find((c) => String(c.email ?? "").toLowerCase() === lead.email);
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
  await sb.from("todos").insert({ text: tacheLead(lead), descr: `${lead.email}${lead.message ? `\n${lead.message}` : ""}`, priority: "haute", due: jourParis(now), done: false }).then(({ error }) => {
    if (error) console.warn("site-lead tâche refusée", error.message);
  }, () => {});
  if (pushReady()) {
    await sendTo(sb, { agency: true }, makePayload({ kind: "team", title: "Demande de roster sur le site", body: "Une marque veut recevoir le roster. Détail dans la to-do.", url: "/?open=view&view=todo", tag: "ttp-site-lead" })).catch(() => {});
  }
  return json({ ok: true, roster: ROSTER_URL });
});
