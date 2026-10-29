// ============================================================================
// gmail-poll/tasks.ts : les demandes des mails reçus → tâches de la To-do.
// ----------------------------------------------------------------------------
// Pour chaque nouveau mail venu de l'extérieur (pas l'agence, pas un robot, pas une
// promotion ni une newsletter) : lecture du texte, demandes repérées par des règles
// fixes (_shared/mailTasks.ts, sans IA), marque (fiche contact, sinon collab citée,
// sinon domaine de l'adresse) et collab en cours reliées, puis une tâche par demande :
// titre court, échéance, phrase du mail en description, lien « Voir le mail ».
// Dédoublonnage : clé fil + sujet dans le blob (`mailTaskKeys`, 120 jours), et pas de
// tâche si la même est déjà ouverte. Réglage : `notifPrefs.mailTasks === false` coupe tout.
// ============================================================================

import type { getServiceClient } from "../_shared/google.ts";
import { gfetch } from "../_shared/gfetch.ts";
import { brandMatcher, norm } from "../_shared/brandmatch.ts";
import { creatorsForMail, type CreatorMailSetting, type NewMail } from "../_shared/mailNotif.ts";
import { brandFromEmail, ignoredSender, mailTasks, taskKey } from "../_shared/mailTasks.ts";

type Sb = ReturnType<typeof getServiceClient>;
type Box = NewMail["box"];
export type TaskMail = NewMail & { listUnsub?: boolean };
type Collab = { id: string; brand: string; creator: string | null; updated_at: string | null; created_at: string | null };

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_MAILS = 30; // mails lus en entier par passage
const KEEP_DAYS = 120;
const SKIP_LABELS = ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES", "CATEGORY_FORUMS", "SPAM"];

const addr = (from: string) => ((/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase());
const displayName = (from: string) => (/^\s*"?([^"<]+?)"?\s*</.exec(from)?.[1] ?? "").trim();
const frDay = (ts: number) => new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" });

/** Texte d'un message Gmail (format full) : text/plain, sinon text/html sans balises. */
function bodyText(payload: Record<string, unknown> | undefined): string {
  const decode = (data: string) => {
    try {
      const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
      return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    } catch {
      return "";
    }
  };
  let plain = "";
  let html = "";
  const walk = (p: Record<string, unknown> | undefined) => {
    if (!p) return;
    const mime = String(p.mimeType ?? "");
    const data = (p.body as { data?: string } | undefined)?.data;
    if (data && mime === "text/plain" && !plain) plain = decode(data);
    if (data && mime === "text/html" && !html) html = decode(data);
    for (const part of (p.parts as Record<string, unknown>[] | undefined) ?? []) walk(part);
  };
  walk(payload);
  if (plain) return plain.slice(0, 8000);
  return html
    .replace(/<(br|\/p|\/div|\/li|\/tr)[^>]*>/gi, "\n")
    .replace(/<blockquote[\s\S]*$/i, "") // la suite = message cité
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .slice(0, 8000);
}

