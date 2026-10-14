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
// Boîte de réception : { inbox: true, box?, folder?, q?, pageTokens? } → { ok, threads: [...],
// nextPageTokens?, partial?, failedBoxes? } : 30 conversations par boîte et par page, comme
// Gmail : folder "inbox" (défaut) = la boîte de réception (hors promotions / réseaux
// sociaux), "sent" = messages envoyés. Avec `q` (recherche Gmail, 200 car. max) : tout
// Gmail (`in:anywhere`, ou `in:sent`), sans exclusion. Chaque fil porte `to` (adresses
// To/Cc/Delivered-To, 20 max) et `archived` (aucun message dans INBOX). Un fil illisible
// après nouvelles tentatives est absent ET signalé (`partial: true`).
// Les mails de désinscription générés par Gmail sont ignorés.
//
// Coup d'œil : { peek: true, box? } → { ok, boxes: { partnerships?: { historyId, unread } … } }
// (profil Gmail + compteur de fils non lus du label INBOX, 2 appels légers par boîte).
// ============================================================================

import { getServiceClient, corsHeaders } from "../_shared/google.ts";
import { boxToken, boxError, talentAddress, type Box } from "../_shared/gmailBox.ts";
import { gfetch, gmailError, mapPool, GmailError, GfetchError } from "../_shared/gfetch.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX = 50; // historique : 50 derniers messages par boîte
const INBOX_MAX = 30;
const POOL = 8; // lectures Gmail en parallèle
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

/** Erreur → réponse lisible (Gmail, réseau, ou jeton de boîte). */
function failure(reason: unknown): { error: string; status: number } {
  if (reason instanceof GmailError) return { error: reason.code, status: reason.status };
  if (reason instanceof GfetchError) return { error: "lecture_echouee", status: 502 };
  return boxError(reason);
}

