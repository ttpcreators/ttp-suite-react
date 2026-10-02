// ============================================================================
// gmail-history/index.ts
// ----------------------------------------------------------------------------
// Historique des emails échangés avec un contact (scope gmail.readonly).
// Cherche les messages from:/to: le contact, renvoie entêtes + snippet + sens.
// Réservé à l'AGENCE (verify_jwt=true + rôle agence).
//
// Entrée : { contact, box? }  box = "partnerships" (défaut) | "talent" | "all".
// Sortie : { ok, messages: [...] } — chaque message porte sa boîte (`box`).
// ============================================================================

import { getServiceClient, corsHeaders } from "../_shared/google.ts";
import { boxToken, boxError, talentAddress, type Box } from "../_shared/gmailBox.ts";

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

  let body: { contact?: string; box?: string } = {};
  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: "bad_request" }, 400);
  }
  const contact = String(body.contact ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(contact)) return jsonRes({ error: "contact_invalide" }, 400);
  const boxes: Box[] = body.box === "all" ? (talentAddress() ? ["partnerships", "talent"] : ["partnerships"])
    : body.box === "talent" ? ["talent"] : ["partnerships"];

  type Msg = { id: string; threadId: string; from: string; to: string; subject: string; date: string; snippet: string; direction: "in" | "out"; ts: number; box: Box };

  /** Messages échangés avec le contact dans UNE boîte. */
  async function fromBox(box: Box): Promise<Msg[]> {
    const token = await boxToken(sb, box, "read");
    const q = encodeURIComponent(`from:${contact} OR to:${contact} OR cc:${contact}`);
    const listRes = await fetch(`${GMAIL}/messages?q=${q}&maxResults=${MAX}`, { headers: { Authorization: `Bearer ${token}` } });
    const list = await listRes.json().catch(() => ({}));
    if (!listRes.ok) throw new Error(listRes.status === 403 ? "gmail_scope_manquant" : "lecture_echouee");
    const ids: string[] = ((list as { messages?: { id: string }[] }).messages ?? []).map((m) => m.id);
    // Parallèle (évite le N+1 séquentiel : ~15 messages en une salve au lieu d'un par un).
    const fetched = await Promise.all(
      ids.map(async (id): Promise<Msg | null> => {
        const mr = await fetch(
          `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!mr.ok) return null;
        const m = await mr.json().catch(() => null);
        if (!m) return null;
        const headers: Header[] = m.payload?.headers ?? [];
        const h = (name: string) => headers.find((x) => x.name.toLowerCase() === name)?.value ?? "";
        const from = h("from");
        return {
          id: m.id, threadId: m.threadId, from, to: h("to"), subject: h("subject"), date: h("date"),
          snippet: String(m.snippet ?? "").slice(0, 200),
          direction: from.toLowerCase().includes(contact) ? "in" : "out",
          ts: Number(m.internalDate ?? 0),
          box,
        };
      }),
    );
    return fetched.filter((m): m is Msg => m !== null);
  }

  const results = await Promise.allSettled(boxes.map(fromBox));
  const ok = results.filter((r): r is PromiseFulfilledResult<Msg[]> => r.status === "fulfilled");
  if (!ok.length) {
    // Toutes les boîtes ont échoué : on renvoie la cause de la première.
    const reason = (results[0] as PromiseRejectedResult).reason as Error;
    if (reason?.message === "gmail_scope_manquant") return jsonRes({ error: "gmail_scope_manquant" }, 403);
    if (reason?.message === "lecture_echouee") return jsonRes({ error: "lecture_echouee" }, 502);
    const be = boxError(reason);
    return jsonRes({ error: be.error }, be.status);
  }
  const messages = ok.flatMap((r) => r.value).sort((a, b) => b.ts - a.ts);
  const failed = results.length - ok.length;
  return jsonRes({ ok: true, messages, ...(failed ? { partial: true } : {}) });
});