async function readBody(token: string, id: string): Promise<string | null> {
  const r = await gfetch(`${GMAIL}/messages/${encodeURIComponent(id)}?format=full`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const m = await r.json().catch(() => null) as { payload?: Record<string, unknown> } | null;
  return m ? bodyText(m.payload) : null;
}

/** Colonne `collab_id` absente (SQL pas encore lancé) : on réessaie sans elle. */
const collabColumnMissing = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42703" || e.code === "PGRST204" || /collab_id/.test(e.message ?? ""));

export async function tasksFromMails(
  sb: Sb,
  tokens: Partial<Record<Box, string>>,
  mails: TaskMail[],
  blob: Record<string, unknown>,
  agencyDomain: string,
  settings: CreatorMailSetting[],
): Promise<number> {
  const candidates = mails.filter((m) => {
    const email = addr(m.from);
    if (!email.includes("@") || email.endsWith("@" + agencyDomain) || ignoredSender(email) || m.listUnsub) return false;
    return !(m.labelIds ?? []).some((l) => SKIP_LABELS.includes(l));
  }).slice(0, MAX_MAILS);
  if (!candidates.length) return 0;

  const seen = (blob.mailTaskKeys && typeof blob.mailTaskKeys === "object" ? blob.mailTaskKeys : {}) as Record<string, number>;
  const { data: colData } = await sb.from("collabs").select("id, brand, creator, updated_at, created_at").eq("status", "active");
  const collabs = (colData ?? []) as Collab[];
  const newKeys: Record<string, number> = {};
  let made = 0;

  for (const m of candidates) {
    const token = tokens[m.box];
    if (!token) continue;
    const body = await readBody(token, m.id).catch(() => null);
    if (body === null) continue;
    const email = addr(m.from);
    const name = displayName(m.from) || email;

    // Marque : fiche contact de l'expéditeur, sinon collab citée, sinon domaine, sinon nom.
    const { data: ct } = await sb.from("contacts").select("brand").ilike("email", email.replace(/[\\%_]/g, (c) => `\\${c}`)).not("brand", "is", null).limit(1);
    const text = `${m.subject}\n${name}\n${email}\n${body}`;
    let brand = ((ct?.[0] as { brand?: string } | undefined)?.brand ?? "").trim();
    const domainBrand = brandFromEmail(email);
    if (!brand) brand = collabs.find((c) => domainBrand && norm(c.brand) === norm(domainBrand))?.brand ?? "";
    if (!brand) brand = collabs.find((c) => c.brand && brandMatcher(c.brand, [])(text))?.brand ?? "";
    if (!brand) brand = domainBrand ?? "";
    const who = brand || name;

    // Collab en cours de cette marque (celle du créateur destinataire en priorité).
    const forCreators = creatorsForMail(m, settings, agencyDomain).map((c) => norm(c));
    const ofBrand = brand ? collabs.filter((c) => norm(c.brand) === norm(brand)) : [];
    const collab = ofBrand.find((c) => c.creator && forCreators.includes(norm(c.creator)))
      ?? [...ofBrand].sort((a, b) => String(b.updated_at ?? b.created_at ?? "").localeCompare(String(a.updated_at ?? a.created_at ?? "")))[0];

    for (const t of mailTasks({ subject: m.subject, body, who, receivedAt: m.ts })) {
      const key = taskKey(m.threadId, t.kind);
      if (seen[key] || newKeys[key]) continue;
      const { data: open } = await sb.from("todos").select("id").eq("text", t.title).eq("done", false).limit(1);
      if (open?.length) {
        newKeys[key] = Date.now();
        continue;
      }
      const row: Record<string, unknown> = {
        text: t.title,
        descr: `Mail de ${name}${brand && norm(brand) !== norm(name) ? ` (${brand})` : ""}, ${frDay(m.ts)} : « ${t.quote} »`,
        due: t.due,
        priority: t.priority,
        tag: "Mail",
        source: "agency",
        status: "À faire",
        attachments: [{ name: "Voir le mail", size: "", path: `/?open=mails&thread=${m.threadId}&box=${m.box}` }],
        ...(collab ? { collab_id: collab.id } : {}),
      };
      let { error } = await sb.from("todos").insert(row);
      if (collabColumnMissing(error)) {
        delete row.collab_id;
        ({ error } = await sb.from("todos").insert(row));
      }
      if (error) {
        console.error("gmail-poll tâche", error.message);
        continue;
      }
      newKeys[key] = Date.now();
      made++;
    }
  }

  // Clés vues : ajout des nouvelles, oubli des plus vieilles (120 jours).
  const limit = Date.now() - KEEP_DAYS * 86400000;
  const remove = Object.entries(seen).filter(([, at]) => typeof at !== "number" || at < limit).map(([k]) => k);
  if (Object.keys(newKeys).length || remove.length) {
    const { error } = await sb.rpc("app_state_merge", { p_key: "mailTaskKeys", p_set: newKeys, p_remove: remove });
    if (error) console.error("gmail-poll mailTaskKeys", error.message);
  }
  return made;
}
