// ============================================================================
// gmail-reconcile/index.ts
// ----------------------------------------------------------------------------
// Le « scan invisible » de la prospection : détecte les emails ENVOYÉS depuis
// la boîte agence (Gmail) depuis le dernier passage, matche les destinataires
// avec le carnet `contacts`, et met à jour TOUT SEUL :
//   • contacts.last_contacted (si plus récent) ;
//   • contacts.touches : une entrée {canal:"email", kind:contact|relance}
//     par mail, id = "gm<messageId>" → naturellement dédoublonné, un même
//     mail ne sera jamais compté deux fois même si le cron rejoue.
// Résultat : les statuts de la page WhatsApp et les filtres « À relancer »
// avancent sans que Marc ouvre quoi que ce soit.
//
// Appelé par pg_cron toutes les heures (Bearer CRON_SECRET) OU par l'agence
// (JWT) pour un passage manuel. Curseur : blob clé `gmailReconcileState`
// ({ lastTs } pour partnerships@, { talentLastTs } pour talent@ : les DEUX boîtes
// sont scannées, talent@ via le compte de service si configuré).
// 1er passage : regarde 24 h en arrière (petit amorçage, pas d'historique massif).
// ============================================================================

import { getServiceClient, getAccessToken, corsHeaders, timingSafeEqualStr } from "../_shared/google.ts";
import { boxToken, talentAddress } from "../_shared/gmailBox.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
type Sb = ReturnType<typeof getServiceClient>;
type Header = { name: string; value: string };

type Touch = { id: string; date: string; canal: string; kind: string; note?: string };

async function authorized(req: Request, sb: Sb): Promise<boolean> {
  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  if (!bearer) return false;
  if (CRON_SECRET && timingSafeEqualStr(bearer, CRON_SECRET)) return true;
  const { data, error } = await sb.auth.getUser(bearer);
  if (error || !data?.user) return false;
  const { data: prof, error: pe } = await sb.from("profiles").select("role").eq("user_id", data.user.id).maybeSingle<{ role: string }>();
  return !pe && prof?.role === "agency";
}

/** Blob agence : lecture (ligne la plus récente) + écriture d'une clé. */
async function readBlob(sb: Sb): Promise<{ id: string | null; obj: Record<string, unknown> }> {
  const { data } = await sb.from("module_rows").select("id,a").eq("module", "__app_state__").order("created_at", { ascending: false }).limit(1);
  const row = data?.[0] as { id: string; a: string } | undefined;
  if (!row) return { id: null, obj: {} };
  try {
    const o = JSON.parse(row.a);
    return { id: row.id, obj: o && typeof o === "object" ? o : {} };
  } catch {
    return { id: row.id, obj: {} };
  }
}
async function writeBlobKey(sb: Sb, id: string | null, obj: Record<string, unknown>, key: string, value: unknown) {
  const next = { ...obj, [key]: value };
  const json = JSON.stringify(next);
  if (id) await sb.from("module_rows").update({ a: json }).eq("id", id);
  else await sb.from("module_rows").insert({ module: "__app_state__", a: json });
}

