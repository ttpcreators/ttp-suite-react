// ============================================================================
// gmail-poll/exclu.ts : contrats PDF reçus par mail → exclusivités à confirmer.
// ----------------------------------------------------------------------------
// Pour chaque nouveau mail venu de l'extérieur : les pièces jointes PDF qui ressemblent
// à un contrat (nom du fichier ou objet du mail, _shared/exclusivites.ts) sont lues
// (texte du PDF, puis règles fixes `readContract`, sans IA). Si le contrat a une clause
// d'exclusivité : le PDF est rangé dans Documents (contrats/), une exclusivité « à
// confirmer » est ajoutée à la page Exclusivités (elle ne bloque personne tant que
// l'agence ne l'a pas confirmée) et une tâche « Vérifier l'exclu » est créée.
// Dédoublonnage : clé mail + fichier dans le blob (`excluMailKeys`, 180 jours).
// Réglage : `notifPrefs.mailExclu === false` coupe tout.
// ============================================================================

import type { getServiceClient } from "../_shared/google.ts";
import { gfetch } from "../_shared/gfetch.ts";
import { creatorsForMail, type CreatorMailSetting } from "../_shared/mailNotif.ts";
import { brandFromEmail } from "../_shared/mailTasks.ts";
import { looksLikeContract, proposalFromMail, readContract } from "../_shared/exclusivites.ts";
import type { TaskMail } from "./tasks.ts";

type Sb = ReturnType<typeof getServiceClient>;
type Box = TaskMail["box"];
type Part = { filename?: string; mimeType?: string; body?: { attachmentId?: string; size?: number }; parts?: Part[] };

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_PDFS = 5; // contrats lus par passage
const MAX_BYTES = 15 * 1024 * 1024;
const KEEP_DAYS = 180;

const addr = (from: string) => ((/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase());
const parisToday = () => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date());
const firstName = (n: string) => {
  const w = n.trim().split(/\s+/)[0] ?? "";
  return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : "";
};

function pdfParts(p: Part | undefined, out: Part[] = []): Part[] {
  if (!p) return out;
  const name = p.filename ?? "";
  if (name && p.body?.attachmentId && (p.mimeType === "application/pdf" || /\.pdf$/i.test(name))) out.push(p);
  for (const c of p.parts ?? []) pdfParts(c, out);
  return out;
}

function fromB64Url(data: string): Uint8Array {
  const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("npm:unpdf@1.8.1");
  const doc = await getDocumentProxy(bytes);
  const { text } = await extractText(doc, { mergePages: true });
  return String(Array.isArray(text) ? text.join("\n") : text).replace(/[ \t]+/g, " ").trim().slice(0, 60000);
}

