// ============================================================================
// ttp-mcp/gmail.ts : les deux boîtes de l'agence pour Claude (recherche, lecture,
// brouillon, envoi). partnerships@ = connexion Google de l'app ; talent@ = compte de service.
// Envoi (sendMail) : fondateurs seulement, et Claude demande l'accord avant (outil envoyer_mail).
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getAccessToken } from "../_shared/google.ts";
import { boxToken, talentAddress } from "../_shared/gmailBox.ts";
import { gfetch, decodeGmailBody, charsetOf, mapPool } from "../_shared/gfetch.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
export type MailBox = "partnerships" | "talent";
type Hdr = { name: string; value: string };
type Part = { mimeType?: string; filename?: string; headers?: Hdr[]; body?: { data?: string; size?: number; attachmentId?: string }; parts?: Part[] };
type Msg = { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: Part };

export function boxesFor(box: string | undefined): MailBox[] {
  if (box === "partnerships") return ["partnerships"];
  if (box === "talent") return talentAddress() ? ["talent"] : [];
  return talentAddress() ? ["partnerships", "talent"] : ["partnerships"];
}

async function tokenFor(sb: SupabaseClient, box: MailBox, mode: "read" | "modify"): Promise<string> {
  return box === "talent" ? await boxToken(sb, "talent", mode) : await getAccessToken(sb);
}

async function gjson(token: string, url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await gfetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } }, { timeoutMs: 12_000 });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const m = (body.error as { message?: string } | undefined)?.message ?? String(res.status);
    throw new Error(`gmail_${res.status}: ${m}`);
  }
  return body;
}

const header = (h: Hdr[] | undefined, n: string) => h?.find((x) => x.name.toLowerCase() === n)?.value ?? "";
const frDate = (ms: number) => new Date(ms).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export type ThreadSummary = { box: MailBox; threadId: string; subject: string; from: string; date: string; ts: number; messages: number; unread: boolean; snippet: string };

/** Recherche Gmail (même syntaxe que la barre Gmail) dans une ou deux boîtes. */
export async function searchThreads(sb: SupabaseClient, box: string | undefined, q: string, max: number): Promise<{ threads: ThreadSummary[]; errors: string[] }> {
  const out: ThreadSummary[] = [];
  const errors: string[] = [];
  for (const b of boxesFor(box)) {
    try {
      const token = await tokenFor(sb, b, "read");
      const list = await gjson(token, `${GMAIL}/threads?maxResults=${max}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
      const ids = ((list.threads as { id: string }[] | undefined) ?? []).map((t) => t.id);
      const rows = await mapPool(ids, 6, async (id) => {
        try {
          const t = await gjson(token, `${GMAIL}/threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
          const msgs = (t.messages as Msg[] | undefined) ?? [];
          const last = msgs[msgs.length - 1];
          const first = msgs[0];
          const ts = Number(last?.internalDate ?? 0);
          return {
            box: b, threadId: id,
            subject: header(first?.payload?.headers, "subject") || "(sans objet)",
            from: header(last?.payload?.headers, "from"),
            date: ts ? frDate(ts) : "", ts,
            messages: msgs.length,
            unread: msgs.some((m) => m.labelIds?.includes("UNREAD")),
            snippet: String(last?.snippet ?? "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
          } as ThreadSummary;
        } catch {
          return null;
        }
      });
      out.push(...rows.filter((r): r is ThreadSummary => !!r));
    } catch (e) {
      errors.push(`${b}@ : ${(e as Error).message}`);
    }
  }
  out.sort((a, b) => b.ts - a.ts);
  return { threads: out.slice(0, max), errors };
}

/** Texte lisible d'un message : la partie texte, sinon le HTML sans balises. */
function textOf(p: Part | undefined): { text: string; files: string[] } {
  const files: string[] = [];
  let plain = "";
  let html = "";
  const walk = (x: Part | undefined) => {
    if (!x) return;
    if (x.filename && x.body?.attachmentId) files.push(x.filename);
    if (x.body?.data && !x.filename) {
      if (x.mimeType === "text/plain" && !plain) plain = decodeGmailBody(x.body.data, charsetOf(x.headers));
      else if (x.mimeType === "text/html" && !html) html = decodeGmailBody(x.body.data, charsetOf(x.headers));
    }
    for (const c of x.parts ?? []) walk(c);
  };
  walk(p);
  let text = plain || html
    .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  // Sans la partie citée (« Le … a écrit : » / « On … wrote: »), plus courte à lire.
  const cut = text.search(/\n\s*(Le .{5,120}a écrit\s*:|On .{5,120}wrote\s*:)/);
  if (cut > 40) text = text.slice(0, cut);
  return { text: text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(), files };
}

