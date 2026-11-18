// ============================================================================
// agent-watchdog/index.ts : l'alerte « Alfred ne répond plus ».
// ----------------------------------------------------------------------------
// Alfred (agent de Marc, sur un Mac de l'agence) note chaque matin de semaine son
// « Point du matin » dans le journal des agents (agent.journal). S'il ne peut pas
// travailler (Mac éteint ou en veille, Claude déconnecté), il ne peut pas prévenir lui
// même : cette fonction, appelée par pg_cron, regarde le journal et pousse une
// notification aux fondateurs (Marc et Gianni) s'il n'a rien noté ce matin.
// Une seule alerte par jour (trace « veille_alfred » dans le journal). Rien le week-end.
// Et, toutes les 5 minutes (demande de Marc, 17 novembre 2026) : l'iMac donne son pouls
// chaque minute (alfred-pont) ; muet depuis 15 minutes, entre 7 h et 23 h, alerte aux
// fondateurs et sur le Telegram de Marc (ALFRED_BOT_TOKEN, TELEGRAM_CHAT_ID), une par panne.
//
// AUTH : verify_jwt = false (config.toml) + Bearer CRON_SECRET (comme daily-digest).
// Secrets : CRON_SECRET, VAPID_* (envoi des notifications).
// ============================================================================

import { getServiceClient, timingSafeEqualStr } from "../_shared/google.ts";
import { makePayload, pushReady, sendTo } from "../_shared/push.ts";
import { veilleAlfred } from "../_shared/watchdog.ts";
import { alfredHorsLigne } from "../_shared/alfredPont.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

Deno.serve(async (req: Request) => {
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!CRON_SECRET || !timingSafeEqualStr(bearer, CRON_SECRET)) return json({ error: "unauthorized" }, 401);

  const sb = getServiceClient();
  const db = sb.schema("agent");
  const { data: agents } = await db.from("agents").select("id, nom, slug, vu_le, hors_ligne_alerte_le").or("slug.eq.talent-manager,nom.ilike.Alfred").limit(1);
  const alfred = ((agents as { id: string; nom: string; vu_le: string | null; hors_ligne_alerte_le: string | null }[] | null) ?? [])[0];
  if (!alfred) return json({ ok: true, skipped: "agent_introuvable" });

  // Le pouls : l'iMac se tait depuis 15 minutes.
  const pouls = alfredHorsLigne(new Date(), alfred.vu_le ?? null, alfred.hors_ligne_alerte_le ?? null);
  if (pouls.alerte) {
    const depuis = new Date(alfred.vu_le as string).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).replace(":", " h ");
    const message = `${alfred.nom} ne répond plus depuis ${depuis} : l'iMac est peut-être éteint, en veille ou sans internet. Tes messages l'attendront ; vérifie l'iMac dès que tu peux.`;
    let sentPouls = 0;
    if (pushReady()) {
      const r = await sendTo(sb, { agency: true, audience: "founders" }, makePayload({ kind: "digest", title: `${alfred.nom} hors ligne`, body: message, tag: "alfred-hors-ligne", url: "/?open=view&view=agent" }));
      sentPouls = r.sent;
    }
    const bot = Deno.env.get("ALFRED_BOT_TOKEN") ?? "";
    const chat = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";
    if (bot && chat) {
      await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chat, text: `🔴 ${message}` }) }).catch(() => null);
    }
    await db.from("agents").update({ hors_ligne_alerte_le: new Date().toISOString() }).eq("id", alfred.id);
    await db.from("journal").insert({ action: "alfred_hors_ligne", detail: `Alerte envoyée (${sentPouls} téléphone(s)${bot && chat ? ", Telegram" : ""}) : ${message}`, agent_id: alfred.id });
  }

  const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
  const { data: rows, error } = await db.from("journal").select("action, cree_le").eq("agent_id", alfred.id).gte("cree_le", since).order("cree_le", { ascending: false }).limit(200);
  if (error) return json({ error: "journal_illisible", detail: error.message }, 500);

  const verdict = veilleAlfred(new Date(), ((rows as { action: string; cree_le: string }[] | null) ?? []));
  if (verdict.etat !== "alerte") return json({ ok: true, etat: verdict.etat });

  let sent = 0;
  if (pushReady()) {
    const r = await sendTo(sb, { agency: true, audience: "founders" }, makePayload({
      kind: "digest",
      title: `${alfred.nom} ne répond plus`,
      body: verdict.message,
      tag: "veille-alfred",
      url: "/",
    }));
    sent = r.sent;
  }
  await db.from("journal").insert({ action: "veille_alfred", detail: `Alerte envoyée aux fondateurs (${sent} téléphone(s)) : ${verdict.message}`, agent_id: alfred.id });
  return json({ ok: true, etat: "alerte", sent });
});
