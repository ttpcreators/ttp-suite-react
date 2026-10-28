// ============================================================================
// fullenrich/index.ts : trouver les bons contacts d'une marque (page Contacts).
// ----------------------------------------------------------------------------
// Agence seulement (JWT). Clé FullEnrich dans le secret FULLENRICH_API_KEY (jamais
// dans le code ni dans l'app).
//   { action: "credits" }                         → { ok, balance }
//   { action: "search", company, titles?, country?, limit?, offset? }
//                                                 → { ok, people[], total, credits }
//   { action: "enrich", first?, last?, company?, domain?, linkedin?, phone? }
//                                                 → { ok, email, emailStatus, phone } ou { ok, pending: id }
//   { action: "result", id }                      → même réponse qu'« enrich »
// Coûts : 0,25 crédit par personne trouvée ; email pro 1 crédit et téléphone 10 crédits,
// seulement s'ils sont trouvés. L'enrichissement est relu ici jusqu'à 25 s ; au-delà,
// l'app redemande avec « result ».
// ============================================================================

import { corsHeaders, getServiceClient } from "../_shared/google.ts";
import { bestContact, enrichContact, parsePeople, searchBody } from "../_shared/fullenrich.ts";

const API = "https://app.fullenrich.com/api/v2";
const KEY = (Deno.env.get("FULLENRICH_API_KEY") ?? "").trim();

async function fe(path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    const r = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(25_000),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { status: 0, body: {} };
  }
}

/** Erreur FullEnrich → raison lisible pour l'app. */
function why(status: number, body: Record<string, unknown>): string {
  if (status === 0) return "reseau";
  if (status === 401) return "cle_invalide";
  if (status === 402 || /credit/i.test(JSON.stringify(body))) return "credits_insuffisants";
  if (status === 429) return "limite";
  return `fullenrich_${status}`;
}

async function result(id: string, waitMs: number) {
  const until = Date.now() + waitMs;
  for (;;) {
    const r = await fe(`/contact/enrich/bulk/${encodeURIComponent(id)}`);
    const st = String(r.body.status ?? "");
    if (r.status === 200 && st === "FINISHED") return { ok: true, ...bestContact(r.body), credits: Number((r.body.cost as { credits?: number } | undefined)?.credits) || 0 };
    if (r.status === 200 && ["CANCELED", "CREDITS_INSUFFICIENT", "UNKNOWN"].includes(st)) return { error: st === "CREDITS_INSUFFICIENT" ? "credits_insuffisants" : "echec" };
    // En cours (200 IN_PROGRESS, ou 400 error.enrichment.in_progress) : on attend encore un peu.
    if (r.status !== 200 && !/in_progress/i.test(JSON.stringify(r.body))) return { error: why(r.status, r.body) };
    if (Date.now() > until) return { ok: true, pending: id };
    await new Promise((res) => setTimeout(res, 3000));
  }
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "methode" }, 405);

  const sb = getServiceClient();
  const authz = req.headers.get("Authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  const { data: u } = bearer ? await sb.auth.getUser(bearer) : { data: null };
  if (!u?.user) return json({ error: "non_autorise" }, 401);
  const { data: prof } = await sb.from("profiles").select("role").eq("user_id", u.user.id).maybeSingle<{ role: string }>();
  if (prof?.role !== "agency") return json({ error: "non_autorise" }, 403);
  if (!KEY) return json({ error: "cle_absente" });

  let b: Record<string, unknown> = {};
  try {
    b = (await req.json()) ?? {};
  } catch {
    b = {};
  }
  const action = String(b.action ?? "");

  if (action === "credits") {
    const r = await fe("/account/credits");
    return r.status === 200 ? json({ ok: true, balance: Number(r.body.balance) || 0 }) : json({ error: why(r.status, r.body) });
  }

  if (action === "search") {
    const company = String(b.company ?? "").trim().slice(0, 200);
    if (!company) return json({ error: "marque_manquante" }, 400);
    const titles = Array.isArray(b.titles) ? b.titles.map(String).slice(0, 12) : undefined;
    const body = searchBody({ company, titles, country: String(b.country ?? "").trim() || undefined, limit: Number(b.limit) || 10, offset: Number(b.offset) || 0 });
    const r = await fe("/people/search", { method: "POST", body: JSON.stringify(body) });
    if (r.status !== 200) return json({ error: why(r.status, r.body) });
    return json({ ok: true, ...parsePeople(r.body) });
  }

  if (action === "enrich") {
    const contact = enrichContact({
      first: String(b.first ?? ""), last: String(b.last ?? ""), company: String(b.company ?? ""), domain: String(b.domain ?? ""),
      linkedin: String(b.linkedin ?? ""), phone: b.phone === true,
    });
    if (!contact) return json({ error: "infos_manquantes" }, 400);
    const r = await fe("/contact/enrich/bulk", { method: "POST", body: JSON.stringify({ name: "TTP Suite", data: [contact] }) });
    const id = String(r.body.enrichment_id ?? "");
    if (r.status !== 200 || !id) return json({ error: why(r.status, r.body) });
    return json(await result(id, 20_000));
  }

  if (action === "result") {
    const id = String(b.id ?? "");
    if (!/^[0-9a-f-]{20,60}$/i.test(id)) return json({ error: "requete_invalide" }, 400);
    return json(await result(id, 15_000));
  }

  return json({ error: "action_inconnue" }, 400);
});
