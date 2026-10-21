// ============================================================================
// _shared/gmailDrafts.ts : brouillons Gmail → lignes du dossier « Brouillons ».
// ----------------------------------------------------------------------------
// Logique pure (testée) utilisée par gmail-history (liste) et gmail-thread
// (suppression) :
//   • draftRow()  : brouillon Gmail (drafts.get format=full) → ligne de la liste,
//                   même forme qu'un fil + draftId, destinataires, corps (borné).
//   • isDraftId() : identifiant de brouillon acceptable dans une URL Gmail.
// Un brouillon créé par Claude (connecteur ttp-mcp) porte l'en-tête
// `X-TTP-Source: claude` : la ligne l'indique (`byClaude`).
// ============================================================================

import { charsetOf, decodeGmailBody } from "./gfetch.ts";

export type DraftBox = "partnerships" | "talent";
type Hdr = { name: string; value: string };
export type DraftPart = {
  mimeType?: string; filename?: string; headers?: Hdr[];
  body?: { data?: string; attachmentId?: string; size?: number }; parts?: DraftPart[];
};
export type GmailDraft = {
  id?: string;
  message?: { id?: string; threadId?: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: DraftPart };
};
export type DraftRow = {
  draftId: string; messageId: string; threadId: string; box: DraftBox;
  /** Mêmes champs qu'un fil de la liste (l'app réutilise sa carte). */
  subject: string; name: string; email: string; snippet: string; ts: number;
  count: 1; direction: "out"; unread: false; archived: false;
  /** Destinataires (adresses en minuscules). */
  to: string[]; cc: string[]; bcc: string[];
  /** Réponse dans un fil existant (en-tête In-Reply-To présent). */
  reply: boolean; inReplyTo: string; references: string;
  /** Brouillon préparé par Claude (en-tête X-TTP-Source: claude). */
  byClaude: boolean;
  /** Corps du brouillon (HTML et/ou texte), coupé au-delà de BODY_MAX caractères. */
  html: string; text: string; bodyCut?: true;
  /** Pièces jointes du brouillon (noms) : l'app ne sait pas les reprendre. */
  attachments: string[];
};

/** Taille max de chaque corps renvoyé (HTML, texte). */
export const BODY_MAX = 60_000;

const hv = (headers: Hdr[] | undefined, name: string) =>
  (headers ?? []).find((x) => x.name.toLowerCase() === name)?.value ?? "";
const addrs = (v: string) => [...v.matchAll(/[^\s<>",;]+@[^\s<>",;]+/g)].map((m) => m[0].toLowerCase());
const firstAddr = (v: string) => addrs(v)[0] ?? "";
/** Nom affiché du premier destinataire (« Anna <anna@x.fr> » → « Anna »). */
function firstName(v: string): string {
  const first = v.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)[0] ?? "";
  const n = first.replace(/<[^>]*>/g, "").replace(/"/g, "").trim();
  return n && !n.includes("@") ? n : firstAddr(first);
}

/** Identifiant de brouillon Gmail (« r-123… », « r123… ») : lettres, chiffres, tiret, 64 max. */
export function isDraftId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9-]{1,64}$/.test(v);
}

/** Corps HTML / texte et pièces jointes d'un message (parcours des parties). */
function bodyOf(payload: DraftPart | undefined): { html: string; text: string; attachments: string[] } {
  let html = "";
  let text = "";
  const attachments: string[] = [];
  const walk = (p?: DraftPart) => {
    if (!p) return;
    const mime = (p.mimeType ?? "").toLowerCase();
    if (p.filename && (p.body?.attachmentId || p.body?.data)) attachments.push(p.filename);
    else if (mime === "text/html" && p.body?.data && !html) html = decodeGmailBody(p.body.data, charsetOf(p.headers));
    else if (mime === "text/plain" && p.body?.data && !text) text = decodeGmailBody(p.body.data, charsetOf(p.headers));
    for (const c of p.parts ?? []) walk(c);
  };
  walk(payload);
  return { html, text, attachments };
}

/** Brouillon Gmail (format=full) → ligne du dossier Brouillons (null si illisible). */
export function draftRow(d: GmailDraft, box: DraftBox): DraftRow | null {
  const m = d.message;
  if (!d.id || !m?.id) return null;
  const headers = m.payload?.headers ?? [];
  const h = (n: string) => hv(headers, n);
  const toH = h("to");
  const body = bodyOf(m.payload);
  const cut = body.html.length > BODY_MAX || body.text.length > BODY_MAX;
  const inReplyTo = h("in-reply-to").trim();
  return {
    draftId: d.id,
    messageId: m.id,
    threadId: m.threadId ?? "",
    box,
    subject: h("subject"),
    name: firstName(toH),
    email: firstAddr(toH),
    snippet: String(m.snippet ?? "").slice(0, 200),
    ts: Number(m.internalDate ?? 0),
    count: 1,
    direction: "out",
    unread: false,
    archived: false,
    to: [...new Set(addrs(toH))].slice(0, 20),
    cc: [...new Set(addrs(h("cc")))].slice(0, 20),
    bcc: [...new Set(addrs(h("bcc")))].slice(0, 20),
    reply: !!inReplyTo,
    inReplyTo,
    references: h("references").trim().slice(-1900),
    byClaude: h("x-ttp-source").trim().toLowerCase() === "claude",
    html: body.html.slice(0, BODY_MAX),
    text: body.text.slice(0, BODY_MAX),
    ...(cut ? { bodyCut: true as const } : {}),
    attachments: body.attachments.slice(0, 20),
  };
}
