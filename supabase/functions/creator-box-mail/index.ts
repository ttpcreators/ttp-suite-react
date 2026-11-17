// ============================================================================
// creator-box-mail/index.ts : la boîte Gmail d'un créateur dans la page Mails de l'app
// (demande de Marc, 16 novembre 2026 : lire et répondre aux mails de Léna depuis TTP Suite,
// sans Spark). Boîtes reliées par creator-box-callback (table creator_mail_boxes).
// ----------------------------------------------------------------------------
// POST { action: "boxes" }                                  → boîtes reliées
// POST { action: "list", box, folder: "inbox"|"sent", q? }  → fils (30 au plus)
// POST { action: "thread", box, threadId }                  → messages du fil
// POST { action: "send", box, to, cc?, subject?, text, threadId? } → envoi, avec la
//      signature Gmail du créateur (jamais celle de l'agence)
// Droits Gmail de ces boîtes : lire et écrire (gmail.readonly + gmail.compose). Pas
// d'archive, de corbeille ni de « lu » : ces gestes se font dans la boîte du créateur.
// AUTH : JWT (verify_jwt par défaut) ET fondateur (boîte personnelle d'un créateur).
// ============================================================================

import { corsHeaders, getServiceClient } from "../_shared/google.ts";
import { listCreatorBoxes } from "../_shared/creatorBox.ts";
import { addressList, mailHtml } from "../_shared/mcpAdmin.ts";
import { listSendAs, parseMailBox, readThreadMessages, searchThreads, sendMail } from "../ttp-mcp/gmail.ts";

async function isFounder(req: Request, sb: ReturnType<typeof getServiceClient>): Promise<boolean> {
  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  if (!bearer) return false;
  const { data, error } = await sb.auth.getUser(bearer);
  if (error || !data?.user) return false;
  const { data: prof } = await sb.from("profiles").select("role, agency_role").eq("user_id", data.user.id).maybeSingle<{ role: string; agency_role: string | null }>();
  return !!prof && prof.role === "agency" && (prof.agency_role ?? "member") === "founder";
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const sb = getServiceClient();
  if (!(await isFounder(req, sb))) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const action = String(body.action ?? "");

  if (action === "boxes") {
    const rows = await listCreatorBoxes(sb);
    return json({ ok: true, boxes: rows.map((r) => ({ email: r.email, creator: r.creator, connected: r.connected })) });
  }

  // Seulement une boîte de créateur reliée (jamais partnerships@ ni talent@ par ici).
  const raw = String(body.box ?? "");
  if (!raw.includes("@")) return json({ error: "boite_invalide" }, 400);
  const pb = await parseMailBox(sb, raw);
  if ("error" in pb) return json({ error: "boite_non_connectee" }, 409);
  const box = pb.box;

  try {
    if (action === "list") {
      const folder = body.folder === "sent" ? "in:sent" : "in:inbox";
      const q = String(body.q ?? "").slice(0, 200).trim();
      const { threads, errors } = await searchThreads(sb, box, `${folder}${q ? ` ${q}` : ""}`, 30);
      if (errors.length && !threads.length) return json({ error: "boite_illisible", detail: errors[0] }, 502);
      return json({ ok: true, threads });
    }
    if (action === "thread") {
      const id = String(body.threadId ?? "");
      if (!/^[A-Za-z0-9]+$/.test(id)) return json({ error: "fil_invalide" }, 400);
      return json({ ok: true, ...(await readThreadMessages(sb, box, id)) });
    }
    if (action === "send") {
      const to = addressList(body.to);
      const cc = addressList(body.cc ?? "");
      const text = String(body.text ?? "").trim().slice(0, 20000);
      const threadId = String(body.threadId ?? "");
      if (!to?.length) return json({ error: "destinataire_invalide" }, 400);
      if (!cc) return json({ error: "copie_invalide" }, 400);
      if (!text) return json({ error: "message_vide" }, 400);
      if (threadId && !/^[A-Za-z0-9]+$/.test(threadId)) return json({ error: "fil_invalide" }, 400);
      if (!threadId && !String(body.subject ?? "").trim()) return json({ error: "objet_manquant" }, 400);
      const me = (await listSendAs(sb, box).catch(() => [])).find((x) => x.primary);
      const r = await sendMail(sb, box, { to, cc, bcc: [], subject: String(body.subject ?? "").slice(0, 300), html: mailHtml(text, me?.signature ?? ""), threadId: threadId || undefined });
      return json({ ok: true, id: r.id, threadId: r.threadId });
    }
    return json({ error: "action_inconnue" }, 400);
  } catch (e) {
    const m = (e as Error).message ?? "";
    if (m === "boite_createur_non_connectee") return json({ error: "boite_non_connectee" }, 409);
    return json({ error: "gmail_erreur", detail: m.slice(0, 200) }, 502);
  }
});
