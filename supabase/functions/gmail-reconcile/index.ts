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
import { gfetch, mapPool } from "../_shared/gfetch.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_PAGES = 10; // 1 000 mails envoyés max par passage et par boîte
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

/** Blob agence : lecture (ligne la plus récente) + écriture atomique d'une clé. */
async function readBlob(sb: Sb): Promise<{ id: string | null; obj: Record<string, unknown>; failed?: boolean }> {
  const { data, error } = await sb.from("module_rows").select("id,a").eq("module", "__app_state__").order("created_at", { ascending: false }).limit(1);
  if (error) return { id: null, obj: {}, failed: true };
  const row = data?.[0] as { id: string; a: string } | undefined;
  if (!row) return { id: null, obj: {} };
  try {
    const o = JSON.parse(row.a);
    return { id: row.id, obj: o && typeof o === "object" ? o : {} };
  } catch {
    return { id: row.id, obj: {} };
  }
}
/**
 * Écrit UNE clé du blob via la fonction SQL app_state_set (jsonb_set sous verrou de
 * ligne) : un réglage enregistré pendant le passage n'est plus écrasé. Ancienne
 * réécriture du blob entier seulement si la fonction SQL n'existe pas encore.
 */
async function saveStateKey(sb: Sb, key: string, value: unknown) {
  const { error } = await sb.rpc("app_state_set", { p_key: key, p_value: value });
  if (!error) return;
  const missing = error.code === "42883" || error.code === "PGRST202" ||
    /function .* does not exist|could not find the function/i.test(error.message ?? "");
  if (!missing) {
    console.error("gmail-reconcile app_state_set", error.message);
    return;
  }
  const { id, obj, failed } = await readBlob(sb);
  if (failed) return;
  const json = JSON.stringify({ ...obj, [key]: value });
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
  type Scan = { sent: Sent[]; complete: boolean };

  /**
   * Mails ENVOYÉS depuis `lastTs` dans une boîte (null si la liste est illisible). Toutes les
   * pages de la liste sont lues. `complete` = tout a été lu : sinon le curseur ne bouge pas
   * (le passage suivant relit la même période ; les touches « gm<id> » sont dédoublonnées).
   */
  async function scanSent(token: string, lastTs: number): Promise<Scan | null> {
    const q = encodeURIComponent(`in:sent after:${Math.floor(lastTs / 1000)}`);
    const auth = { headers: { Authorization: `Bearer ${token}` } };
    const ids: string[] = [];
    let complete = true;
    let pageToken = "";
    for (let n = 0; ; n++) {
      if (n >= MAX_PAGES) {
        complete = false;
        break;
      }
      let res: Response;
      try {
        res = await gfetch(`${GMAIL}/messages?q=${q}&maxResults=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, auth);
      } catch {
        if (n === 0) return null;
        complete = false;
        break;
      }
      const list = await res.json().catch(() => null) as { messages?: { id: string }[]; nextPageToken?: string } | null;
      if (!res.ok || !list) {
        if (n === 0) return null;
        complete = false;
        break;
      }
      ids.push(...(list.messages ?? []).map((m) => m.id));
      if (!list.nextPageToken) break;
      pageToken = list.nextPageToken;
    }
    const metas = await mapPool(ids, 8, async (id): Promise<Sent | null> => {
      try {
        const mr = await gfetch(`${GMAIL}/messages/${id}?format=metadata&metadataHeaders=To&metadataHeaders=Cc`, auth);
        if (mr.status === 404) return null; // supprimé entre-temps
        const m = mr.ok ? await mr.json().catch(() => null) : null;
        if (!m) {
          complete = false;
          return null;
        }
        const ts = Number(m.internalDate ?? 0);
        if (!ts || ts <= lastTs) return null;
        const headers: Header[] = m.payload?.headers ?? [];
        const h = (n: string) => headers.find((x) => x.name.toLowerCase() === n)?.value ?? "";
        const to = [...parseEmails(h("to")), ...parseEmails(h("cc"))];
        return to.length ? { id: String(m.id), ts, to } : null;
      } catch {
        complete = false;
        return null;
      }
    });
    return { sent: metas.filter((x): x is Sent => x !== null), complete };
  }

  const { obj: blob, failed: blobFailed } = await readBlob(sb);
  if (blobFailed) return jsonRes({ ok: false, error: "etat_illisible" }, 500);
  const state = (blob.gmailReconcileState as { lastTs?: number; talentLastTs?: number }) ?? {};
  // 1er passage (par boîte) : petit amorçage de 24 h (jamais tout l'historique).
  const dayAgo = Date.now() - 24 * 3600e3;
  const sent: Sent[] = [];
  // Curseurs proposés, appliqués SEULEMENT si tout a été lu ET enregistré.
  const cursors: { key: "lastTs" | "talentLastTs"; value: number }[] = [];
  let scanned = 0;

  // partnerships@ (connexion de l'app).
  try {
    const lastTs = Number(state.lastTs ?? 0) || dayAgo;
    const got = await scanSent(await getAccessToken(sb), lastTs);
    if (got) {
      scanned++;
      sent.push(...got.sent);
      if (got.complete) cursors.push({ key: "lastTs", value: Math.max(lastTs, ...got.sent.map((x) => x.ts)) });
    }
  } catch { /* Google non connecté : on passe à talent@ */ }

  // talent@ (compte de service, lecture seule).
  if (talentAddress()) {
    try {
      const lastTs = Number(state.talentLastTs ?? 0) || dayAgo;
      const got = await scanSent(await boxToken(sb, "talent", "read"), lastTs);
      if (got) {
        scanned++;
        sent.push(...got.sent);
        if (got.complete) cursors.push({ key: "talentLastTs", value: Math.max(lastTs, ...got.sent.map((x) => x.ts)) });
      }
    } catch { /* compte de service indisponible : partnerships@ seul */ }
  }

  if (!scanned) return jsonRes({ ok: true, skipped: "aucune_boite" });
  sent.sort((a, b) => a.ts - b.ts);

  // Carnet : tous les contacts avec email, indexés par adresse. Lecture ratée = on s'arrête
  // AVANT de bouger les curseurs (sinon ces mails ne seraient jamais notés).
  const { data: contactsRaw, error: ctErr } = await sb.from("contacts").select("id,email");
  if (ctErr) return jsonRes({ ok: false, error: "contacts_illisibles" }, 500);
  const byEmail = new Map<string, string>();
  for (const c of (contactsRaw ?? []) as { id: string; email: string | null }[]) {
    const e = (c.email ?? "").trim().toLowerCase();
    if (e) byEmail.set(e, c.id);
  }

  // Regroupe les mails par contact, puis écrit une seule mise à jour par contact.
  const perContact = new Map<string, Sent[]>();
  for (const s of sent) {
    for (const addr of s.to) {
      const id = byEmail.get(addr);
      if (!id) continue;
      const hits = perContact.get(id) ?? [];
      if (!hits.some((h) => h.id === s.id)) hits.push(s);
      perContact.set(id, hits);
    }
  }

  let updated = 0;
  let touchesAdded = 0;
  let allSaved = true;
  for (const [contactId, hits] of perContact) {
    // Relit la fiche JUSTE avant d'écrire : une touche ajoutée entre-temps (app, autre
    // passage, DM Instagram) n'est pas écrasée.
    const { data: row, error: re } = await sb.from("contacts").select("touches,last_contacted").eq("id", contactId).maybeSingle<{ touches: unknown; last_contacted: string | null }>();
    if (re || !row) {
      if (re) allSaved = false;
      continue;
    }
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
    const { error } = await sb.from("contacts").update(patch).eq("id", contactId);
    if (error) {
      allSaved = false;
      continue;
    }
    updated++;
    touchesAdded += additions.length;
  }

  // Curseurs avancés seulement si tout est enregistré : sinon le prochain passage relit.
  if (allSaved && cursors.length) {
    const nextState: { lastTs?: number; talentLastTs?: number } = { ...state };
    for (const c of cursors) nextState[c.key] = c.value;
    await saveStateKey(sb, "gmailReconcileState", nextState);
  }
  return jsonRes({ ok: true, mails: sent.length, contacts: updated, touches: touchesAdded, complete: allSaved && cursors.length === scanned });
});
