// ============================================================================
// gmail-thread/index.ts
// ----------------------------------------------------------------------------
// Fil complet d'un échange Gmail : tous les messages + leur corps (texte/HTML).
// Réservé à l'AGENCE (verify_jwt=true + rôle agence). Scope gmail.readonly.
//
// Entrée : { threadId, contact?, box? } (box = "partnerships" défaut | "talent").  Sortie : { ok, messages:[{from,to,cc,subject,
//           date,html,text,direction,ts,attachments,messageIdHeader,inReplyTo,references,replyTo}] }.
//   • direction : "out" si l'expéditeur est @<domaine agence>, sinon "in".
//   • corps décodés selon le charset de chaque partie (windows-1252, iso-8859-1…).
//   • pièces : `cid` si la partie a un Content-ID ; `inline: true` pour les images
//     intégrées au HTML (leurs « cid: » sont remplacés par des data: ; ≤ 200 Ko,
//     5 par message) : l'app ne les liste pas comme pièces jointes.
// Pièce jointe : { action: "attachment", messageId, attachmentId, box? } → { ok, data (base64) }.
// Lu / non lu / archiver (jeton « modify ») : { threadId, box?, action: "read"|"unread"|"archive"|"unarchive" }
//   → { ok: true, action } (l'écho prouve que la version déployée sait le faire).
//   Erreurs : gmail_scope_manquant 403, limite_gmail 429, google_non_connecte 401, action_echouee 502.
// Supprimer un brouillon Gmail (jeton « modify ») : { action: "draft-delete", draftId, box? }
//   → { ok: true, action } (déjà supprimé ou envoyé : ok aussi, avec `gone: true`).
//   draftId invalide → 400 draft_requis. Jamais d'envoi ici : l'envoi passe par gmail-send.
// Chaque message porte `draft: true` s'il est un brouillon (libellé DRAFT) : l'app ne
// l'affiche pas comme un message du fil et le propose dans sa zone de réponse.
// Réactions emoji (2026-10-23) : un message qui contient une partie de réaction Gmail valide
// porte `reaction: "❤️"` (l'app l'affiche en pastille sous le message `inReplyTo`) ; `list: true`
// si le message vient d'une liste de diffusion (en-tête List-Id : pas de réaction proposée).
// ============================================================================

import { getServiceClient, corsHeaders } from "../_shared/google.ts";
import { boxToken, boxError, parseBox } from "../_shared/gmailBox.ts";
import { gfetch, classifyGmail, gmailMessage, charsetOf, decodeGmailBody, GfetchError } from "../_shared/gfetch.ts";
import { isDraftId } from "../_shared/gmailDrafts.ts";
import { parseReactionJson, REACTION_MIME } from "../_shared/emailReaction.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const AGENCY_DOMAIN = (Deno.env.get("AGENCY_MAIL_DOMAIN") ?? "ttpcreators.pro").toLowerCase();

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

type Header = { name: string; value: string };
type Part = {
  mimeType?: string; filename?: string; headers?: Header[];
  body?: { data?: string; attachmentId?: string; size?: number }; parts?: Part[];
};
type Attachment = {
  messageId: string; attachmentId: string; filename: string; mimeType: string; size: number;
  cid?: string; inline?: boolean;
};
type InlineImg = { cid: string; mimeType: string; size: number; attachmentId?: string; data?: string };
const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const INLINE_MAX_BYTES = 200 * 1024; // par image intégrée
const INLINE_PER_MESSAGE = 5;
const INLINE_THREAD_BUDGET = 2 * 1024 * 1024; // borne la taille de la réponse

/** Actions lu / non lu / archiver → libellés Gmail ajoutés / retirés au fil. */
const MODIFY: Record<string, { addLabelIds?: string[]; removeLabelIds?: string[] }> = {
  read: { removeLabelIds: ["UNREAD"] },
  unread: { addLabelIds: ["UNREAD"] },
  archive: { removeLabelIds: ["INBOX"] },
  unarchive: { addLabelIds: ["INBOX"] },
};

const hv = (headers: Header[] | undefined, name: string) =>
  (headers ?? []).find((x) => x.name.toLowerCase() === name)?.value ?? "";