/** Extrait toutes les adresses email d'un en-tête To/Cc ("Nom <a@b.c>, d@e.f"). */
function parseEmails(header: string): string[] {
  const out = new Set<string>();
  for (const m of header.matchAll(/[^\s<>,;"']+@[^\s<>,;"']+\.[^\s<>,;"']+/g)) out.add(m[0].toLowerCase());
  return [...out];
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const jsonRes = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const sb = getServiceClient();
  if (!(await authorized(req, sb))) return jsonRes({ error: "unauthorized" }, 401);

  type Sent = { id: string; ts: number; to: string[] };

  /** Mails ENVOYÉS depuis `lastTs` dans une boîte (null si la lecture échoue). */
  async function scanSent(token: string, lastTs: number): Promise<Sent[] | null> {
    const q = encodeURIComponent(`in:sent after:${Math.floor(lastTs / 1000)}`);
    const listRes = await fetch(`${GMAIL}/messages?q=${q}&maxResults=50`, { headers: { Authorization: `Bearer ${token}` } });
    const list = await listRes.json().catch(() => ({}));
    if (!listRes.ok) return null;
    const ids: string[] = ((list as { messages?: { id: string }[] }).messages ?? []).map((m) => m.id);
    const metas = await Promise.all(
      ids.map(async (id): Promise<Sent | null> => {
        const mr = await fetch(`${GMAIL}/messages/${id}?format=metadata&metadataHeaders=To&metadataHeaders=Cc`, { headers: { Authorization: `Bearer ${token}` } });
        if (!mr.ok) return null;
        const m = await mr.json().catch(() => null);
        if (!m) return null;
        const ts = Number(m.internalDate ?? 0);
        if (!ts || ts <= lastTs) return null;
        const headers: Header[] = m.payload?.headers ?? [];
        const h = (n: string) => headers.find((x) => x.name.toLowerCase() === n)?.value ?? "";
        const to = [...parseEmails(h("to")), ...parseEmails(h("cc"))];
        return to.length ? { id: m.id, ts, to } : null;
      }),
    );
    return metas.filter((x): x is Sent => x !== null);
  }

  const { id: blobId, obj: blob } = await readBlob(sb);
  const state = (blob.gmailReconcileState as { lastTs?: number; talentLastTs?: number }) ?? {};
  // 1er passage (par boîte) : petit amorçage de 24 h (jamais tout l'historique).
  const dayAgo = Date.now() - 24 * 3600e3;
  const nextState: { lastTs?: number; talentLastTs?: number } = { ...state };
  const sent: Sent[] = [];
  let scanned = 0;

  // partnerships@ (connexion de l'app).
  try {
    const lastTs = Number(state.lastTs ?? 0) || dayAgo;
    const got = await scanSent(await getAccessToken(sb), lastTs);
    if (got) {
      scanned++;
      sent.push(...got);
      nextState.lastTs = Math.max(lastTs, ...got.map((x) => x.ts));
    }
  } catch { /* Google non connecté : on passe à talent@ */ }

  // talent@ (compte de service, lecture seule).
  if (talentAddress()) {
    try {
      const lastTs = Number(state.talentLastTs ?? 0) || dayAgo;
      const got = await scanSent(await boxToken(sb, "talent", "read"), lastTs);
      if (got) {
        scanned++;
        sent.push(...got);
        nextState.talentLastTs = Math.max(lastTs, ...got.map((x) => x.ts));
      }
    } catch { /* compte de service indisponible : partnerships@ seul */ }
  }

  if (!scanned) return jsonRes({ ok: true, skipped: "aucune_boite" });
  sent.sort((a, b) => a.ts - b.ts);

  // Carnet : tous les contacts avec email, indexés par adresse.
  const { data: contactsRaw } = await sb.from("contacts").select("id,email,last_contacted,touches");
  const byEmail = new Map<string, { id: string; email: string; last_contacted: string | null; touches: unknown }>();
  for (const c of (contactsRaw ?? []) as { id: string; email: string | null; last_contacted: string | null; touches: unknown }[]) {
    const e = (c.email ?? "").trim().toLowerCase();
    if (e) byEmail.set(e, { ...c, email: e });
  }

  // Regroupe les mails par contact, puis écrit une seule mise à jour par contact.
  const perContact = new Map<string, { row: NonNullable<ReturnType<typeof byEmail.get>>; hits: Sent[] }>();
  for (const s of sent) {
    for (const addr of s.to) {
      const row = byEmail.get(addr);
      if (!row) continue;
      const entry = perContact.get(row.id) ?? { row, hits: [] };
      entry.hits.push(s);
      perContact.set(row.id, entry);
    }
  }

  let updated = 0;
  let touchesAdded = 0;
  for (const { row, hits } of perContact.values()) {
    const existing: Touch[] = Array.isArray(row.touches) ? (row.touches as Touch[]) : [];
    const known = new Set(existing.map((t) => t.id));
    let hasActivity = existing.length > 0 || !!row.last_contacted;
    const additions: Touch[] = [];
    for (const h of hits.sort((a, b) => a.ts - b.ts)) {
      const tid = `gm${h.id}`;
      if (known.has(tid)) continue; // déjà journalisé (rejeu du cron)
      additions.push({ id: tid, date: new Date(h.ts).toISOString(), canal: "email", kind: hasActivity ? "relance" : "contact" });
      known.add(tid);
      hasActivity = true;
    }
    if (!additions.length) continue;
    const nextTouches = [...additions.reverse(), ...existing]; // plus récent d'abord
    const newestMs = Math.max(...hits.map((h) => h.ts));
    const patch: Record<string, unknown> = { touches: nextTouches };
    if (!row.last_contacted || newestMs > new Date(row.last_contacted).getTime())
      patch.last_contacted = new Date(newestMs).toISOString();
    const { error } = await sb.from("contacts").update(patch).eq("id", row.id);
    if (!error) {
      updated++;
      touchesAdded += additions.length;
    }
  }

  await writeBlobKey(sb, blobId, blob, "gmailReconcileState", nextState);
  return jsonRes({ ok: true, mails: sent.length, contacts: updated, touches: touchesAdded });
});
