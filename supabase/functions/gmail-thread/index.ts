// ============================================================================
// gmail-thread/index.ts
// ----------------------------------------------------------------------------
// Fil complet d'un échange Gmail : tous les messages + leur corps (texte/HTML).
// Réservé à l'AGENCE (verify_jwt=true + rôle agence). Scope gmail.readonly.
//
// Entrée : { threadId, contact?, box? } (box = "partnerships" défaut | "talent").  Sortie : { ok, messages:[{from,to,cc,subject,
//           date,html,text,direction,ts,attachments}] }.
// Pièce jointe : { action: "attachment", messageId, attachmentId, box? } → { ok, data (base64) }.
// ============================================================================

import { getServiceClient, corsHeaders } from "../_shared/google.ts";
import { boxToken, boxError, parseBox } from "../_shared/gmailBox.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

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

function decodeB64Url(data: string): string {
  try {
    const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

type Part = { mimeType?: string; filename?: string; body?: { data?: string; attachmentId?: string; size?: number }; parts?: Part[] };
type Attachment = { messageId: string; attachmentId: string; filename: string; mimeType: string; size: number };
const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

/** Extrait le corps HTML et/ou texte d'un message + ses pièces jointes (parcours récursif des parts). */
function extractBody(payload: Part | undefined, messageId: string): { html: string; text: string; attachments: Attachment[] } {
  let html = "";
  let text = "";
  const attachments: Attachment[] = [];
  const walk = (p?: Part) => {
    if (!p) return;
    if (p.filename && p.body?.attachmentId) {
      attachments.push({
        messageId, attachmentId: p.body.attachmentId, filename: p.filename,
        mimeType: p.mimeType ?? "application/octet-stream", size: p.body.size ?? 0,
      });
    } else if (p.mimeType === "text/html" && p.body?.data && !html) html = decodeB64Url(p.body.data);
    else if (p.mimeType === "text/plain" && p.body?.data && !text) text = decodeB64Url(p.body.data);
    if (p.parts) for (const c of p.parts) walk(c);
  };
  walk(payload);
  return { html, text, attachments };
}

type Header = { name: string; value: string };

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const jsonRes = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const sb = getServiceClient();
  if (!(await isAgency(req, sb))) return jsonRes({ error: "unauthorized" }, 401);

  let body: { threadId?: string; contact?: string; box?: string; action?: string; messageId?: string; attachmentId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: "bad_request" }, 400);
  }
  const threadId = String(body.threadId ?? "").trim();
  const contact = String(body.contact ?? "").trim().toLowerCase();
  const isAttachment = body.action === "attachment";
  if (!threadId && !isAttachment) return jsonRes({ error: "thread_requis" }, 400);

  let token: string;
  try {
    token = await boxToken(sb, parseBox(body.box), "read");
  } catch (e) {
    const be = boxError(e);
    return jsonRes({ error: be.error }, be.status);
  }

  // Téléchargement d'une pièce jointe (agence seulement, boîte choisie).
  if (isAttachment) {
    const messageId = String(body.messageId ?? "").trim();
    const attachmentId = String(body.attachmentId ?? "").trim();
    if (!messageId || !attachmentId) return jsonRes({ error: "bad_request" }, 400);
    const a = await fetch(`${GMAIL}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const ad = await a.json().catch(() => ({})) as { data?: string; size?: number };
    if (!a.ok || !ad.data) return jsonRes({ error: "introuvable" }, 404);
    if ((ad.size ?? 0) > ATTACHMENT_MAX_BYTES) return jsonRes({ error: "piece_trop_lourde" }, 413);
    return jsonRes({ ok: true, data: ad.data.replace(/-/g, "+").replace(/_/g, "/") });
  }

  const r = await fetch(`${GMAIL}/threads/${encodeURIComponent(threadId)}?format=full`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = String((data as { error?: { message?: string } })?.error?.message ?? r.status).slice(0, 200);
    if (r.status === 403) return jsonRes({ error: "gmail_scope_manquant", detail }, 403);
    return jsonRes({ error: "lecture_echouee", detail }, 502);
  }

  const raw = ((data as { messages?: { id: string; internalDate?: string; payload?: Part & { headers?: Header[] } }[] }).messages ?? []);
  const messages = raw.map((m) => {
    const headers: Header[] = m.payload?.headers ?? [];
    const h = (name: string) => headers.find((x) => x.name.toLowerCase() === name)?.value ?? "";
    const from = h("from");
    const { html, text, attachments } = extractBody(m.payload, m.id);
    const direction: "in" | "out" = contact && from.toLowerCase().includes(contact) ? "in" : contact ? "out" : "in";
    return {
      id: m.id,
      from,
      to: h("to"),
      cc: h("cc"),
      subject: h("subject"),
      date: h("date"),
      html,
      text,
      direction,
      ts: Number(m.internalDate ?? 0),
      attachments,
    };
  }).sort((a, b) => a.ts - b.ts); // ordre chronologique (conversation)

  return jsonRes({ ok: true, messages });
});