export async function excluFromMails(
  sb: Sb,
  tokens: Partial<Record<Box, string>>,
  mails: TaskMail[],
  blob: Record<string, unknown>,
  agencyDomain: string,
  settings: CreatorMailSetting[],
): Promise<number> {
  const candidates = mails.filter((m) => {
    const email = addr(m.from);
    return email.includes("@") && !email.endsWith("@" + agencyDomain) && !(m.labelIds ?? []).includes("SPAM");
  });
  if (!candidates.length) return 0;

  const seen = (blob.excluMailKeys && typeof blob.excluMailKeys === "object" ? blob.excluMailKeys : {}) as Record<string, number>;
  const newKeys: Record<string, number> = {};
  let read = 0;
  let made = 0;
  let known: { creators: string[]; brands: string[] } | null = null;
  const today = parisToday();

  for (const m of candidates) {
    if (read >= MAX_PDFS) break;
    const token = tokens[m.box];
    if (!token) continue;
    const r = await gfetch(`${GMAIL}/messages/${encodeURIComponent(m.id)}?format=full&fields=payload(filename,mimeType,body(attachmentId,size),parts(filename,mimeType,body(attachmentId,size),parts(filename,mimeType,body(attachmentId,size))))`, {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);
    if (!r?.ok) continue;
    const msg = await r.json().catch(() => null) as { payload?: Part } | null;
    for (const part of pdfParts(msg?.payload)) {
      if (read >= MAX_PDFS) break;
      const name = (part.filename ?? "").trim();
      const key = `${m.id}:${name}`;
      if (seen[key] || newKeys[key] || !looksLikeContract(name, m.subject)) continue;
      newKeys[key] = Date.now();
      if ((part.body?.size ?? 0) > MAX_BYTES) continue;
      read++;

      const a = await gfetch(`${GMAIL}/messages/${encodeURIComponent(m.id)}/attachments/${encodeURIComponent(part.body!.attachmentId!)}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => null);
      const data = a?.ok ? (await a.json().catch(() => null) as { data?: string } | null)?.data : null;
      if (!data) continue;
      const bytes = fromB64Url(data);
      const text = await pdfText(bytes).catch(() => "");
      if (text.replace(/\s/g, "").length < 200) continue; // scan sans texte : rien à lire

      if (!known) {
        const [cr, co, ct] = await Promise.all([
          sb.from("creators").select("name"),
          sb.from("collabs").select("brand"),
          sb.from("contacts").select("brand"),
        ]);
        known = {
          creators: ((cr.data ?? []) as { name: string }[]).map((c) => c.name).filter(Boolean),
          brands: [...new Set([...((co.data ?? []) as { brand: string | null }[]), ...((ct.data ?? []) as { brand: string | null }[])]
            .map((b) => (b.brand ?? "").trim()).filter(Boolean))],
        };
      }
      const reading = readContract(text, known, today);
      if (!reading.exclusivity) continue;

      // Marque de l'expéditeur (fiche contact, sinon domaine) et créatrice destinataire, en secours.
      const email = addr(m.from);
      const { data: ct } = await sb.from("contacts").select("brand").ilike("email", email.replace(/[\\%_]/g, (c) => `\\${c}`)).not("brand", "is", null).limit(1);
      const brandHint = ((ct?.[0] as { brand?: string } | undefined)?.brand ?? "").trim() || brandFromEmail(email);
      const creatorHint = creatorsForMail(m, settings, agencyDomain)[0] ?? null;

      const slug = (reading.brand ?? brandHint ?? "contrat").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "contrat";
      const path = `contrats/${slug}-${Date.now()}.pdf`;
      const up = await sb.storage.from("documents").upload(path, bytes, { contentType: "application/pdf", upsert: false });

      const proposal = proposalFromMail(reading, {
        creatorHint, brandHint, fileName: name, docPath: up.error ? null : path, today,
        mail: { threadId: m.threadId, box: m.box, subject: m.subject },
      });
      if (!proposal) continue;
      const row = { ...proposal, id: crypto.randomUUID(), createdAt: Date.now() };
      const { error } = await sb.rpc("app_state_list", { p_key: "exclusivites", p_upsert: [row], p_remove: [] });
      if (error) {
        console.error("gmail-poll exclu", error.message);
        continue;
      }
      made++;

      const who = [firstName(proposal.creator), proposal.brand].filter(Boolean).join(" × ") || name;
      await sb.from("todos").insert({
        text: `Vérifier l'exclu ${who}`.slice(0, 60),
        descr: `Contrat reçu par mail (« ${name} ») : exclusivité lue toute seule, à confirmer dans Exclusivités.\n\n« ${proposal.quote ?? ""} »`,
        due: today,
        priority: "haute",
        tag: "Mail",
        source: "agency",
        status: "À faire",
        attachments: [{ name: "Voir le mail", size: "", path: `/?open=mails&thread=${m.threadId}&box=${m.box}` }],
      }).then(({ error: e }) => e && console.error("gmail-poll exclu tâche", e.message));
    }
  }

  const limit = Date.now() - KEEP_DAYS * 86400000;
  const remove = Object.entries(seen).filter(([, at]) => typeof at !== "number" || at < limit).map(([k]) => k);
  if (Object.keys(newKeys).length || remove.length) {
    const { error } = await sb.rpc("app_state_merge", { p_key: "excluMailKeys", p_set: newKeys, p_remove: remove });
    if (error) console.error("gmail-poll excluMailKeys", error.message);
  }
  return made;
}