/** Jeton de page Gmail reçu du client (sinon ignoré). */
function pageToken(v: unknown): string {
  return typeof v === "string" && /^[A-Za-z0-9_\-.~]{1,256}$/.test(v) ? v : "";
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const jsonRes = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const sb = getServiceClient();
  if (!(await isAgency(req, sb))) return jsonRes({ error: "unauthorized" }, 401);

  let body: {
    contact?: string; box?: string; inbox?: boolean; folder?: string; q?: string; peek?: boolean;
    pageTokens?: Partial<Record<Box, string>>;
  } = {};
  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: "bad_request" }, 400);
  }
  const contact = String(body.contact ?? "").trim().toLowerCase();
  const boxes: Box[] = body.box === "all" ? (talentAddress() ? ["partnerships", "talent"] : ["partnerships"])
    : body.box === "talent" ? ["talent"] : ["partnerships"];
  const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

  // ── Coup d'œil : a-t-il bougé ? (historyId + non lus de la boîte de réception) ──
  if (body.peek) {
    const peekOf = async (box: Box) => {
      const token = await boxToken(sb, box, "read");
      const [pr, lr] = await Promise.all([
        gfetch(`${GMAIL}/profile`, auth(token), { timeoutMs: 8_000 }),
        gfetch(`${GMAIL}/labels/INBOX`, auth(token), { timeoutMs: 8_000 }),
      ]);
      const pd = await pr.json().catch(() => ({})) as { historyId?: string | number };
      const ld = await lr.json().catch(() => ({})) as { threadsUnread?: number };
      if (!pr.ok) throw gmailError(pr.status, pd, "lecture_echouee");
      if (!lr.ok) throw gmailError(lr.status, ld, "lecture_echouee");
      return { historyId: String(pd.historyId ?? ""), unread: Number(ld.threadsUnread ?? 0) };
    };
    const results = await Promise.allSettled(boxes.map(peekOf));
    const out: Partial<Record<Box, { historyId: string; unread: number }>> = {};
    const failedBoxes: Box[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") out[boxes[i]] = r.value;
      else failedBoxes.push(boxes[i]);
    });
    if (!Object.keys(out).length) {
      const f = failure((results[0] as PromiseRejectedResult).reason);
      return jsonRes({ error: f.error }, f.status);
    }
    return jsonRes({ ok: true, boxes: out, ...(failedBoxes.length ? { partial: true, failedBoxes } : {}) });
  }

  // ── Boîte de réception : dernières conversations de la (des) boîte(s) ──
  if (body.inbox) {
    type Thread = {
      threadId: string; subject: string; name: string; email: string; snippet: string;
      ts: number; count: number; direction: "in" | "out"; unread: boolean; box: Box;
      to: string[]; archived: boolean;
    };
    const addr = (v: string) => (v.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] ?? "").toLowerCase();
    const addrs = (v: string) => [...v.matchAll(/[^\s<>",;]+@[^\s<>",;]+/g)].map((m) => m[0].toLowerCase());
    const nameOf = (v: string) => v.replace(/<[^>]*>/g, "").replace(/"/g, "").trim() || addr(v);
    const fromAgency = (v: string) => addr(v).endsWith("@" + AGENCY_DOMAIN);
    const sent = body.folder === "sent";
    // Recherche : texte libre de l'utilisateur (une seule ligne, 200 caractères max).
    const q = String(body.q ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 200).trim();
    const query = q
      ? (sent ? `${q} in:sent` : `${q} in:anywhere`)
      : (sent ? "in:sent" : "in:inbox -category:promotions -category:social");
    const meta = ["From", "To", "Cc", "Delivered-To", "Subject"].map((h) => `metadataHeaders=${encodeURIComponent(h)}`).join("&");
    // Mails envoyés automatiquement par Gmail quand on clique « Se désabonner ».
    const isUnsubscribe = (subject: string, snippet: string) =>
      /^unsubscribe$/i.test(subject.trim()) && /automatically generated by Gmail/i.test(snippet);
    async function inboxOf(box: Box): Promise<{ threads: Thread[]; next: string; partial: boolean }> {
      const token = await boxToken(sb, box, "read");
      const params = new URLSearchParams({ q: query, maxResults: String(INBOX_MAX) });
      const pt = pageToken(body.pageTokens?.[box]);
      if (pt) params.set("pageToken", pt);
      const lr = await gfetch(`${GMAIL}/threads?${params}`, auth(token));
      const list = await lr.json().catch(() => ({})) as { threads?: { id: string; snippet?: string }[]; nextPageToken?: string };
      if (!lr.ok) throw gmailError(lr.status, list, "lecture_echouee");
      const one = async (t: { id: string; snippet?: string }): Promise<Thread | null | "fail"> => {
        let tr: Response;
        try {
          tr = await gfetch(`${GMAIL}/threads/${encodeURIComponent(t.id)}?format=metadata&${meta}`, auth(token));
        } catch {
          return "fail";
        }
        if (tr.status === 404) return null; // supprimé entre la liste et la lecture
        const d = await tr.json().catch(() => null) as { messages?: { labelIds?: string[]; internalDate?: string; payload?: { headers?: Header[] } }[] } | null;
        if (!tr.ok || !d) return "fail";
        const msgs = (d.messages ?? []).filter((m) => !(m.labelIds ?? []).includes("DRAFT"));
        if (!msgs.length) return null;
        const h = (m: typeof msgs[number], n: string) => (m.payload?.headers ?? []).find((x) => x.name.toLowerCase() === n)?.value ?? "";
        const last = msgs[msgs.length - 1];
        const from = h(last, "from");
        const out = fromAgency(from);
        if (isUnsubscribe(h(msgs[0], "subject"), String(t.snippet ?? ""))) return null;
        // Interlocuteur : envoyés = destinataire du dernier envoi ; sinon le dernier
        // expéditeur extérieur, à défaut le destinataire du dernier envoi.
        const lastOut = [...msgs].reverse().find((m) => fromAgency(h(m, "from")));
        const ext = [...msgs].reverse().map((m) => h(m, "from")).find((f) => !fromAgency(f));
        const other = sent && lastOut ? (h(lastOut, "to").split(",")[0] ?? "") : ext ?? (h(last, "to").split(",")[0] ?? "");
        // Destinataires de tout le fil (filtre « par créatrice » côté app).
        const to = new Set<string>();
        for (const m of msgs) for (const n of ["to", "cc", "delivered-to"]) for (const a of addrs(h(m, n))) if (to.size < 20) to.add(a);
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
          to: [...to],
          archived: !msgs.some((m) => (m.labelIds ?? []).includes("INBOX")),
        };
      };
      const res = await mapPool(list.threads ?? [], POOL, one);
      return {
        threads: res.filter((x): x is Thread => x !== null && x !== "fail"),
        next: list.nextPageToken ?? "",
        partial: res.includes("fail"),
      };
    }
    const results = await Promise.allSettled(boxes.map(inboxOf));
    const okBoxes = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof inboxOf>>> => r.status === "fulfilled");
    if (!okBoxes.length) {
      const f = failure((results[0] as PromiseRejectedResult).reason);
      return jsonRes({ error: f.error }, f.status);
    }
    const failedBoxes = boxes.filter((_, i) => results[i].status === "rejected");
    const nextPageTokens: Partial<Record<Box, string>> = {};
    results.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value.next) nextPageTokens[boxes[i]] = r.value.next;
    });
    const threads = okBoxes.flatMap((r) => r.value.threads).sort((a, b) => b.ts - a.ts);
    const partial = failedBoxes.length > 0 || okBoxes.some((r) => r.value.partial);
    return jsonRes({
      ok: true, threads,
      ...(Object.keys(nextPageTokens).length ? { nextPageTokens } : {}),
      ...(partial ? { partial: true } : {}),
      ...(failedBoxes.length ? { failedBoxes } : {}),
    });
  }

  if (!EMAIL_RE.test(contact)) return jsonRes({ error: "contact_invalide" }, 400);

  type Msg = { id: string; threadId: string; from: string; to: string; subject: string; date: string; snippet: string; direction: "in" | "out"; ts: number; box: Box };

  /** Messages échangés avec le contact dans UNE boîte. */
  async function fromBox(box: Box): Promise<Msg[]> {
    const token = await boxToken(sb, box, "read");
    const q = encodeURIComponent(`from:${contact} OR to:${contact} OR cc:${contact}`);
    const listRes = await gfetch(`${GMAIL}/messages?q=${q}&maxResults=${MAX}`, auth(token));
    const list = await listRes.json().catch(() => ({}));
    if (!listRes.ok) throw gmailError(listRes.status, list, "lecture_echouee");
    const ids: string[] = ((list as { messages?: { id: string }[] }).messages ?? []).map((m) => m.id);
    // 8 lectures à la fois (évite le N+1 séquentiel sans dépasser les limites de Gmail).
    const one = async (id: string): Promise<Msg | null> => {
      try {
        const mr = await gfetch(
          `${GMAIL}/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
          auth(token),
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
      } catch {
        return null;
      }
    };
    const fetched = await mapPool(ids, POOL, one);
    return fetched.filter((m): m is Msg => m !== null);
  }

  const results = await Promise.allSettled(boxes.map(fromBox));
  const ok = results.filter((r): r is PromiseFulfilledResult<Msg[]> => r.status === "fulfilled");
  if (!ok.length) {
    // Toutes les boîtes ont échoué : on renvoie la cause de la première.
    const f = failure((results[0] as PromiseRejectedResult).reason);
    return jsonRes({ error: f.error }, f.status);
  }
  const messages = ok.flatMap((r) => r.value).sort((a, b) => b.ts - a.ts);
  const failed = results.length - ok.length;
  return jsonRes({ ok: true, messages, ...(failed ? { partial: true } : {}) });
});
