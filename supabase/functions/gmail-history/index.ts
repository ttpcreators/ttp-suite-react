// ============================================================================
// gmail-history/index.ts
// ----------------------------------------------------------------------------
// Historique des emails échangés avec un contact (scope gmail.readonly).
// Cherche les messages from:/to: le contact, renvoie entêtes + snippet + sens.
// Réservé à l'AGENCE (verify_jwt=true + rôle agence).
//
// Entrée : { contact, box? }  box = "partnerships" (défaut) | "talent" | "all".
// Sortie : { ok, messages: [...] } — chaque message porte sa boîte (`box`).
//
// Boîte de réception : { inbox: true, box? } → { ok, threads: [...] } : les 30
// dernières conversations de la boîte (reçues + envoyées, hors brouillons /
// promotions / réseaux sociaux), avec l'interlocuteur et le sens du dernier message.
// ============================================================================

import { getServiceClient, corsHeaders } from "../_shared/google.ts";
import { boxToken, boxError, talentAddress, type Box } from "../_shared/gmailBox.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX = 50; // historique : 50 derniers messages par boîte
const INBOX_MAX = 30;
const AGENCY_DOMAIN = (Deno.env.get("AGENCY_MAIL_DOMAIN") ?? "ttpcreators.pro").toLowerCase();

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

  let body: { contact?: string; box?: string; inbox?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: "bad_request" }, 400);
  }
  const contact = String(body.contact ?? "").trim().toLowerCase();
  const boxes: Box[] = body.box === "all" ? (talentAddress() ? ["partnerships", "talent"] : ["partnerships"])
    : body.box === "talent" ? ["talent"] : ["partnerships"];

  // ── Boîte de réception : dernières conversations de la (des) boîte(s) ──
  if (body.inbox) {
    type Thread = {
      threadId: string; subject: string; name: string; email: string; snippet: string;
      ts: number; count: number; direction: "in" | "out"; unread: boolean; box: Box;
    };
    const addr = (v: string) => (v.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] ?? "").toLowerCase();
    const nameOf = (v: string) => v.replace(/<[^>]*>/g, "").replace(/"/g, "").trim() || addr(v);
    const fromAgency = (v: string) => addr(v).endsWith("@" + AGENCY_DOMAIN);
    async function inboxOf(box: Box): Promise<Thread[]> {
      const token = await boxToken(sb, box, "read");
      const q = encodeURIComponent("-in:draft -in:chats -category:promotions -category:social");
      const lr = await fetch(`${GMAIL}/threads?q=${q}&maxResults=${INBOX_MAX}`, { headers: { Authorization: `Bearer ${token}` } });
      const list = await lr.json().catch(() => ({})) as { threads?: { id: string; snippet?: string }[] };
      if (!lr.ok) throw new Error(lr.status === 403 ? "gmail_scope_manquant" : "lecture_echouee");
      const one = async (t: { id: string; snippet?: string }): Promise<Thread | null> => {
        const tr = await fetch(
          `${GMAIL}/threads/${t.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!tr.ok) return null;
        const d = await tr.json().catch(() => null) as { messages?: { labelIds?: string[]; internalDate?: string; payload?: { headers?: Header[] } }[] } | null;
        const msgs = (d?.messages ?? []).filter((m) => !(m.labelIds ?? []).includes("DRAFT"));
        if (!msgs.length) return null;
        const h = (m: typeof msgs[number], n: string) => (m.payload?.headers ?? []).find((x) => x.name.toLowerCase() === n)?.value ?? "";
        const last = msgs[msgs.length - 1];
        const from = h(last, "from");
        const out = fromAgency(from);
        // Interlocuteur : le dernier expéditeur extérieur, sinon le destinataire du dernier envoi.
        const ext = [...msgs].reverse().map((m) => h(m, "from")).find((f) => !fromAgency(f));
        const other = ext ?? (h(last, "to").split(",")[0] ?? "");
        return {
          threadId: t.id,
          subject: h(msgs[0], "subject"),
          name: nameOf(other),
          email: addr(other),
          snippet: String(t.snippet ?? "").slice(0, 200),
          ts: Number(last.internalDate ?? 0),
          count: msgs.length,
          direction: out ? "out" : "in",
          unread: msgs.some((m) => (m.labelIds ?? []).includes("UNREAD")),
          box,
        };
      };
      const ids = list.threads ?? [];
      const res: (Thread | null)[] = [];
      for (let i = 0; i < ids.length; i += 10) res.push(...await Promise.all(ids.slice(i, i + 10).map(one)));
      return res.filter((x): x is Thread => x !== null);
    }
    const results = await Promise.allSettled(boxes.map(inboxOf));
    const ok = results.filter((r): r is PromiseFulfilledResult<Thread[]> => r.status === "fulfilled");
    if (!ok.length) {
      const reason = (results[0] as PromiseRejectedResult).reason as Error;
      if (reason?.message === "gmail_scope_manquant") return jsonRes({ error: "gmail_scope_manquant" }, 403);
      if (reason?.message === "lecture_echouee") return jsonRes({ error: "lecture_echouee" }, 502);
      const be = boxError(reason);
      return jsonRes({ error: be.error }, be.status);
    }
    const threads = ok.flatMap((r) => r.value).sort((a, b) => b.ts - a.ts);
    return jsonRes({ ok: true, threads, ...(results.length > ok.length ? { partial: true } : {}) });
  }

  if (!EMAIL_RE.test(contact)) return jsonRes({ error: "contact_invalide" }, 400);

  type Msg = { id: string; threadId: string; from: string; to: string; subject: string; date: string; snippet: string; direction: "in" | "out"; ts: number; box: Box };

  /** Messages échangés avec le contact dans UNE boîte. */
  async function fromBox(box: Box): Promise<Msg[]> {
    const token = await boxToken(sb, box, "read");
    const q = encodeURIComponent(`from:${contact} OR to:${contact} OR cc:${contact}`);
    const listRes = await fetch(`${GMAIL}/messages?q=${q}&maxResults=${MAX}`, { headers: { Authorization: `Bearer ${token}` } });
    const list = await listRes.json().catch(() => ({}));
    if (!listRes.ok) throw new Error(listRes.status === 403 ? "gmail_scope_manquant" : "lecture_echouee");
    const ids: string[] = ((list as { messages?: { id: string }[] }).messages ?? []).map((m) => m.id);
    // Par salves de 10 (évite le N+1 séquentiel sans dépasser les limites de Gmail).
    const one = async (id: string): Promise<Msg | null> => {
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
    };
    const fetched: (Msg | null)[] = [];
    for (let i = 0; i < ids.length; i += 10) fetched.push(...await Promise.all(ids.slice(i, i + 10).map(one)));
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
