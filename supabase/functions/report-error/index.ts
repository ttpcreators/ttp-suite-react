// ============================================================================
// report-error/index.ts
// ----------------------------------------------------------------------------
// Reçoit un crash de rendu depuis l'ErrorBoundary du front, le JOURNALISE dans
// public.error_log, et envoie UNE notif push à l'agence (« ⚠️ bug survenu »).
//
// AUTH : verify_jwt=false — le crash peut survenir même déconnecté (écran login).
// Anti-spam : on ne pousse QUE la première occurrence d'un même message sur 30 min
// (mais on journalise toujours). Respecte la préférence notifPrefs.pushErrors.
// ============================================================================

import { getServiceClient, corsHeaders } from "../_shared/google.ts";
import { loadNotifPrefs, makePayload, pushReady, sendTo } from "../_shared/push.ts";

/** notifPrefs depuis le blob agence (tout activé par défaut). */
async function pushErrorsEnabled(sb: ReturnType<typeof getServiceClient>): Promise<boolean> {
  return (await loadNotifPrefs(sb)).pushErrors !== false;
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const jsonRes = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonRes({ error: "method" }, 405);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: "bad_request" }, 400);
  }
  const message = String(body.message ?? "").slice(0, 500).trim();
  if (!message) return jsonRes({ error: "empty" }, 400);
  const page = String(body.page ?? "").slice(0, 80);
  const stack = String(body.stack ?? "").slice(0, 4000);
  const componentStack = String(body.componentStack ?? "").slice(0, 4000);
  const url = String(body.url ?? "").slice(0, 300);
  const userAgent = String(body.userAgent ?? "").slice(0, 300);
  const role = String(body.role ?? "").slice(0, 20);

  const sb = getServiceClient();

  // Garde-fou anti-flood : endpoint NON authentifié (verify_jwt=false) → un script
  // pourrait gonfler error_log sans limite. Au-delà de 60 insertions/minute (très
  // au-dessus du trafic d'erreurs réel), on cesse d'insérer. (audit 2026-07-13)
  const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
  const { count: recentCount } = await sb.from("error_log")
    .select("id", { count: "exact", head: true }).gte("created_at", oneMinAgo);
  const flooding = (recentCount ?? 0) > 60;

  // 1) Journalise (service role → bypass RLS), sauf en cas de flood manifeste.
  if (!flooding) {
    await sb.from("error_log").insert({
      message, page, stack, component_stack: componentStack, url, user_agent: userAgent, role,
    }).then(() => {}, () => {});
  }

  // 2) Push agence — seulement la 1re occurrence de ce message sur 30 min, ET au plus une
  //    notification toutes les 10 min tous messages confondus (des messages tous différents
  //    envoyés par un script ne doivent pas faire sonner les téléphones en boucle).
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { count } = await sb.from("error_log")
    .select("id", { count: "exact", head: true })
    .eq("message", message).gte("created_at", since);
  const occurrences = count ?? 1;
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count: anyRecent } = await sb.from("error_log")
    .select("id", { count: "exact", head: true }).gte("created_at", tenMinAgo);
  // Conservation : le journal ne garde que 90 jours (nettoyage de temps en temps).
  if (Math.random() < 0.05) {
    await sb.from("error_log").delete().lt("created_at", new Date(Date.now() - 90 * 86400_000).toISOString()).then(() => {}, () => {});
  }

  let pushed = 0;
  if (!flooding && occurrences <= 1 && (anyRecent ?? 1) <= 1 && pushReady() && (await pushErrorsEnabled(sb))) {
    // SÉCURITÉ (audit 2026-07-13) : endpoint non authentifié → NE PAS mettre de texte
    // contrôlé par l'appelant (message/page) dans la notif, sinon vecteur de phishing
    // vers les téléphones agence. Corps générique ; le détail reste dans error_log.
    // Tag FIXE → les pushs se remplacent au lieu de s'empiler (anti-spam).
    const payload = makePayload({
      kind: "error",
      title: "Erreur dans l'app",
      body: "Détail dans Diagnostique.",
      url: "/",
      tag: "ttp-error",
    });
    pushed = (await sendTo(sb, { agency: true }, payload)).sent;
  }

  return jsonRes({ ok: true, logged: true, occurrences, pushed });
});
