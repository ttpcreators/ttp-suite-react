// ============================================================================
// gmail-send/index.ts
// ----------------------------------------------------------------------------
// Envoie un email depuis la VRAIE boîte Gmail de l'agence (OAuth), via l'API
// Gmail (scope gmail.send). Réservé à l'AGENCE (verify_jwt=true + rôle agence).
// Réutilise getAccessToken() (refresh auto du token, comme la sync Agenda).
//
// Entrée : { to, cc?, bcc?, subject, html, threadId?, inReplyTo?, source?, contactName?, box?,
//           attachments?, forward? }.
//  - cc / bcc = adresses en copie / copie cachée (10 max chacune).
//  - attachments = fichiers joints [{ filename, mimeType, contentBase64 }].
//  - forward = { box, messageId } : joint les pièces jointes d'origine de ce
//    message (lues côté serveur dans sa boîte, jamais renvoyées au navigateur).
//  - Taille totale des pièces jointes : 20 Mo max.
//  - box = "partnerships" (défaut, connexion de l'app) | "talent" (compte de service).
//  - threadId + inReplyTo : pour threader une relance dans le même fil (et
//    permettre la détection de réponse).
// Sortie : { ok, id, threadId }.
// Journalise dans email_activity (best-effort).
// ============================================================================

import { getServiceClient, corsHeaders } from "../_shared/google.ts";
import { boxToken, boxError, parseBox } from "../_shared/gmailBox.ts";

const GMAIL_SEND = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const GMAIL_UPLOAD = "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const ATTACH_TOTAL_MAX = 20 * 1024 * 1024;
const EMAIL_RE = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/;

type Att = { filename?: string; mimeType?: string; contentBase64?: string };
type Part = { mimeType?: string; filename?: string; body?: { attachmentId?: string; size?: number }; parts?: Part[] };

/** Liste d'adresses (tableau ou « a, b ») normalisée ; null si une adresse est invalide. */
function addrList(v: unknown): string[] | null {
  const list = (Array.isArray(v) ? v : String(v ?? "").split(/[,;\s]+/)).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  return list.every((x) => EMAIL_RE.test(x)) ? [...new Set(list)] : null;
}

