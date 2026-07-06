// ============================================================================
// gmail-send/index.ts
// ----------------------------------------------------------------------------
// Envoie un email depuis la VRAIE boîte Gmail de l'agence (OAuth), via l'API
// Gmail (scope gmail.send). Réservé à l'AGENCE (verify_jwt=true + rôle agence).
// Réutilise getAccessToken() (refresh auto du token, comme la sync Agenda).
//
// Entrée : { to, subject, html, threadId?, inReplyTo?, source?, contactName? }.
//  - threadId + inReplyTo : pour threader une relance dans le même fil (et
//    permettre la détection de réponse).
// Sortie : { ok, id, threadId }.
// Journalise dans email_activity (best-effort).
// ============================================================================

import { getServiceClient, getAccessToken, corsHeaders } from "../_shared/google.ts";

const GMAIL_SEND = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

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

/** Base64url des octets UTF-8 (sans padding) — format attendu par Gmail (raw). */
function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/** Objet encodé RFC 2047 (UTF-8) pour préserver les accents. */
function encSubject(s: string): string {
  const b = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return `=?UTF-8?B?${btoa(bin)}?=`;
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const jsonRes = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const sb = getServiceClient();
  if (!(await isAgency(req, sb))) return jsonRes({ error: "unauthorized" }, 401);

  let body: {
    to?: string; subject?: string; html?: string;
    threadId?: string; inReplyTo?: string; source?: string; contactName?: string;
    attachments?: { filename?: string; mimeType?: string; contentBase64?: string }[];
  } = {};
  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: "bad_request" }, 400);
  }

  const to = String(body.to ?? "").trim().toLowerCase();
  const subject = String(body.subject ?? "").trim();
  const html = body.html ?? "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return jsonRes({ error: "destinataire_invalide" }, 400);
  if (!subject) return jsonRes({ error: "objet_requis" }, 400);
  if (!html.trim()) return jsonRes({ error: "contenu_requis" }, 400);

  // Token OAuth Google (refresh auto). not_connected → l'agence doit (re)connecter Google.
  let token: string;
  try {
    token = await getAccessToken(sb);
  } catch (e) {
    const msg = (e as Error)?.message ?? "";
    if (msg === "not_connected" || msg === "invalid_grant")
      return jsonRes({ error: "google_non_connecte", detail: "Reconnecte Google (avec les droits Gmail) dans l'app." }, 409);
    return jsonRes({ error: "token_indisponible", detail: msg.slice(0, 160) }, 502);
  }

  // Construit le message MIME. Entêtes de base + threading éventuel.
  const attachments = (Array.isArray(body.attachments) ? body.attachments : []).filter((a) => a?.contentBase64);
  const base = [`To: ${to}`, `Subject: ${encSubject(subject)}`, "MIME-Version: 1.0"];
  if (body.inReplyTo) {
    base.push(`In-Reply-To: ${body.inReplyTo}`);
    base.push(`References: ${body.inReplyTo}`);
  }

  let mime: string;
  if (attachments.length === 0) {
    mime = [...base, 'Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: 8bit", "", html].join("\r\n");
  } else {
    // multipart/mixed : corps HTML + chaque pièce jointe (base64).
    const boundary = "ttp_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const lines = [
      ...base,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      html,
    ];
    for (const a of attachments) {
      const fn = String(a.filename ?? "piece-jointe").replace(/["\r\n]/g, "");
      const ct = String(a.mimeType || "application/octet-stream").replace(/[\r\n]/g, "");
      const content = String(a.contentBase64 ?? "").replace(/\s+/g, "");
      lines.push(
        `--${boundary}`,
        `Content-Type: ${ct}; name="${fn}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${fn}"`,
        "",
        content,
      );
    }
    lines.push(`--${boundary}--`, "");
    mime = lines.join("\r\n");
  }
  const raw = b64url(new TextEncoder().encode(mime));

  const payload: Record<string, unknown> = { raw };
  if (body.threadId) payload.threadId = body.threadId;

  const r = await fetch(GMAIL_SEND, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = String((data as { error?: { message?: string } })?.error?.message ?? r.status).slice(0, 200);
    // 403 = souvent scope gmail.send absent → reconnecter avec les nouveaux droits.
    if (r.status === 403) return jsonRes({ error: "gmail_scope_manquant", detail }, 403);
    return jsonRes({ error: "envoi_echoue", detail }, 502);
  }

  const id = (data as { id?: string }).id ?? null;
  const threadId = (data as { threadId?: string }).threadId ?? null;

  // Journal unifié (best-effort : n'échoue pas l'envoi si la table n'existe pas encore).
  try {
    await sb.from("email_activity").insert({
      contact_email: to,
      contact_name: body.contactName ?? null,
      direction: "out",
      subject,
      snippet: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180),
      source: body.source ?? "manual",
      thread_id: threadId,
      gmail_message_id: id,
    });
  } catch { /* table absente / RLS : on ignore */ }

  return jsonRes({ ok: true, id, threadId });
});