export async function readThread(sb: SupabaseClient, box: MailBox, threadId: string): Promise<string> {
  const token = await tokenFor(sb, box, "read");
  const t = await gjson(token, `${GMAIL}/threads/${encodeURIComponent(threadId)}?format=full`);
  const msgs = (t.messages as Msg[] | undefined) ?? [];
  if (!msgs.length) return "Fil vide.";
  const subject = header(msgs[0].payload?.headers, "subject") || "(sans objet)";
  let budget = 24_000;
  const parts: string[] = [`# ${subject}`, `Boîte : ${box}@ · ${msgs.length} message(s) · fil ${threadId}`];
  for (const m of msgs) {
    const h = m.payload?.headers;
    const { text, files } = textOf(m.payload);
    const body = text.slice(0, Math.max(0, Math.min(6000, budget)));
    budget -= body.length;
    parts.push(
      `\n---\nDe : ${header(h, "from")}\nÀ : ${header(h, "to")}${header(h, "cc") ? `\nCc : ${header(h, "cc")}` : ""}\nDate : ${frDate(Number(m.internalDate ?? 0))}` +
        (files.length ? `\nPièces jointes : ${files.join(", ")}` : "") +
        `\n\n${body || "(message vide)"}${text.length > body.length ? "\n[…coupé]" : ""}`,
    );
    if (budget <= 0) {
      parts.push("\n[Suite du fil coupée : trop long]");
      break;
    }
  }
  return parts.join("\n");
}

const b64urlUtf8 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64Utf8 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const encWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64Utf8(s)}?=`);
const clean = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

/** Brouillon Gmail (nouveau mail, ou réponse dans un fil existant). Rien n'est envoyé. */
/** Adresses e-mail d'un en-tête, en minuscules et triées (pour comparer deux « À »). */
function addrKey(v: string): string {
  return [...new Set((v.match(/[^\s<>,;"']+@[^\s<>,;"']+\.[^\s<>,;"']+/g) ?? []).map((a) => a.toLowerCase()))].sort().join(",");
}
/** Objet comparable : sans « Re: », espaces et casse normalisés. */
const subjKey = (s: string) => s.replace(/^\s*(re|tr|fwd?)\s*:\s*/i, "").replace(/\s+/g, " ").trim().toLowerCase();

type DraftRes = { id: string; message?: Msg };

/**
 * Brouillons DÉJÀ préparés par Claude pour la même personne, avec le même objet (et dans
 * le même fil pour une réponse), du plus récent au plus ancien. Sert à remplacer au lieu
 * d'empiler : une conversation relancée plusieurs fois ne crée plus de doublons.
 */
async function claudeTwins(token: string, to: string, subject: string, threadId?: string): Promise<DraftRes[]> {
  const first = addrKey(to).split(",")[0];
  if (!first) return [];
  const list = await gjson(token, `${GMAIL}/drafts?maxResults=50&q=${encodeURIComponent(`to:${first}`)}`);
  const ids = ((list.drafts as { id: string }[] | undefined) ?? []).map((d) => d.id).slice(0, 30);
  const wantTo = addrKey(to);
  const wantSubj = subjKey(subject);
  const found = await mapPool(ids, 6, async (id) => {
    try {
      const d = (await gjson(token, `${GMAIL}/drafts/${encodeURIComponent(id)}?format=metadata`)) as DraftRes;
      const h = d.message?.payload?.headers;
      if (header(h, "x-ttp-source").toLowerCase() !== "claude") return null; // jamais toucher à un brouillon écrit à la main
      if (addrKey(header(h, "to")) !== wantTo || subjKey(header(h, "subject")) !== wantSubj) return null;
      if (threadId && d.message?.threadId !== threadId) return null;
      return d;
    } catch {
      return null;
    }
  });
  return found.filter((d): d is DraftRes => !!d).sort((a, b) => Number(b.message?.internalDate ?? 0) - Number(a.message?.internalDate ?? 0));
}

/**
 * Prépare un brouillon Gmail (jamais envoyé). Si Claude a déjà préparé un brouillon pour
 * la même personne et le même objet, il est MIS À JOUR au lieu d'en créer un nouveau, et
 * ses éventuels doublons plus anciens (copies du même brouillon) sont supprimés.
 */
export async function createDraft(sb: SupabaseClient, box: MailBox, to: string, subject: string, message: string, threadId?: string): Promise<{ id: string; replaced: boolean; removed: number }> {
  const token = await tokenFor(sb, box, "modify");
  // X-TTP-Source : la page Mails de l'app affiche « par Claude » sur ce brouillon.
  const headers: string[] = [`To: ${clean(to)}`, `Subject: ${encWord(clean(subject))}`, "X-TTP-Source: claude", "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64"];
  if (threadId) {
    // Réponse : rattachée au dernier message du fil (le fil reste groupé chez la marque).
    const t = await gjson(token, `${GMAIL}/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`);
    const msgs = (t.messages as Msg[] | undefined) ?? [];
    const last = msgs[msgs.length - 1];
    const mid = header(last?.payload?.headers, "message-id");
    const refs = header(last?.payload?.headers, "references");
    if (mid) headers.push(`In-Reply-To: ${clean(mid)}`, `References: ${clean(`${refs} ${mid}`).slice(0, 1900)}`);
  }
  const raw = `${headers.join("\r\n")}\r\n\r\n${b64Utf8(message).replace(/.{76}/g, "$&\r\n")}`;
  const msg = { raw: b64urlUtf8(raw), ...(threadId ? { threadId } : {}) };

  // Recherche des jumeaux : si elle échoue, on crée simplement le brouillon (comme avant).
  let twins: DraftRes[] = [];
  try {
    twins = await claudeTwins(token, to, subject, threadId);
  } catch {
    twins = [];
  }
  if (twins.length) {
    const keep = twins[0];
    const res = await gjson(token, `${GMAIL}/drafts/${encodeURIComponent(keep.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: keep.id, message: msg }),
    });
    let removed = 0;
    for (const d of twins.slice(1)) {
      try {
        // Même suppression que le bouton « Supprimer » d'un brouillon dans l'app (gmail-thread).
        const r = await gfetch(`${GMAIL}/drafts/${encodeURIComponent(d.id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }, { timeoutMs: 12_000 });
        if (r.ok || r.status === 404) removed++;
      } catch {
        /* doublon laissé en place : il sera retiré au prochain passage */
      }
    }
    return { id: String(res.id ?? keep.id), replaced: true, removed };
  }
  const res = await gjson(token, `${GMAIL}/drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: msg }),
  });
  return { id: String(res.id ?? ""), replaced: false, removed: 0 };
}