/** Pièces jointes d'un message existant, lues dans sa boîte (transfert). */
async function originalAttachments(token: string, messageId: string): Promise<Att[]> {
  const r = await fetch(`${GMAIL}/messages/${encodeURIComponent(messageId)}?format=full`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error("original_introuvable");
  const msg = await r.json() as { payload?: Part };
  const found: { filename: string; mimeType: string; attachmentId: string; size: number }[] = [];
  const walk = (p?: Part) => {
    if (!p) return;
    if (p.filename && p.body?.attachmentId) {
      found.push({ filename: p.filename, mimeType: p.mimeType ?? "application/octet-stream", attachmentId: p.body.attachmentId, size: p.body.size ?? 0 });
    }
    for (const c of p.parts ?? []) walk(c);
  };
  walk(msg.payload);
  if (found.reduce((n, a) => n + a.size, 0) > ATTACH_TOTAL_MAX) throw new Error("pieces_trop_lourdes");
  const out: Att[] = [];
  for (const a of found) {
    const ar = await fetch(`${GMAIL}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(a.attachmentId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await ar.json().catch(() => ({})) as { data?: string };
    if (!ar.ok || !d.data) throw new Error("original_introuvable");
    out.push({ filename: a.filename, mimeType: a.mimeType, contentBase64: d.data.replace(/-/g, "+").replace(/_/g, "/") });
  }
  return out;
}

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
    to?: string; cc?: string[] | string; bcc?: string[] | string; subject?: string; html?: string;
    threadId?: string; inReplyTo?: string; source?: string; contactName?: string; box?: string;
    attachments?: Att[]; forward?: { box?: string; messageId?: string };
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
  // Copie / copie cachée : adresses validées une par une (jamais de CR/LF ni de séparateur injecté).
  const ccList = addrList(body.cc);
  const bccList = addrList(body.bcc);
  if (!ccList || !bccList) return jsonRes({ error: "copie_invalide" }, 400);
  if (ccList.length > 10 || bccList.length > 10) return jsonRes({ error: "copie_trop_longue" }, 400);
  if (!subject) return jsonRes({ error: "objet_requis" }, 400);
  if (!html.trim()) return jsonRes({ error: "contenu_requis" }, 400);

  // Jeton de la boîte d'envoi : connexion de l'app (partnerships@) ou compte de service (talent@).
  const box = parseBox(body.box);
  let token: string;
  try {
    token = await boxToken(sb, box, "send");
  } catch (e) {
    const be = boxError(e);
    const detail = be.error === "google_non_connecte" ? "Reconnecte Google (avec les droits Gmail) dans l'app."
      : be.error === "talent_droit_manquant" ? "Autorise l'envoi (gmail.send) pour le compte de service dans admin.google.com." : undefined;
    return jsonRes({ error: be.error, detail }, be.status);
  }

  // Pièces jointes : fichiers envoyés par l'app + celles du message transféré.
  const attachments = (Array.isArray(body.attachments) ? body.attachments : []).filter((a) => a?.contentBase64);
  if (body.forward?.messageId) {
    try {
      const fwdToken = await boxToken(sb, parseBox(body.forward.box), "read");
      attachments.push(...await originalAttachments(fwdToken, String(body.forward.messageId)));
    } catch (e) {
      const msg = (e as Error)?.message ?? "";
      if (msg === "pieces_trop_lourdes") return jsonRes({ error: "pieces_trop_lourdes" }, 413);
      if (msg === "original_introuvable") return jsonRes({ error: "original_introuvable" }, 404);
      const be = boxError(e);
      return jsonRes({ error: be.error }, be.status);
    }
  }
  // Taille réelle ≈ 3/4 de la longueur base64.
  const attBytes = attachments.reduce((n, a) => n + Math.floor(String(a.contentBase64 ?? "").length * 0.75), 0);
  if (attBytes > ATTACH_TOTAL_MAX) return jsonRes({ error: "pieces_trop_lourdes" }, 413);

  // Construit le message MIME. Entêtes de base + threading éventuel.
  const base = [`To: ${to}`, `Subject: ${encSubject(subject)}`, "MIME-Version: 1.0"];
  if (ccList.length) base.push(`Cc: ${ccList.join(", ")}`);
  // Gmail retire l'entête Bcc du message livré : les destinataires ne la voient pas.
  if (bccList.length) base.push(`Bcc: ${bccList.join(", ")}`);
  if (body.inReplyTo) {
    // Anti-injection d'entêtes MIME : jamais de CR/LF dans une valeur d'entête.
    const irt = String(body.inReplyTo).replace(/[\r\n]/g, "").slice(0, 400);
    base.push(`In-Reply-To: ${irt}`);
    base.push(`References: ${irt}`);
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
      const clean = String(a.filename ?? "piece-jointe").replace(/["\r\n\\]/g, "") || "piece-jointe";
      // Nom avec accents → encodé (RFC 2047), sinon tel quel.
      const fn = /^[\x20-\x7e]*$/.test(clean) ? clean : encSubject(clean);
      const ct = String(a.mimeType || "application/octet-stream").replace(/[^\w.+\-\/]/g, "") || "application/octet-stream";
      // Base64 en lignes de 76 caractères (norme MIME).
      const flat = String(a.contentBase64 ?? "").replace(/\s+/g, "");
      const chunks: string[] = [];
      for (let i = 0; i < flat.length; i += 76) chunks.push(flat.slice(i, i + 76));
      const content = chunks.join("\r\n");
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
  let r: Response;
  if (attachments.length === 0) {
    const payload: Record<string, unknown> = { raw: b64url(new TextEncoder().encode(mime)) };
    if (body.threadId) payload.threadId = body.threadId;
    r = await fetch(GMAIL_SEND, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } else {
    // Avec pièces jointes : point d'envoi « upload » de Gmail (jusqu'à 35 Mo), le mail
    // part tel quel sans être ré-encodé (évite la limite de calcul des fonctions).
    const rel = "ttp_rel_" + Date.now().toString(36);
    const meta = JSON.stringify(body.threadId ? { threadId: body.threadId } : {});
    const upload = [
      `--${rel}`, "Content-Type: application/json; charset=UTF-8", "", meta,
      `--${rel}`, "Content-Type: message/rfc822", "", mime,
      `--${rel}--`, "",
    ].join("\r\n");
    r = await fetch(GMAIL_UPLOAD, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${rel}` },
      body: upload,
    });
  }
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

  return jsonRes({ ok: true, id, threadId, box });
});