/** Extrait le corps HTML et/ou texte d'un message + ses pièces jointes (parcours récursif des parts). */
function extractBody(payload: Part | undefined, messageId: string): { html: string; text: string; attachments: Attachment[]; inline: InlineImg[]; reaction: string | null } {
  let html = "";
  let text = "";
  let reaction: string | null = null;
  const attachments: Attachment[] = [];
  const inline: InlineImg[] = [];
  const walk = (p?: Part) => {
    if (!p) return;
    const mime = (p.mimeType ?? "").toLowerCase();
    const cid = hv(p.headers, "content-id").trim().replace(/^<|>$/g, "").trim();
    const disposition = hv(p.headers, "content-disposition").trim().toLowerCase();
    const isImage = mime.startsWith("image/");
    // Image intégrée possible : Content-ID, ou Content-Disposition inline.
    const inlineCandidate = isImage && (!!cid || disposition.startsWith("inline"));
    if (isImage && cid && (p.body?.attachmentId || p.body?.data)) {
      inline.push({ cid, mimeType: mime, size: p.body?.size ?? 0, attachmentId: p.body?.attachmentId, data: p.body?.data });
    }
    if (p.body?.attachmentId && (p.filename || inlineCandidate)) {
      attachments.push({
        messageId, attachmentId: p.body.attachmentId,
        filename: p.filename || (cid ? cid.split("@")[0] : "") || "image",
        mimeType: p.mimeType ?? "application/octet-stream", size: p.body.size ?? 0,
        ...(cid ? { cid } : {}),
      });
    } else if (mime === REACTION_MIME && p.body?.data && !reaction && !disposition.startsWith("attachment")) {
      reaction = parseReactionJson(decodeGmailBody(p.body.data, charsetOf(p.headers)));
    } else if (mime === "text/html" && p.body?.data && !html && !p.filename) html = decodeGmailBody(p.body.data, charsetOf(p.headers));
    else if (mime === "text/plain" && p.body?.data && !text && !p.filename) text = decodeGmailBody(p.body.data, charsetOf(p.headers));
    if (p.parts) for (const c of p.parts) walk(c);
  };
  walk(payload);
  return { html, text, attachments, inline, reaction };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Remplace dans le HTML les « cid: » des images intégrées par des data: (≤ 200 Ko,
 * 5 max par message, budget global par fil). Renvoie le HTML et les cid intégrés.
 */
async function embedInline(
  token: string, messageId: string, html: string, inline: InlineImg[], budget: { left: number },
): Promise<{ html: string; embedded: Set<string> }> {
  const embedded = new Set<string>();
  const todo = inline
    .filter((im) => new RegExp(`cid:${escapeRe(im.cid)}(?![\\w.@-])`, "i").test(html))
    .filter((im) => im.size <= INLINE_MAX_BYTES)
    .slice(0, INLINE_PER_MESSAGE);
  const loaded = await Promise.all(todo.map(async (im) => {
    if (im.size > budget.left) return null;
    budget.left -= im.size;
    if (im.data) return { im, data: im.data };
    if (!im.attachmentId) return null;
    try {
      const r = await gfetch(`${GMAIL}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(im.attachmentId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json().catch(() => ({})) as { data?: string };
      return r.ok && d.data ? { im, data: d.data } : null;
    } catch {
      return null;
    }
  }));
  let out = html;
  for (const x of loaded) {
    if (!x) continue;
    const mime = x.im.mimeType.replace(/[^\w/+.-]/g, "") || "image/png";
    const b64 = x.data.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
    out = out.replace(new RegExp(`cid:${escapeRe(x.im.cid)}(?![\\w.@-])`, "gi"), `data:${mime};base64,${b64}`);
    embedded.add(x.im.cid);
  }
  return { html: out, embedded };
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const jsonRes = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const sb = getServiceClient();
  if (!(await isAgency(req, sb))) return jsonRes({ error: "unauthorized" }, 401);

  let body: { threadId?: string; contact?: string; box?: string; action?: string; messageId?: string; attachmentId?: string; draftId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: "bad_request" }, 400);
  }
  const threadId = String(body.threadId ?? "").trim();
  const action = String(body.action ?? "");
  const isAttachment = action === "attachment";

  // ── Lu / non lu / archiver / désarchiver (droit « modify » de la boîte) ──
  if (action && Object.hasOwn(MODIFY, action)) {
    // Identifiant Gmail = hexadécimal : rien d'autre ne part dans l'URL.
    if (!/^[0-9a-f]{6,32}$/i.test(threadId)) return jsonRes({ error: "thread_requis" }, 400);
    let mtoken: string;
    try {
      mtoken = await boxToken(sb, parseBox(body.box), "modify");
    } catch (e) {
      const be = boxError(e);
      return jsonRes({ error: be.error }, be.status);
    }
    let r: Response;
    try {
      // Ajout / retrait de libellé : idempotent, nouvelles tentatives sans risque.
      r = await gfetch(`${GMAIL}/threads/${threadId}/modify`, {
        method: "POST",
        headers: { Authorization: `Bearer ${mtoken}`, "Content-Type": "application/json" },
        body: JSON.stringify(MODIFY[action]),
      });
    } catch (e) {
      return jsonRes({ error: "action_echouee", detail: e instanceof GfetchError ? e.kind : "reseau" }, 502);
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 404) return jsonRes({ error: "introuvable" }, 404);
      const c = classifyGmail(r.status, data, "action_echouee");
      return jsonRes({ error: c.error, detail: gmailMessage(r.status, data) }, c.status);
    }
    return jsonRes({ ok: true, action });
  }
  // ── Supprimer un brouillon Gmail (après envoi depuis l'app, ou à la demande) ──
  if (action === "draft-delete") {
    const draftId = String(body.draftId ?? "").trim();
    if (!isDraftId(draftId)) return jsonRes({ error: "draft_requis" }, 400);
    let dtoken: string;
    try {
      dtoken = await boxToken(sb, parseBox(body.box), "modify");
    } catch (e) {
      const be = boxError(e);
      return jsonRes({ error: be.error }, be.status);
    }
    let r: Response;
    try {
      r = await gfetch(`${GMAIL}/drafts/${encodeURIComponent(draftId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${dtoken}` },
      });
    } catch (e) {
      return jsonRes({ error: "action_echouee", detail: e instanceof GfetchError ? e.kind : "reseau" }, 502);
    }
    if (r.status === 404) return jsonRes({ ok: true, action, gone: true }); // déjà supprimé ou envoyé
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      const c = classifyGmail(r.status, data, "action_echouee");
      return jsonRes({ error: c.error, detail: gmailMessage(r.status, data) }, c.status);
    }
    return jsonRes({ ok: true, action });
  }
  if (action && !isAttachment) return jsonRes({ error: "action_inconnue" }, 400);
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
    let a: Response;
    try {
      a = await gfetch(`${GMAIL}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      }, { timeoutMs: 30_000 });
    } catch (e) {
      return jsonRes({ error: "lecture_echouee", detail: e instanceof GfetchError ? e.kind : "reseau" }, 502);
    }
    const ad = await a.json().catch(() => ({})) as { data?: string; size?: number };
    if (!a.ok && a.status !== 404) {
      const c = classifyGmail(a.status, ad, "introuvable", 404);
      return jsonRes({ error: c.error }, c.status);
    }
    if (!a.ok || !ad.data) return jsonRes({ error: "introuvable" }, 404);
    if ((ad.size ?? 0) > ATTACHMENT_MAX_BYTES) return jsonRes({ error: "piece_trop_lourde" }, 413);
    return jsonRes({ ok: true, data: ad.data.replace(/-/g, "+").replace(/_/g, "/") });
  }

  let r: Response;
  try {
    r = await gfetch(`${GMAIL}/threads/${encodeURIComponent(threadId)}?format=full`, {
      headers: { Authorization: `Bearer ${token}` },
    }, { timeoutMs: 20_000 });
  } catch (e) {
    return jsonRes({ error: "lecture_echouee", detail: e instanceof GfetchError ? e.kind : "reseau" }, 502);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const c = classifyGmail(r.status, data, "lecture_echouee");
    return jsonRes({ error: c.error, detail: gmailMessage(r.status, data) }, c.status);
  }

  type RawMsg = { id: string; internalDate?: string; labelIds?: string[]; payload?: Part & { headers?: Header[] } };
  const raw = ((data as { messages?: RawMsg[] }).messages ?? []);
  const fromAgency = (from: string) => (from.match(/[^\s<>"]+@[^\s<>"]+/)?.[0] ?? "").toLowerCase().endsWith("@" + AGENCY_DOMAIN);
  // Images intégrées : les messages les plus récents d'abord (budget du fil).
  const budget = { left: INLINE_THREAD_BUDGET };
  const order = raw.map((m, i) => ({ i, ts: Number(m.internalDate ?? 0) })).sort((a, b) => b.ts - a.ts);
  const built = new Array<Record<string, unknown> & { ts: number }>(raw.length);
  for (const { i } of order) {
    const m = raw[i];
    const headers: Header[] = m.payload?.headers ?? [];
    const h = (name: string) => hv(headers, name);
    const from = h("from");
    const ex = extractBody(m.payload, m.id);
    const { html, embedded } = ex.html && ex.inline.length
      ? await embedInline(token, m.id, ex.html, ex.inline, budget)
      : { html: ex.html, embedded: new Set<string>() };
    // Une image affichée dans le corps n'est pas une pièce jointe ; une image trop lourde
    // pour être intégrée reste listée (sinon elle serait introuvable).
    const attachments = ex.attachments.map((a) => (a.cid && embedded.has(a.cid) ? { ...a, inline: true } : a));
    built[i] = {
      id: m.id,
      from,
      to: h("to"),
      cc: h("cc"),
      subject: h("subject"),
      date: h("date"),
      html,
      text: ex.text,
      direction: fromAgency(from) ? "out" : "in",
      ts: Number(m.internalDate ?? 0),
      attachments,
      messageIdHeader: h("message-id"),
      inReplyTo: h("in-reply-to"),
      references: h("references"),
      replyTo: h("reply-to"),
      ...((m.labelIds ?? []).includes("DRAFT") ? { draft: true } : {}),
      ...(ex.reaction ? { reaction: ex.reaction } : {}),
      ...(h("list-id") ? { list: true } : {}),
    };
  }
  const messages = built.sort((a, b) => a.ts - b.ts); // ordre chronologique (conversation)

  return jsonRes({ ok: true, messages });
});
