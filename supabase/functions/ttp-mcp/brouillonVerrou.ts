// ============================================================================
// ttp-mcp/brouillonVerrou.ts : lire un brouillon Gmail en entier pour le verrou des agents.
// ----------------------------------------------------------------------------
// Une proposition « brouillon_mail » d'un agent montre dans la page Agents le brouillon tel que
// le serveur le lit ici (De, À, Cc, Cci, objet, texte, pièces jointes), jamais le résumé écrit
// par l'agent, et garde son empreinte (_shared/verrouAgent.ts, empreinteBrouillon). Avant
// l'envoi, le brouillon est relu et doit avoir la même empreinte. Lecture seule.
// Mêmes jetons que ttp-mcp/gmail.ts (partnerships@ par la connexion Google de l'app, talent@ par
// le compte de service, boîte d'un créateur connectée).
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getAccessToken } from "../_shared/google.ts";
import { boxToken } from "../_shared/gmailBox.ts";
import { creatorBoxToken, isCreatorBox } from "../_shared/creatorBox.ts";
import { charsetOf, decodeGmailBody, gfetch } from "../_shared/gfetch.ts";
import type { BrouillonComplet } from "../_shared/verrouAgent.ts";
import type { MailBox } from "./gmail.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
type Hdr = { name: string; value: string };
type Part = { mimeType?: string; filename?: string; headers?: Hdr[]; body?: { data?: string; size?: number; attachmentId?: string }; parts?: Part[] };

const header = (h: Hdr[] | undefined, n: string) => h?.find((x) => x.name.toLowerCase() === n)?.value ?? "";

async function jeton(sb: SupabaseClient, box: MailBox): Promise<string> {
  if (isCreatorBox(box)) return await creatorBoxToken(sb, box);
  return box === "talent" ? await boxToken(sb, "talent", "read") : await getAccessToken(sb);
}

/** Texte lisible d'un HTML (aperçu dans la page Agents seulement : l'empreinte porte sur les parties brutes). */
function sansBalises(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

/**
 * Le brouillon tel qu'il partirait. Lève une erreur « gmail_<statut> » si Gmail refuse (404 :
 * déjà envoyé ou supprimé).
 */
export async function lireBrouillonComplet(sb: SupabaseClient, box: MailBox, draftId: string): Promise<BrouillonComplet> {
  const token = await jeton(sb, box);
  const res = await gfetch(`${GMAIL}/drafts/${encodeURIComponent(draftId)}?format=full`, { headers: { Authorization: `Bearer ${token}` } }, { timeoutMs: 12_000 });
  const d = (await res.json().catch(() => ({}))) as { message?: { id?: string; payload?: Part } };
  if (!res.ok) throw new Error(`gmail_${res.status}`);
  const m = d.message;
  const h = m?.payload?.headers;
  const corps: string[] = [];
  const pieces: { nom: string; type: string; taille: number }[] = [];
  let plain = "";
  let html = "";
  const walk = (x: Part | undefined) => {
    if (!x) return;
    if (x.filename) pieces.push({ nom: x.filename, type: String(x.mimeType ?? "").toLowerCase(), taille: Number(x.body?.size ?? 0) });
    else if (x.body?.data) {
      const t = decodeGmailBody(x.body.data, charsetOf(x.headers));
      corps.push(`${x.mimeType ?? ""}\n${t}`);
      if (x.mimeType === "text/plain" && !plain) plain = t;
      else if (x.mimeType === "text/html" && !html) html = t;
    }
    for (const c of x.parts ?? []) walk(c);
  };
  walk(m?.payload);
  const texte = (plain || sansBalises(html)).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return {
    message: String(m?.id ?? ""),
    from: header(h, "from"), to: header(h, "to"), cc: header(h, "cc"), bcc: header(h, "bcc"), subject: header(h, "subject"),
    corps, texte, pieces,
    claude: header(h, "x-ttp-source").toLowerCase() === "claude",
  };
}
