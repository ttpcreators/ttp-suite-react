// ============================================================================
// gmail-history/index.ts
// ----------------------------------------------------------------------------
// Historique des emails échangés avec un contact (scope gmail.readonly).
// Cherche les messages from:/to: le contact, renvoie entêtes + snippet + sens.
// Réservé à l'AGENCE (verify_jwt=true + rôle agence).
//
// Entrée : { contact }  (email). Sortie : { ok, messages: [...] }.
// ============================================================================

import { getServiceClient, getAccessToken, corsHeaders } from "../_shared/google.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX = 15;

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

type Header = { name: string; value: string };

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const jsonRes = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const sb = getServiceClient();
  if (!(await isAgency(req, sb))) return jsonRes({ error: "unauthorized" }, 401);

  let body: { contact?: string } = {};
  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: "bad_request" }, 400);
  }
  const contact = String(body.contact ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(contact)) return jsonRes({ error: "contact_invalide" }, 400);

  let token: string;
  try {
    token = await getAccessToken(sb);
  } catch (e) {
    const msg = (e as Error)?.message ?? "";
    if (msg === "not_connected" || msg === "invalid_grant")
      return jsonRes({ error: "google_non_connecte", detail: "Reconnecte Google (droits Gmail)." }, 409);
    return jsonRes({ error: "token_indisponible", detail: msg.slice(0, 160) }, 502);
  }

  // Liste des messages avec ce contact (envoyés OU reçus).
  const q = encodeURIComponent(`from:${contact} OR to:${contact}`);
  const listRes = await fetch(`${GMAIL}/messages?q=${q}&maxResults=${MAX}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const list = await listRes.json().catch(() => ({}));
  if (!listRes.ok) {
    const detail = String((list as { error?: { message?: string } })?.error?.message ?? listRes.status).slice(0, 200);
    if (listRes.status === 403) return jsonRes({ error: "gmail_scope_manquant", detail }, 403);
    return jsonRes({ error: "lecture_echouee", detail }, 502);
  }
  const ids: string[] = ((list as { messages?: { id: string }[] }).messages ?? []).map((m) => m.id);

  const messages: {
    id: string; threadId: string; from: string; to: string; subject: string;
    date: string; snippet: string; direction: "in" | "out"; ts: number;
  }[] = [];
  for (const id of ids) {
    const mr = await fetch(
      `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!mr.ok) continue;
    const m = await mr.json().catch(() => null);
    if (!m) continue;
    const headers: Header[] = m.payload?.headers ?? [];
    const h = (name: string) => headers.find((x) => x.name.toLowerCase() === name)?.value ?? "";
    const from = h("from");
    const direction: "in" | "out" = from.toLowerCase().includes(contact) ? "in" : "out";
    messages.push({
      id: m.id,
      threadId: m.threadId,
      from,
      to: h("to"),
      subject: h("subject"),
      date: h("date"),
      snippet: String(m.snippet ?? "").slice(0, 200),
      direction,
      ts: Number(m.internalDate ?? 0),
    });
  }
  messages.sort((a, b) => b.ts - a.ts);

  return jsonRes({ ok: true, messages });
});
