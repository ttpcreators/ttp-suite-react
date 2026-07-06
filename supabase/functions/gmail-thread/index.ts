// ============================================================================
// gmail-thread/index.ts
// ----------------------------------------------------------------------------
// Fil complet d'un échange Gmail : tous les messages + leur corps (texte/HTML).
// Réservé à l'AGENCE (verify_jwt=true + rôle agence). Scope gmail.readonly.
//
// Entrée : { threadId, contact? }.  Sortie : { ok, messages:[{from,to,subject,
//           date,html,text,direction,ts}] }.
// ============================================================================

import { getServiceClient, getAccessToken, corsHeaders } from "../_shared/google.ts";

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

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[] };
/** Extrait le corps HTML et/ou texte d'un message (parcours récursif des parts). */
function extractBody(payload: Part | undefined): { html: string; text: string } {
  let html = "";
  let text = "";
  const walk = (p?: Part) => {
    if (!p) return;
    if (p.mimeType === "text/html" && p.body?.data && !html) html = decodeB64Url(p.body.data);
    else if (p.mimeType === "text/plain" && p.body?.data && !text) text = decodeB64Url(p.body.data);
    if (p.parts) for (const c of p.parts) walk(c);
  };
  walk(payload);
  return { html, text };
}

type Header = { name: string; value: string };

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const jsonRes = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const sb = getServiceClient();
  if (!(await isAgency(req, sb))) return jsonRes({ error: "unauthorized" }, 401);

  let body: { threadId?: string; contact?: string } = {};
  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: "bad_request" }, 400);
  }
  const threadId = String(body.threadId ?? "").trim();
  const contact = String(body.contact ?? "").trim().toLowerCase();
  if (!threadId) return jsonRes({ error: "thread_requis" }, 400);

  let token: string;
  try {
    token = await getAccessToken(sb);
  } catch (e) {
    const msg = (e as Error)?.message ?? "";
    if (msg === "not_connected" || msg === "invalid_grant")
      return jsonRes({ error: "google_non_connecte" }, 409);
    return jsonRes({ error: "token_indisponible", detail: msg.slice(0, 160) }, 502);
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
    const { html, text } = extractBody(m.payload);
    const direction: "in" | "out" = contact && from.toLowerCase().includes(contact) ? "in" : contact ? "out" : "in";
    return {
      id: m.id,
      from,
      to: h("to"),
      subject: h("subject"),
      date: h("date"),
      html,
      text,
      direction,
      ts: Number(m.internalDate ?? 0),
    };
  }).sort((a, b) => a.ts - b.ts); // ordre chronologique (conversation)

  return jsonRes({ ok: true, messages });
});