/**
 * ENVOI d'un mail (outil envoyer_mail, fondateurs). `threadId` : réponse dans ce fil
 * (In-Reply-To / References du dernier message, objet « Re: » repris s'il manque).
 */
export async function sendMail(sb: SupabaseClient, box: MailBox, m: {
  to: string[]; cc: string[]; bcc: string[]; subject: string; html: string; threadId?: string;
}): Promise<{ id: string; threadId: string; subject: string }> {
  const token = box === "talent" ? await boxToken(sb, "talent", "send") : await getAccessToken(sb);
  let subject = clean(m.subject);
  const extra: string[] = [];
  if (m.threadId) {
    const t = await gjson(token, `${GMAIL}/threads/${encodeURIComponent(m.threadId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject`);
    const msgs = (t.messages as Msg[] | undefined) ?? [];
    const last = msgs[msgs.length - 1];
    const mid = header(last?.payload?.headers, "message-id");
    const refs = header(last?.payload?.headers, "references");
    if (mid) extra.push(`In-Reply-To: ${clean(mid)}`, `References: ${clean(`${refs} ${mid}`).slice(0, 1900)}`);
    if (!subject) {
      const s0 = header(msgs[0]?.payload?.headers, "subject");
      subject = /^\s*re\s*:/i.test(s0) ? s0 : `Re: ${s0}`;
    }
  }
  const head = [
    `To: ${m.to.join(", ")}`,
    ...(m.cc.length ? [`Cc: ${m.cc.join(", ")}`] : []),
    ...(m.bcc.length ? [`Bcc: ${m.bcc.join(", ")}`] : []),
    `Subject: ${encWord(subject || "(sans objet)")}`,
    ...extra,
    "X-TTP-Source: claude",
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  const raw = `${head.join("\r\n")}\r\n\r\n${b64Utf8(m.html).replace(/.{76}/g, "$&\r\n")}`;
  const res = await gjson(token, `${GMAIL}/messages/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw: b64urlUtf8(raw), ...(m.threadId ? { threadId: m.threadId } : {}) }),
  });
  return { id: String(res.id ?? ""), threadId: String(res.threadId ?? m.threadId ?? ""), subject };
}

/** Non lus de la boîte de réception (léger, pour le point du jour). */
export async function unreadCounts(sb: SupabaseClient): Promise<string[]> {
  const out: string[] = [];
  for (const b of boxesFor("all")) {
    try {
      const token = await tokenFor(sb, b, "read");
      const l = await gjson(token, `${GMAIL}/labels/INBOX`);
      out.push(`${b}@ : ${Number(l.threadsUnread ?? 0)} fil(s) non lu(s)`);
    } catch {
      out.push(`${b}@ : lecture impossible`);
    }
  }
  return out;
}
