// ============================================================================
// send-email/index.ts
// ----------------------------------------------------------------------------
// Envoie un email via Resend — la clé API reste un SECRET serveur (RESEND_API_KEY),
// jamais côté client. Réservé à l'AGENCE (verify_jwt=true + contrôle du rôle).
//
// Secrets : RESEND_API_KEY (obligatoire), RESEND_FROM (optionnel, sinon
// onboarding@resend.dev — qui n'envoie qu'à l'adresse du compte Resend tant que
// le domaine ttpcreators.pro n'est pas vérifié).
// Entrée : { to, subject, html, replyTo? }.
// ============================================================================

import { getServiceClient, corsHeaders } from "../_shared/google.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "TTP Creators <onboarding@resend.dev>";

async function isAgency(req: Request, sb: ReturnType<typeof getServiceClient>): Promise<boolean> {
  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  if (!bearer) return false;
  const { data, error } = await sb.auth.getUser(bearer);
  if (error || !data?.user) return false;
  const { data: prof, error: profErr } = await sb
    .from("profiles").select("role").eq("user_id", data.user.id).maybeSingle<{ role: string }>();
  if (profErr || !prof) return false; // fail-closed
  return prof.role === "agency";
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const jsonRes = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const sb = getServiceClient();
  if (!(await isAgency(req, sb))) return jsonRes({ error: "unauthorized" }, 401);
  if (!RESEND_API_KEY) return jsonRes({ error: "resend_non_configure" }, 500);

  let body: {
    to?: string | string[]; subject?: string; html?: string; replyTo?: string; source?: string;
    attachments?: { filename?: string; contentBase64?: string }[];
  } = {};
  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: "bad_request" }, 400);
  }
  const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  // Destinataires : un seul ou plusieurs → UN email SÉPARÉ par personne (elles ne
  // se voient pas entre elles). Dédoublonnage + validation.
  const rawList = Array.isArray(body.to) ? body.to : [body.to ?? ""];
  const recipients = [...new Set(rawList.map((e) => String(e).trim().toLowerCase()).filter((e) => emailRe.test(e)))];
  const subject = (body.subject ?? "").trim();
  const html = body.html ?? "";
  if (recipients.length === 0) return jsonRes({ error: "destinataire_invalide" }, 400);
  if (recipients.length > 100) return jsonRes({ error: "trop_de_destinataires" }, 400);
  if (!subject) return jsonRes({ error: "objet_requis" }, 400);
  if (!html.trim()) return jsonRes({ error: "contenu_requis" }, 400);
  const replyTo = body.replyTo && emailRe.test(body.replyTo) ? body.replyTo : undefined;
  // Pièces jointes Resend : { filename, content(base64) }.
  const attachments = (Array.isArray(body.attachments) ? body.attachments : [])
    .filter((a) => a?.contentBase64)
    .map((a) => ({ filename: String(a.filename ?? "piece-jointe"), content: String(a.contentBase64) }));

  let sent = 0;
  const errors: string[] = [];
  for (const to of recipients) {
    const payload: Record<string, unknown> = { from: RESEND_FROM, to: [to], subject, html };
    if (replyTo) payload.reply_to = replyTo;
    if (attachments.length) payload.attachments = attachments;
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        sent++;
        // Journal unifié (best-effort) : l'envoi Resend apparaît dans l'historique.
        await sb.from("email_activity").insert({
          contact_email: to,
          direction: "out",
          subject,
          snippet: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180),
          source: typeof body.source === "string" ? body.source : "manual",
        }).catch(() => {});
      } else {
        const data = await r.json().catch(() => ({}));
        errors.push(`${to}: ${String((data as { message?: string })?.message ?? r.status).slice(0, 160)}`);
      }
    } catch (e) {
      errors.push(`${to}: ${(e as Error)?.message ?? "réseau"}`.slice(0, 160));
    }
  }
  return jsonRes({ ok: sent > 0, sent, total: recipients.length, failed: recipients.length - sent, detail: errors[0] ?? null });
});
